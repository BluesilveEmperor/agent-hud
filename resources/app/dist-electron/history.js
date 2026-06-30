"use strict";
// Persistent session history + aggregate stats.
//
// Events flow through StateStore and are also handed to this module, which
// writes a compact summary per session to userData/history.jsonl (append-only,
// one JSON object per line). The live StateStore only keeps *active* sessions;
// this is the long-term memory that powers the "history" panel and the
// "stats" panel.
//
// Design notes:
//  - jsonl, not SQLite. No native deps, trivial to read/rotate, and the write
//    volume is low (a handful of lines per session). A single file is fine up
//    to ~100k sessions; we prune to the last 30 days on startup.
//  - We only record *completed* sessions (those that hit done/error/idle and
//    then were retired). Recording every event would explode the file; the
//    event detail we keep is the last few tool/prompt events + the final
//    usage snapshot.
//  - Stats are computed on demand from the jsonl, not maintained as a counter.
//    For a single user's volume this is sub-millisecond.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryStore = void 0;
const node_events_1 = require("node:events");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const RETENTION_DAYS = 30;
const TAIL_LIMIT = 5000; // keep at most this many recent records
class HistoryStore extends node_events_1.EventEmitter {
    filePath;
    // In-memory cache of recent records (newest last). Rebuilt on load, appended
    // to on record(). Querying reads from this — no file scan per query.
    records = [];
    writing = false;
    pendingWrite = [];
    constructor(filePath) {
        super();
        this.filePath = filePath;
        this.load();
    }
    load() {
        try {
            if (!node_fs_1.default.existsSync(this.filePath))
                return;
            const raw = node_fs_1.default.readFileSync(this.filePath, "utf8");
            const lines = raw.split(/\r?\n/);
            const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
            const kept = [];
            for (const line of lines) {
                const t = line.trim();
                if (!t)
                    continue;
                let rec;
                try {
                    rec = JSON.parse(t);
                }
                catch {
                    continue;
                }
                if (!rec || typeof rec !== "object" || !rec.endedAt)
                    continue;
                // Drop records older than the retention window while loading — this
                // is the only place we prune, so the file gradually self-cleans.
                if (new Date(rec.endedAt).getTime() < cutoff)
                    continue;
                kept.push(rec);
            }
            this.records = kept.slice(-TAIL_LIMIT);
            // If we pruned anything, rewrite the file compactly so it doesn't grow
            // forever. (Best-effort; ignore failures.)
            if (this.records.length < lines.filter((l) => l.trim()).length) {
                this.rewriteFile();
            }
        }
        catch (err) {
            console.error("[history] load failed:", err);
            this.records = [];
        }
    }
    rewriteFile() {
        try {
            const dir = node_path_1.default.dirname(this.filePath);
            node_fs_1.default.mkdirSync(dir, { recursive: true });
            const body = this.records.map((r) => JSON.stringify(r)).join("\n") + "\n";
            const tmp = this.filePath + ".tmp";
            node_fs_1.default.writeFileSync(tmp, body, "utf8");
            node_fs_1.default.renameSync(tmp, this.filePath);
        }
        catch (err) {
            console.error("[history] rewrite failed:", err);
        }
    }
    append(rec) {
        this.records.push(rec);
        if (this.records.length > TAIL_LIMIT) {
            this.records = this.records.slice(-TAIL_LIMIT);
        }
        this.pendingWrite.push(rec);
        this.flush();
    }
    flush() {
        if (this.writing || this.pendingWrite.length === 0)
            return;
        this.writing = true;
        const batch = this.pendingWrite;
        this.pendingWrite = [];
        const lines = batch.map((r) => JSON.stringify(r)).join("\n") + "\n";
        node_fs_1.default.appendFile(this.filePath, lines, "utf8", (err) => {
            this.writing = false;
            if (err)
                console.error("[history] append failed:", err);
            if (this.pendingWrite.length > 0)
                this.flush();
        });
    }
    // Called by main.ts when a session is retired. We snapshot its final state
    // into a SessionRecord. `events` are the session's recent events (capped);
    // `usage` / `status` / `startedAt` come from the live session right before
    // it's dropped.
    record(input) {
        const tools = {};
        let toolCount = 0;
        for (const e of input.events) {
            if (e.type === "tool_use" && e.tool) {
                tools[e.tool] = (tools[e.tool] ?? 0) + 1;
                toolCount++;
            }
        }
        const rec = {
            id: `${input.agent}::${input.sessionId}::${input.startedAt ?? input.endedAt}`,
            agent: input.agent,
            sessionId: input.sessionId,
            seq: input.seq,
            prompt: input.prompt,
            startedAt: input.startedAt,
            endedAt: input.endedAt,
            durationMs: input.durationMs,
            status: input.status,
            toolCount,
            tools,
            usage: input.usage,
            error: input.error,
        };
        this.append(rec);
        this.emit("record", rec);
    }
    query(q = {}) {
        let out = this.records;
        if (q.agent)
            out = out.filter((r) => r.agent === q.agent);
        if (q.since) {
            const t = new Date(q.since).getTime();
            out = out.filter((r) => new Date(r.endedAt).getTime() >= t);
        }
        if (q.until) {
            const t = new Date(q.until).getTime();
            out = out.filter((r) => new Date(r.endedAt).getTime() < t);
        }
        // Newest first.
        out = [...out].sort((a, b) => (a.endedAt < b.endedAt ? 1 : -1));
        if (q.limit && q.limit > 0)
            out = out.slice(0, q.limit);
        return out;
    }
    // Compute aggregate stats over a time window. Default = today (local).
    stats(opts = {}) {
        const now = new Date();
        const until = opts.until ?? now.toISOString();
        const since = opts.since ?? startOfToday();
        const records = this.query({ since, until });
        const byAgent = new Map();
        const toolTotals = new Map();
        let totalTokens = 0;
        let totalDurationMs = 0;
        let totalErrors = 0;
        for (const r of records) {
            let s = byAgent.get(r.agent);
            if (!s) {
                s = {
                    agent: r.agent,
                    sessionCount: 0,
                    errorCount: 0,
                    totalDurationMs: 0,
                    totalTokens: 0,
                    toolCount: 0,
                    topTools: [],
                };
                byAgent.set(r.agent, s);
            }
            s.sessionCount++;
            if (r.status === "error") {
                s.errorCount++;
                totalErrors++;
            }
            if (r.durationMs) {
                s.totalDurationMs += r.durationMs;
                totalDurationMs += r.durationMs;
            }
            if (r.usage?.totalTokens) {
                s.totalTokens += r.usage.totalTokens;
                totalTokens += r.usage.totalTokens;
            }
            if (r.usage?.contextTokens) {
                // running average of context size at session end
                s.avgContextTokens = s.avgContextTokens == null
                    ? r.usage.contextTokens
                    : (s.avgContextTokens * (s.sessionCount - 1) + r.usage.contextTokens) / s.sessionCount;
            }
            s.toolCount += r.toolCount;
            for (const [tool, count] of Object.entries(r.tools)) {
                toolTotals.set(tool, (toolTotals.get(tool) ?? 0) + count);
            }
        }
        const topTools = [...toolTotals.entries()]
            .map(([tool, count]) => ({ tool, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        for (const s of byAgent.values()) {
            s.topTools = [...toolTotals.entries()]
                .filter(([tool]) => records.some((r) => r.agent === s.agent && r.tools[tool]))
                .map(([tool, count]) => ({ tool, count: records.filter((r) => r.agent === s.agent).reduce((n, r) => n + (r.tools[tool] ?? 0), 0) }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);
        }
        return {
            since,
            until,
            agents: [...byAgent.values()].sort((a, b) => b.sessionCount - a.sessionCount),
            totalSessions: records.length,
            totalErrors,
            totalTokens,
            totalDurationMs,
            topTools,
        };
    }
}
exports.HistoryStore = HistoryStore;
function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
}
//# sourceMappingURL=history.js.map