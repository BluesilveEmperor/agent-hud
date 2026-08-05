import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { AgentId, AgentStatus, SessionState } from "../types";
import { contextColor, contextLabel, contextRatio, fmtTokens } from "../usage";

const AGENT_SHORT: Record<AgentId, string> = {
  "claude-code": "Claude",
  codex: "Codex",
  trae: "Trae",
  opencode: "OpenCode",
  "deveco-code": "DevEco",
};
const AGENT_FULL: Record<AgentId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  trae: "Trae",
  opencode: "OpenCode",
  "deveco-code": "DevEco Code",
};

interface Props {
  agent: AgentId;
  sessions: SessionState[];
  expanded: boolean;
}

function aggregateStatus(sessions: SessionState[]): AgentStatus {
  const has = (s: AgentStatus) => sessions.some((x) => x.status === s);
  if (has("error")) return "error";
  if (has("working")) return "working";
  if (has("done")) return "done";
  return "idle";
}

function pickActive(sessions: SessionState[]): SessionState | undefined {
  const order = (s: SessionState) =>
    s.status === "working" ? 0 : s.status === "done" ? 1 : s.status === "error" ? 2 : 3;
  return [...sessions].sort((a, b) => {
    const o = order(a) - order(b);
    if (o !== 0) return o;
    return a.lastEventAt < b.lastEventAt ? 1 : -1;
  })[0];
}

function elapsed(fromIso?: string): string {
  if (!fromIso) return "";
  const ms = Date.now() - new Date(fromIso).getTime();
  if (ms < 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m${s % 60}s` : `${Math.floor(m / 60)}h${m % 60}m`;
}

// Re-render every `intervalMs` while `active` is true, so the WSL progress bar
// ticks smoothly instead of jumping only on events/ETA refreshes.
function useTick(active: boolean, intervalMs = 1000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((x) => x + 1), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs]);
  return tick;
}

interface WslProgress {
  elapsedMs: number;
  pct?: number;
  remainingMs?: number;
}

// WSL progress from elapsed time vs historical average duration.
// Returns null when there's no live WSL state; pct/remainingMs undefined when
// the command has no history yet (show "running" without a percentage).
function wslProgress(wsl: SessionState["wsl"], nowMs: number): WslProgress | null {
  if (!wsl) return null;
  const elapsedMs = Math.max(0, nowMs - new Date(wsl.startedAt).getTime());
  if (wsl.estimatedTotalMs == null || wsl.estimatedTotalMs <= 0) {
    return { elapsedMs };
  }
  const pct = Math.min(1, elapsedMs / wsl.estimatedTotalMs);
  return {
    elapsedMs,
    pct,
    remainingMs: Math.max(0, wsl.estimatedTotalMs - elapsedMs),
  };
}

function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m${s % 60}s` : `${Math.floor(m / 60)}h${m % 60}m`;
}

function Check() {
  return (
    <svg className="check" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
      <motion.path
        d="M5 12.5l4.2 4.2L19 7"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
    </svg>
  );
}

export function AgentPill({ agent, sessions, expanded }: Props) {
  const status = aggregateStatus(sessions);
  const active = pickActive(sessions);
  const count = sessions.length;
  const workingCount = sessions.filter((s) => s.status === "working").length;
  // Tick every second while a WSL command is live so its progress bar moves.
  const tick = useTick(status === "working" && !!active?.wsl);
  void tick; // the re-render is the point; elapsed/progress read Date.now()

  const tool = active?.currentTool;
  const timeText =
    status === "working" && active?.startedAt ? elapsed(active.startedAt) : "";
  const usage = active?.usage;
  const hasCtx = usage != null && usage.contextTokens != null;
  // ETA: only show when we have a meaningful estimate (>30s, <4h). Tiny values
  // are noise; huge ones mean the rate sample is too sparse to trust.
  const eta = active?.etaSeconds;
  const etaText =
    status === "working" && eta != null && eta > 30 && eta < 4 * 3600
      ? eta < 60
        ? `~${eta}s`
        : eta < 3600
          ? `~${Math.round(eta / 60)}m`
          : `~${Math.floor(eta / 3600)}h${Math.round((eta % 3600) / 60)}m`
      : "";

  const countBadge =
    count > 1 ? (workingCount > 0 ? `×${count} · ${workingCount}忙` : `×${count}`) : null;
  const seqTag = count === 1 && active ? `对话 ${active.seq}` : null;

  // A slim inline context bar — shown whenever we have a context figure,
  // regardless of state (you want to see how full the window is even when
  // idle/done). Rendered as a tiny track with a fill, plus a token count.
  const ctxBar = hasCtx ? (
    <span className="ctx-mini" title={`上下文 ${contextLabel(usage)}`}>
      <span className="ctx-mini-track">
        <span
          className="ctx-mini-fill"
          style={{
            width: `${Math.round((contextRatio(usage) ?? 0) * 100)}%`,
            background: contextColor(usage),
          }}
        />
      </span>
      <span className="ctx-mini-text">{fmtTokens(usage!.contextTokens)}</span>
    </span>
  ) : null;

  // The chip text is derived purely from `status`, so it can never lag behind
  // the dot colour (no more "green dot but still Bash · 42s"). The element is
  // keyed by `status` alone — while a task ticks, only the inner time text
  // updates in place, so the chip never remounts or re-animates every second.
  let chip: ReactNode;
  if (status === "done") {
    chip = (
      <>
        <Check />
        完成
      </>
    );
  } else if (status === "error") {
    chip = "出错";
  } else if (status === "working") {
    if (expanded && active?.lastPrompt) {
      chip = active.lastPrompt;
    } else if (active?.wsl) {
      const prog = wslProgress(active.wsl, Date.now());
      const pct = prog?.pct != null ? Math.round(prog.pct * 100) : undefined;
      chip = (
        <>
          <span className="wsl-chip" title={active.wsl.distro ? `WSL · ${active.wsl.distro}` : "WSL"}>
            WSL{active.wsl.distro ? ` · ${active.wsl.distro}` : ""}
          </span>
          <span className="chip-wsl-cmd">{active.wsl.command}</span>
          {prog?.pct != null && (
            <>
              <span
                className="wsl-progress-mini"
                title={`已运行 ${fmtMs(prog.elapsedMs)} · 预计总时长 ${fmtMs(active.wsl.estimatedTotalMs!)} · 约剩 ${fmtMs(prog.remainingMs!)}`}
              >
                <span className="wsl-progress-mini-track">
                  <span className="wsl-progress-mini-fill" style={{ width: `${pct}%` }} />
                </span>
              </span>
              <span className="wsl-progress-pct">{pct}%</span>
            </>
          )}
          {timeText && (
            <>
              <span className="chip-sep">·</span>
              <span className="chip-time">{timeText}</span>
            </>
          )}
        </>
      );
    } else {
      chip = (
        <>
          {tool || "工作中"}
          {timeText && (
            <>
              <span className="chip-sep">·</span>
              <span className="chip-time">{timeText}</span>
            </>
          )}
          {etaText && (
            <>
              <span className="chip-sep">·</span>
              <span className="chip-eta" title="预计上下文用尽时间">⏳{etaText}</span>
            </>
          )}
          {ctxBar && expanded && (
            <>
              <span className="chip-sep">·</span>
              {ctxBar}
            </>
          )}
        </>
      );
    }
  } else {
    chip = (
      <>
        空闲
        {ctxBar && expanded && (
          <>
            <span className="chip-sep">·</span>
            {ctxBar}
          </>
        )}
      </>
    );
  }

  return (
    <div className={`agent state-${status}`}>
      <span className={`dot ${status}`} />
      <motion.span layout="position" className="label">
        {expanded ? AGENT_FULL[agent] : AGENT_SHORT[agent]}
      </motion.span>

      {countBadge && <span className="count-badge">{countBadge}</span>}
      {expanded && seqTag && <span className="session-tag">{seqTag}</span>}

      <motion.span
        key={status}
        layout="position"
        className={`state-chip ${status}`}
        initial={{ opacity: 0, y: -3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        {chip}
      </motion.span>
    </div>
  );
}
