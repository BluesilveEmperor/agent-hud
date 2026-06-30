"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateStore = void 0;
exports.isValidAgent = isValidAgent;
exports.isValidType = isValidType;
const node_events_1 = require("node:events");
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
const AGENTS_WITHOUT_SESSION_END = new Set([
    "codex",
    "opencode",
    "deveco-code",
]);
const VALID_AGENTS = new Set([
    "claude-code",
    "codex",
    "trae",
    "opencode",
    "deveco-code",
]);
const VALID_TYPES = new Set([
    "session_start",
    "session_end",
    "user_prompt",
    "tool_use",
    "stop",
    "notification",
    "error",
]);
function isValidAgent(x) {
    return typeof x === "string" && VALID_AGENTS.has(x);
}
function isValidType(x) {
    return typeof x === "string" && VALID_TYPES.has(x);
}
function truncate(s, max = 200) {
    if (s == null)
        return s;
    return s.length > max ? s.slice(0, max) + "…" : s;
}
function keyOf(agent, sessionId) {
    return `${agent}::${sessionId}`;
}
function shortSessionId(raw) {
    if (!raw)
        return "default";
    // Many session IDs are UUIDs; take the first 8 chars as a stable short tag.
    return raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, 12) || "default";
}
class StateStore extends node_events_1.EventEmitter {
    sessions = new Map();
    timers = new Map();
    gcTimers = new Map();
    seqCounters = new Map();
    // Per-session rolling list of (timestamp, contextTokens) samples, used to
    // estimate the token-consumption rate for ETA. Capped at RATE_SAMPLES.
    rateSamples = new Map();
    // A single interval that recomputes ETAs for all working sessions, so the
    // pill's "~4m" ticks down without needing a new event to arrive.
    etaTimer = null;
    static RATE_SAMPLES = 8;
    static ETA_REFRESH_MS = 5000;
    nextSeq(agent) {
        const n = (this.seqCounters.get(agent) ?? 0) + 1;
        this.seqCounters.set(agent, n);
        return n;
    }
    getState() {
        const arr = Array.from(this.sessions.values()).sort((a, b) => (a.lastEventAt < b.lastEventAt ? 1 : -1));
        return JSON.parse(JSON.stringify({ sessions: arr }));
    }
    ingest(rawEvent) {
        const sessionId = shortSessionId(rawEvent.sessionId);
        const evt = {
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
            if (t)
                clearTimeout(t);
            const g = this.gcTimers.get(key);
            if (g)
                clearTimeout(g);
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
        let next = {
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
                if (!next.startedAt)
                    next.startedAt = evt.timestamp;
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
    clearEvents() {
        for (const s of this.sessions.values()) {
            s.recent = [];
        }
        this.emit("state", this.getState());
    }
    // Manually drop a single session from the island (user housekeeping).
    // If that agent window is still alive and fires another hook later, the
    // session simply reappears with a fresh seq — nothing breaks.
    removeSession(key) {
        const t = this.timers.get(key);
        if (t)
            clearTimeout(t);
        const g = this.gcTimers.get(key);
        if (g)
            clearTimeout(g);
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
    clearAll() {
        for (const t of this.timers.values())
            clearTimeout(t);
        for (const t of this.gcTimers.values())
            clearTimeout(t);
        this.timers.clear();
        this.gcTimers.clear();
        this.sessions.clear();
        this.emit("state", this.getState());
    }
    scheduleAutoReset(key) {
        const existing = this.timers.get(key);
        if (existing)
            clearTimeout(existing);
        const cur = this.sessions.get(key);
        if (!cur)
            return;
        const noEnd = AGENTS_WITHOUT_SESSION_END.has(cur.agent);
        // done/error linger briefly then settle to idle. "working" gets a much
        // longer watchdog so a crashed/disconnected agent doesn't climb forever.
        // For agents with no close hook, "idle" also gets a (short) timer so we can
        // retire the pill once it's been quiet — they never tell us they closed.
        let delay = 0;
        if (cur.status === "done")
            delay = DONE_LINGER_MS;
        else if (cur.status === "error")
            delay = ERROR_LINGER_MS;
        else if (cur.status === "working")
            delay = STALE_WORKING_MS;
        else if (cur.status === "idle" && noEnd)
            delay = NO_END_IDLE_MS;
        else
            return;
        const timer = setTimeout(() => {
            const c = this.sessions.get(key);
            if (!c)
                return;
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
                if (noEnd)
                    this.scheduleAutoReset(key);
            }
        }, delay);
        this.timers.set(key, timer);
    }
    scheduleGc(key) {
        const existing = this.gcTimers.get(key);
        if (existing)
            clearTimeout(existing);
        const t = setTimeout(() => {
            const cur = this.sessions.get(key);
            if (!cur)
                return;
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
    snapshotForRetire(s) {
        return {
            ...s,
            // Keep the last 20 events for the history detail view; the live pill
            // keeps up to 30 but history doesn't need that much.
            recent: s.recent.slice(0, 20),
        };
    }
    // ---- ETA estimation -----------------------------------------------------
    pushSample(key, t, ctx) {
        let arr = this.rateSamples.get(key);
        if (!arr) {
            arr = [];
            this.rateSamples.set(key, arr);
        }
        arr.push({ t, ctx });
        if (arr.length > StateStore.RATE_SAMPLES)
            arr.shift();
    }
    // Estimate seconds until the context window fills, based on the recent
    // token-consumption rate. Returns undefined when there's not enough data
    // or no limit to project against. This is deliberately crude — it's a
    // "roughly how long" hint, not a deadline.
    computeEta(s) {
        if (s.status !== "working")
            return undefined;
        const ctx = s.usage?.contextTokens;
        const limit = s.usage?.contextLimit;
        if (ctx == null || !limit || limit <= 0)
            return undefined;
        const remaining = limit - ctx;
        if (remaining <= 0)
            return 0;
        const samples = this.rateSamples.get(s.key);
        if (!samples || samples.length < 2)
            return undefined;
        // Linear regression slope: tokens per ms. Use the first and last sample
        // (the rolling window is small enough that a full least-squares fit would
        // be noise, not signal).
        const first = samples[0];
        const last = samples[samples.length - 1];
        const dt = last.t - first.t;
        if (dt <= 0)
            return undefined;
        const dCtx = last.ctx - first.ctx;
        if (dCtx <= 0)
            return undefined; // context shrank (compact/clear) — no slope
        const ratePerMs = dCtx / dt;
        if (ratePerMs <= 0)
            return undefined;
        return Math.round(remaining / ratePerMs / 1000);
    }
    ensureEtaTimer() {
        if (this.etaTimer)
            return;
        this.etaTimer = setInterval(() => {
            let changed = false;
            for (const s of this.sessions.values()) {
                if (s.status !== "working")
                    continue;
                const eta = this.computeEta(s);
                if (eta !== s.etaSeconds) {
                    s.etaSeconds = eta;
                    changed = true;
                }
            }
            if (changed)
                this.emit("state", this.getState());
        }, StateStore.ETA_REFRESH_MS);
        // Don't keep the process alive just for ETA ticks.
        if (this.etaTimer.unref)
            this.etaTimer.unref();
    }
}
exports.StateStore = StateStore;
//# sourceMappingURL=state.js.map