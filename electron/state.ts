import { EventEmitter } from "node:events";

export type AgentId = "claude-code" | "codex" | "trae" | "opencode" | "deveco-code";
export type AgentStatus = "idle" | "working" | "done" | "error";
export type EventType =
  | "session_start"
  | "session_end"
  | "user_prompt"
  | "tool_use"
  | "stop"
  | "notification"
  | "error";

// Token / context usage for a session. Populated by hook scripts that parse
// each agent's transcript (Claude Code) or read the message API (OpenCode).
// All fields optional — an agent may report only some of them.
export interface Usage {
  // Tokens in the current context window = last request's
  // input + cache_read + cache_creation. This is the "how full is the
  // context" number, and the one users care about most.
  contextTokens?: number;
  // The model's context window limit (e.g. 200000 for Claude Sonnet 4).
  // Used to render the progress bar. 0/undefined → bar hidden.
  contextLimit?: number;
  // Tokens produced by the most recent assistant turn.
  outputTokens?: number;
  // Cumulative tokens billed across the whole session (input+output summed
  // per turn). Lets users see how "expensive" a session has been.
  totalTokens?: number;
  // Model id, if known (e.g. "claude-sonnet-4-5").
  model?: string;
}

export interface LightEvent {
  agent: AgentId;
  type: EventType;
  sessionId?: string;
  tool?: string;
  message?: string;
  timestamp: string;
  usage?: Usage;
}

export interface SessionState {
  key: string;
  agent: AgentId;
  sessionId: string;
  seq: number; // human-friendly per-agent index ("第 N 个对话")
  status: AgentStatus;
  currentTool?: string;
  lastPrompt?: string;
  lastEventAt: string;
  startedAt?: string;
  recent: LightEvent[];
  usage?: Usage;
  // ETA estimate for "working" sessions: seconds until the context window
  // fills at the current token rate, or undefined if we can't estimate.
  // This is a rough heuristic, not a promise — see computeEta().
  etaSeconds?: number;
}

export interface AppState {
  sessions: SessionState[];
}

const DONE_LINGER_MS = 8_000;
const ERROR_LINGER_MS = 5_000;
// If a session sits in "working" with no new event for this long, assume the
// agent crashed / lost network / was killed, and drop it back to idle so the
// timer stops climbing forever.
const STALE_WORKING_MS = 4 * 60_000;
const IDLE_GC_MS = 30 * 60_000; // drop idle sessions after 30 min of no activity
const RECENT_CAP = 30;

// Codex fires no SessionEnd/close hook, so — unlike Claude Code — we can't drop
// its pill the instant the window closes. Instead we retire such a session a
// short while after it goes quiet (done → idle); any new event brings it right
// back. Without this a finished/closed Codex would linger until the 30-min GC.
const NO_END_IDLE_MS = 15_000;
// opencode & deveco-code (built on opencode) report via a plugin with no
// reliable "window closed" signal — same treatment as codex: retire the pill
// shortly after it goes quiet, so a finished session doesn't linger.
const AGENTS_WITHOUT_SESSION_END = new Set<AgentId>([
  "codex",
  "opencode",
  "deveco-code",
]);

const VALID_AGENTS = new Set<AgentId>([
  "claude-code",
  "codex",
  "trae",
  "opencode",
  "deveco-code",
]);
const VALID_TYPES = new Set<EventType>([
  "session_start",
  "session_end",
  "user_prompt",
  "tool_use",
  "stop",
  "notification",
  "error",
]);

export function isValidAgent(x: unknown): x is AgentId {
  return typeof x === "string" && VALID_AGENTS.has(x as AgentId);
}
export function isValidType(x: unknown): x is EventType {
  return typeof x === "string" && VALID_TYPES.has(x as EventType);
}

function truncate(s: string | undefined, max = 200): string | undefined {
  if (s == null) return s;
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function keyOf(agent: AgentId, sessionId: string): string {
  return `${agent}::${sessionId}`;
}

function shortSessionId(raw: string | undefined): string {
  if (!raw) return "default";
  // Many session IDs are UUIDs; take the first 8 chars as a stable short tag.
  return raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, 12) || "default";
}

export class StateStore extends EventEmitter {
  private sessions = new Map<string, SessionState>();
  private timers = new Map<string, NodeJS.Timeout>();
  private gcTimers = new Map<string, NodeJS.Timeout>();
  private seqCounters = new Map<AgentId, number>();
  // Per-session rolling list of (timestamp, contextTokens) samples, used to
  // estimate the token-consumption rate for ETA. Capped at RATE_SAMPLES.
  private rateSamples = new Map<string, { t: number; ctx: number }[]>();
  // A single interval that recomputes ETAs for all working sessions, so the
  // pill's "~4m" ticks down without needing a new event to arrive.
  private etaTimer: NodeJS.Timeout | null = null;

  private static readonly RATE_SAMPLES = 8;
  private static readonly ETA_REFRESH_MS = 5000;

  private nextSeq(agent: AgentId): number {
    const n = (this.seqCounters.get(agent) ?? 0) + 1;
    this.seqCounters.set(agent, n);
    return n;
  }

  getState(): AppState {
    const arr = Array.from(this.sessions.values()).sort(
      (a, b) => (a.lastEventAt < b.lastEventAt ? 1 : -1),
    );
    return JSON.parse(JSON.stringify({ sessions: arr }));
  }

  ingest(rawEvent: LightEvent): LightEvent {
    const sessionId = shortSessionId(rawEvent.sessionId);
    const evt: LightEvent = {
      agent: rawEvent.agent,
      type: rawEvent.type,
      sessionId,
      tool: typeof rawEvent.tool === "string" ? truncate(rawEvent.tool, 80) : undefined,
      message: typeof rawEvent.message === "string" ? truncate(rawEvent.message, 400) : undefined,
      timestamp: rawEvent.timestamp ?? new Date().toISOString(),
      usage: rawEvent.usage,
    };

    const key = keyOf(evt.agent, sessionId);

    // session_end removes the session entirely (the agent window closed).
    if (evt.type === "session_end") {
      const t = this.timers.get(key);
      if (t) clearTimeout(t);
      const g = this.gcTimers.get(key);
      if (g) clearTimeout(g);
      this.timers.delete(key);
      this.gcTimers.delete(key);
      this.sessions.delete(key);
      this.emit("state", this.getState());
      this.emit("event", evt);
      return evt;
    }

    const prev = this.sessions.get(key);
    const recent = prev?.recent ?? [];
    const newRecent = [evt, ...recent].slice(0, RECENT_CAP);

    let next: SessionState = {
      key,
      agent: evt.agent,
      sessionId,
      seq: prev?.seq ?? this.nextSeq(evt.agent),
      status: prev?.status ?? "idle",
      currentTool: prev?.currentTool,
      lastPrompt: prev?.lastPrompt,
      lastEventAt: evt.timestamp,
      startedAt: prev?.startedAt,
      recent: newRecent,
      // Usage is merged, not replaced: a hook may report only contextTokens
      // on one event and only outputTokens on the next. Keep the last known
      // value for any field the new event omits.
      usage: { ...(prev?.usage ?? {}), ...(evt.usage ?? {}) },
    };

    switch (evt.type) {
      case "session_start":
        next.status = "idle";
        next.currentTool = undefined;
        next.startedAt = undefined;
        next.lastPrompt = undefined;
        // A brand-new session starts with a fresh context — drop any stale
        // usage left over from a previous session that reused this slot.
        next.usage = evt.usage ?? {};
        this.rateSamples.delete(key); // fresh session, fresh rate window
        break;
      case "user_prompt":
        next.status = "working";
        next.startedAt = evt.timestamp;
        next.lastPrompt = evt.message;
        next.currentTool = undefined;
        this.rateSamples.delete(key); // new turn, reset rate estimate
        break;
      case "tool_use":
        next.status = "working";
        next.currentTool = evt.tool ?? evt.message;
        if (!next.startedAt) next.startedAt = evt.timestamp;
        break;
      case "stop":
        next.status = "done";
        next.currentTool = undefined;
        break;
      case "error":
        next.status = "error";
        next.currentTool = undefined;
        break;
      case "notification":
        break;
    }

    // Feed the rate sampler whenever we have a context figure — this is how
    // ETA gets its "tokens per second" slope. We sample on any event that
    // carries usage (tool_use/stop), not on a wall-clock timer, because the
    // context only changes when the model actually runs.
    if (next.usage?.contextTokens != null) {
      this.pushSample(key, Date.now(), next.usage.contextTokens);
      next.etaSeconds = this.computeEta(next);
    }

    this.sessions.set(key, next);
    this.ensureEtaTimer();
    this.scheduleAutoReset(key);
    this.scheduleGc(key);
    this.emit("state", this.getState());
    this.emit("event", evt);
    return evt;
  }

  clearEvents(): void {
    for (const s of this.sessions.values()) {
      s.recent = [];
    }
    this.emit("state", this.getState());
  }

  // Manually drop a single session from the island (user housekeeping).
  // If that agent window is still alive and fires another hook later, the
  // session simply reappears with a fresh seq — nothing breaks.
  removeSession(key: string): void {
    const t = this.timers.get(key);
    if (t) clearTimeout(t);
    const g = this.gcTimers.get(key);
    if (g) clearTimeout(g);
    this.timers.delete(key);
    this.gcTimers.delete(key);
    this.rateSamples.delete(key);
    const session = this.sessions.get(key);
    if (session) {
      // Before dropping, emit a "retire" event so main.ts can record the
      // session into history and fire completion notifications. We only
      // retire sessions that actually did something (had a prompt or a tool),
      // so a never-used idle slot doesn't pollute the history.
      if (session.lastPrompt || session.recent.some((e) => e.type === "tool_use")) {
        this.emit("retire", this.snapshotForRetire(session));
      }
    }
    if (this.sessions.delete(key)) {
      this.emit("state", this.getState());
    }
  }

  clearAll(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    for (const t of this.gcTimers.values()) clearTimeout(t);
    this.timers.clear();
    this.gcTimers.clear();
    this.sessions.clear();
    this.emit("state", this.getState());
  }

  private scheduleAutoReset(key: string): void {
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);

    const cur = this.sessions.get(key);
    if (!cur) return;

    const noEnd = AGENTS_WITHOUT_SESSION_END.has(cur.agent);

    // done/error linger briefly then settle to idle. "working" gets a much
    // longer watchdog so a crashed/disconnected agent doesn't climb forever.
    // For agents with no close hook, "idle" also gets a (short) timer so we can
    // retire the pill once it's been quiet — they never tell us they closed.
    let delay = 0;
    if (cur.status === "done") delay = DONE_LINGER_MS;
    else if (cur.status === "error") delay = ERROR_LINGER_MS;
    else if (cur.status === "working") delay = STALE_WORKING_MS;
    else if (cur.status === "idle" && noEnd) delay = NO_END_IDLE_MS;
    else return;

    const timer = setTimeout(() => {
      const c = this.sessions.get(key);
      if (!c) return;
      // A no-close-signal agent that's gone quiet → the window is probably gone.
      // Retire the session so a stale pill never lingers; it reappears with a
      // fresh seq on the next event.
      if (c.status === "idle" && noEnd) {
        this.removeSession(key);
        return;
      }
      if (c.status === "done" || c.status === "error" || c.status === "working") {
        c.status = "idle";
        c.startedAt = undefined;
        c.currentTool = undefined;
        this.emit("state", this.getState());
        // Now idle — for no-close-signal agents, arm the retire timer.
        if (noEnd) this.scheduleAutoReset(key);
      }
    }, delay);
    this.timers.set(key, timer);
  }

  private scheduleGc(key: string): void {
    const existing = this.gcTimers.get(key);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      const cur = this.sessions.get(key);
      if (!cur) return;
      if (cur.status === "idle") {
        // Retire into history before dropping, same as removeSession.
        if (cur.lastPrompt || cur.recent.some((e) => e.type === "tool_use")) {
          this.emit("retire", this.snapshotForRetire(cur));
        }
        this.sessions.delete(key);
        this.gcTimers.delete(key);
        this.timers.delete(key);
        this.rateSamples.delete(key);
        this.emit("state", this.getState());
      }
    }, IDLE_GC_MS);
    this.gcTimers.set(key, t);
  }

  // Build the compact snapshot handed to history/notifier when a session is
  // retired. We copy only what those modules need — not the full recent[]
  // array (which can be large), just enough for a meaningful record.
  private snapshotForRetire(s: SessionState): SessionState {
    return {
      ...s,
      // Keep the last 20 events for the history detail view; the live pill
      // keeps up to 30 but history doesn't need that much.
      recent: s.recent.slice(0, 20),
    };
  }

  // ---- ETA estimation -----------------------------------------------------

  private pushSample(key: string, t: number, ctx: number): void {
    let arr = this.rateSamples.get(key);
    if (!arr) {
      arr = [];
      this.rateSamples.set(key, arr);
    }
    arr.push({ t, ctx });
    if (arr.length > StateStore.RATE_SAMPLES) arr.shift();
  }

  // Estimate seconds until the context window fills, based on the recent
  // token-consumption rate. Returns undefined when there's not enough data
  // or no limit to project against. This is deliberately crude — it's a
  // "roughly how long" hint, not a deadline.
  private computeEta(s: SessionState): number | undefined {
    if (s.status !== "working") return undefined;
    const ctx = s.usage?.contextTokens;
    const limit = s.usage?.contextLimit;
    if (ctx == null || !limit || limit <= 0) return undefined;
    const remaining = limit - ctx;
    if (remaining <= 0) return 0;
    const samples = this.rateSamples.get(s.key);
    if (!samples || samples.length < 2) return undefined;
    // Linear regression slope: tokens per ms. Use the first and last sample
    // (the rolling window is small enough that a full least-squares fit would
    // be noise, not signal).
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = last.t - first.t;
    if (dt <= 0) return undefined;
    const dCtx = last.ctx - first.ctx;
    if (dCtx <= 0) return undefined; // context shrank (compact/clear) — no slope
    const ratePerMs = dCtx / dt;
    if (ratePerMs <= 0) return undefined;
    return Math.round(remaining / ratePerMs / 1000);
  }

  private ensureEtaTimer(): void {
    if (this.etaTimer) return;
    this.etaTimer = setInterval(() => {
      let changed = false;
      for (const s of this.sessions.values()) {
        if (s.status !== "working") continue;
        const eta = this.computeEta(s);
        if (eta !== s.etaSeconds) {
          s.etaSeconds = eta;
          changed = true;
        }
      }
      if (changed) this.emit("state", this.getState());
    }, StateStore.ETA_REFRESH_MS);
    // Don't keep the process alive just for ETA ticks.
    if (this.etaTimer.unref) this.etaTimer.unref();
  }
}
