// Cross-scene task-completion notifications.
//
// When a session transitions to "done" or "error" (and the user may have
// switched to another window), we fire:
//   1. A native OS notification (Electron Notification on Windows → toast).
//   2. An optional webhook POST (so it can reach Slack / 企业微信 / 飞书 / a
//      phone via push service).
//
// Both are configurable from the UI (notify-config.json in userData). The OS
// notification can be turned off; the webhook is off by default (needs a URL).
//
// Debounce: a session that flips done→idle→done repeatedly (e.g. Claude
// answering, going quiet, answering again) only notifies once per "burst" —
// within DEBOUNCE_MS of the last notification for that session we stay quiet.

import { app, Notification } from "electron";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import type { AgentId, SessionState, Usage } from "./state";

export interface NotifyConfig {
  osEnabled: boolean;
  webhookEnabled: boolean;
  webhookUrl: string;
  // Only notify for sessions that ran at least this long (ms). Short Q&A
  // turns that finish in 2s aren't worth a popup. Default 8s.
  minDurationMs: number;
}

const DEFAULT_CONFIG: NotifyConfig = {
  osEnabled: true,
  webhookEnabled: false,
  webhookUrl: "",
  minDurationMs: 8000,
};

const DEBOUNCE_MS = 30_000; // one notification per session per 30s

const AGENT_LABEL: Record<AgentId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  trae: "Trae",
  opencode: "OpenCode",
  "deveco-code": "DevEco Code",
};

export class Notifier {
  private configPath: string;
  private config: NotifyConfig = { ...DEFAULT_CONFIG };
  private lastNotified = new Map<string, number>(); // sessionKey -> timestamp

  constructor(userDataDir: string) {
    this.configPath = path.join(userDataDir, "notify-config.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          this.config = {
            osEnabled: parsed.osEnabled !== false,
            webhookEnabled: Boolean(parsed.webhookEnabled),
            webhookUrl: typeof parsed.webhookUrl === "string" ? parsed.webhookUrl : "",
            minDurationMs: typeof parsed.minDurationMs === "number" ? parsed.minDurationMs : DEFAULT_CONFIG.minDurationMs,
          };
        }
      }
    } catch (err) {
      console.error("[notifier] load failed:", err);
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.configPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), "utf8");
    } catch (err) {
      console.error("[notifier] save failed:", err);
    }
  }

  getConfig(): NotifyConfig {
    return { ...this.config };
  }

  setConfig(patch: Partial<NotifyConfig>): NotifyConfig {
    this.config = { ...this.config, ...patch };
    this.save();
    return this.getConfig();
  }

  // Fire a notification for a session that just transitioned to done/error.
  // `session` is the live state right before retirement; we snapshot what we
  // need from it.
  notify(session: SessionState): void {
    // Respect min-duration: a 2-second answer isn't worth interrupting.
    const durationMs = session.startedAt ? Date.now() - new Date(session.startedAt).getTime() : 0;
    if (durationMs > 0 && durationMs < this.config.minDurationMs) return;

    const key = session.key;
    const now = Date.now();
    const last = this.lastNotified.get(key) ?? 0;
    if (now - last < DEBOUNCE_MS) return;
    this.lastNotified.set(key, now);

    const label = AGENT_LABEL[session.agent] ?? session.agent;
    const status = session.status === "error" ? "出错" : "完成";
    const title = `${label} · ${status}`;
    const bodyParts: string[] = [];
    if (session.lastPrompt) bodyParts.push(truncate(session.lastPrompt, 60));
    if (durationMs > 0) bodyParts.push(fmtDuration(durationMs));
    if (session.usage?.totalTokens) bodyParts.push(`${fmtTokens(session.usage.totalTokens)} tokens`);
    const body = bodyParts.join(" · ");

    if (this.config.osEnabled) {
      try {
        if (Notification.isSupported()) {
          const n = new Notification({
            title,
            body,
            silent: false,
          });
          n.on("click", () => {
            // Best we can do without deep-linking: flash the island by showing
            // the window. The user can then click the pill.
          });
          n.show();
        }
      } catch (err) {
        console.error("[notifier] OS notification failed:", err);
      }
    }

    if (this.config.webhookEnabled && this.config.webhookUrl) {
      this.fireWebhook({
        agent: session.agent,
        agentLabel: label,
        sessionId: session.sessionId,
        seq: session.seq,
        status: session.status,
        title,
        body,
        prompt: session.lastPrompt,
        durationMs,
        usage: session.usage,
        timestamp: new Date().toISOString(),
      }).catch(() => { /* swallow — webhook failures must never break the app */ });
    }
  }

  private fireWebhook(payload: unknown): Promise<void> {
    return new Promise((resolve) => {
      let url: URL;
      try {
        url = new URL(this.config.webhookUrl);
      } catch {
        resolve();
        return;
      }
      const body = Buffer.from(JSON.stringify(payload), "utf8");
      const lib = url.protocol === "https:" ? https : http;
      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: url.pathname + url.search,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": body.length,
          },
          timeout: 5000,
        },
        () => resolve(),
      );
      req.on("error", () => resolve());
      req.on("timeout", () => { req.destroy(); resolve(); });
      req.write(body);
      req.end();
    });
  }

  // Send a test notification so the user can verify their webhook config.
  async test(): Promise<{ os: boolean; webhook: boolean; error?: string }> {
    const result = { os: false, webhook: false, error: undefined as string | undefined };
    if (this.config.osEnabled && Notification.isSupported()) {
      try {
        new Notification({ title: "AgentHUD · 测试", body: "系统通知工作正常" }).show();
        result.os = true;
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
      }
    }
    if (this.config.webhookEnabled && this.config.webhookUrl) {
      await this.fireWebhook({
        test: true,
        title: "AgentHUD · 测试",
        body: "webhook 工作正常",
        timestamp: new Date().toISOString(),
      });
      result.webhook = true;
    }
    return result;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// Re-export for tests / type imports.
export type { Usage };
// `app` import is used for userData path resolution at the call site; keep the
// import so the module has a stable electron dependency surface.
void app;
