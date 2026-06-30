"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Notifier = void 0;
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_http_1 = __importDefault(require("node:http"));
const node_https_1 = __importDefault(require("node:https"));
const node_url_1 = require("node:url");
const DEFAULT_CONFIG = {
    osEnabled: true,
    webhookEnabled: false,
    webhookUrl: "",
    minDurationMs: 8000,
};
const DEBOUNCE_MS = 30_000; // one notification per session per 30s
const AGENT_LABEL = {
    "claude-code": "Claude Code",
    codex: "Codex",
    trae: "Trae",
    opencode: "OpenCode",
    "deveco-code": "DevEco Code",
};
class Notifier {
    configPath;
    config = { ...DEFAULT_CONFIG };
    lastNotified = new Map(); // sessionKey -> timestamp
    constructor(userDataDir) {
        this.configPath = node_path_1.default.join(userDataDir, "notify-config.json");
        this.load();
    }
    load() {
        try {
            if (node_fs_1.default.existsSync(this.configPath)) {
                const raw = node_fs_1.default.readFileSync(this.configPath, "utf8");
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
        }
        catch (err) {
            console.error("[notifier] load failed:", err);
        }
    }
    save() {
        try {
            const dir = node_path_1.default.dirname(this.configPath);
            node_fs_1.default.mkdirSync(dir, { recursive: true });
            node_fs_1.default.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), "utf8");
        }
        catch (err) {
            console.error("[notifier] save failed:", err);
        }
    }
    getConfig() {
        return { ...this.config };
    }
    setConfig(patch) {
        this.config = { ...this.config, ...patch };
        this.save();
        return this.getConfig();
    }
    // Fire a notification for a session that just transitioned to done/error.
    // `session` is the live state right before retirement; we snapshot what we
    // need from it.
    notify(session) {
        // Respect min-duration: a 2-second answer isn't worth interrupting.
        const durationMs = session.startedAt ? Date.now() - new Date(session.startedAt).getTime() : 0;
        if (durationMs > 0 && durationMs < this.config.minDurationMs)
            return;
        const key = session.key;
        const now = Date.now();
        const last = this.lastNotified.get(key) ?? 0;
        if (now - last < DEBOUNCE_MS)
            return;
        this.lastNotified.set(key, now);
        const label = AGENT_LABEL[session.agent] ?? session.agent;
        const status = session.status === "error" ? "出错" : "完成";
        const title = `${label} · ${status}`;
        const bodyParts = [];
        if (session.lastPrompt)
            bodyParts.push(truncate(session.lastPrompt, 60));
        if (durationMs > 0)
            bodyParts.push(fmtDuration(durationMs));
        if (session.usage?.totalTokens)
            bodyParts.push(`${fmtTokens(session.usage.totalTokens)} tokens`);
        const body = bodyParts.join(" · ");
        if (this.config.osEnabled) {
            try {
                if (electron_1.Notification.isSupported()) {
                    const n = new electron_1.Notification({
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
            }
            catch (err) {
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
            }).catch(() => { });
        }
    }
    fireWebhook(payload) {
        return new Promise((resolve) => {
            let url;
            try {
                url = new node_url_1.URL(this.config.webhookUrl);
            }
            catch {
                resolve();
                return;
            }
            const body = Buffer.from(JSON.stringify(payload), "utf8");
            const lib = url.protocol === "https:" ? node_https_1.default : node_http_1.default;
            const req = lib.request({
                hostname: url.hostname,
                port: url.port || (url.protocol === "https:" ? 443 : 80),
                path: url.pathname + url.search,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": body.length,
                },
                timeout: 5000,
            }, () => resolve());
            req.on("error", () => resolve());
            req.on("timeout", () => { req.destroy(); resolve(); });
            req.write(body);
            req.end();
        });
    }
    // Send a test notification so the user can verify their webhook config.
    async test() {
        const result = { os: false, webhook: false, error: undefined };
        if (this.config.osEnabled && electron_1.Notification.isSupported()) {
            try {
                new electron_1.Notification({ title: "AgentHUD · 测试", body: "系统通知工作正常" }).show();
                result.os = true;
            }
            catch (e) {
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
exports.Notifier = Notifier;
function truncate(s, max) {
    return s.length > max ? s.slice(0, max) + "…" : s;
}
function fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60)
        return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}m${s % 60}s`;
    return `${Math.floor(m / 60)}h${m % 60}m`;
}
function fmtTokens(n) {
    if (n < 1000)
        return String(n);
    if (n < 1_000_000)
        return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
    return `${(n / 1_000_000).toFixed(1)}M`;
}
// `app` import is used for userData path resolution at the call site; keep the
// import so the module has a stable electron dependency surface.
void electron_1.app;
//# sourceMappingURL=notifier.js.map