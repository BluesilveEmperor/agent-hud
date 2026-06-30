import { useEffect, useState } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import type {
  SessionState,
  AgentId,
  LightEvent,
  Memo,
  SystemState,
  HooksStatus,
  HookAgentKey,
  Usage,
  Stats,
  SessionRecord,
  NotifyConfig,
  Theme,
  ThemeState,
} from "../types";
import { MediaFull } from "./MediaCard";
import {
  contextColor,
  contextLabel,
  contextPercent,
  contextRatio,
  fmtTokens,
} from "../usage";

const AGENT_LABEL: Record<AgentId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  trae: "Trae",
  opencode: "OpenCode",
  "deveco-code": "DevEco Code",
};

const EVENT_TAG: Record<LightEvent["type"], string> = {
  session_start: "start",
  session_end: "end",
  user_prompt: "prompt",
  tool_use: "tool",
  stop: "stop",
  notification: "note",
  error: "err",
};

interface Props {
  sessions: SessionState[];
  memos: Memo[];
  system: SystemState;
}

function formatDuration(fromIso?: string): string {
  if (!fromIso) return "";
  const ms = Date.now() - new Date(fromIso).getTime();
  if (ms < 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function statusLine(a: SessionState): string {
  switch (a.status) {
    case "idle":
      return "空闲";
    case "working":
      return a.currentTool ? `工作中 · ${a.currentTool}` : "工作中";
    case "done":
      return "刚完成";
    case "error":
      return "出错";
  }
}

export function ExpandPanel({ sessions, memos, system }: Props) {
  const [draft, setDraft] = useState("");

  const allEvents = sessions
    .flatMap((s) => s.recent.map((e) => ({ ...e, _key: s.key, _agent: s.agent })))
    .sort((x, y) => (x.timestamp < y.timestamp ? 1 : -1))
    .slice(0, 14);

  const visibleMemos = memos;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    window.light?.addMemo(t);
    setDraft("");
  };

  return (
    <motion.div
      className="panel"
      variants={PANEL}
      initial="hidden"
      animate="show"
      exit="exit"
    >
      <span className="glass-sheen" aria-hidden="true" />

      <motion.div className="section" variants={ITEM}>
        <div className="section-head">
          <span>状态</span>
        </div>
        <div className="card">
          {sessions.length === 0 ? (
            <div className="empty">暂无活动会话</div>
          ) : (
            sessions.map((a) => (
              <div key={a.key} className="panel-session">
                <div className="panel-row">
                  <span className={`dot ${a.status}`} />
                  <span className="panel-name">{AGENT_LABEL[a.agent]}</span>
                  <span className="session-tag">对话 {a.seq}</span>
                  <span className="sub">{statusLine(a)}</span>
                  <span className="panel-meta">
                    {a.status === "working" && a.startedAt ? formatDuration(a.startedAt) : ""}
                  </span>
                  <button
                    className="row-x"
                    onClick={() => window.light?.removeSession(a.key)}
                    title="从列表移除这个对话"
                    aria-label="移除"
                  >
                    ×
                  </button>
                </div>
                <UsageRow usage={a.usage} />
              </div>
            ))
          )}
        </div>
      </motion.div>

      <motion.div className="section" variants={ITEM}>
        <HooksSection />
      </motion.div>

      <motion.div className="section" variants={ITEM}>
        <NotifySection />
      </motion.div>

      <motion.div className="section" variants={ITEM}>
        <StatsSection />
      </motion.div>

      <motion.div className="section" variants={ITEM}>
        <HistorySection />
      </motion.div>

      <motion.div className="section" variants={ITEM}>
        <ThemeSection />
      </motion.div>

      {system.media && system.media.title && (
        <motion.div className="section" variants={ITEM}>
          <div className="section-head">
            <span>正在播放</span>
          </div>
          <div className="card">
            <MediaFull media={system.media} />
          </div>
        </motion.div>
      )}

      <motion.div className="section" variants={ITEM}>
        <div className="section-head">
          <span>备忘录</span>
          <span className="section-meta">
            {visibleMemos.filter((m) => !m.completed).length} 待办
          </span>
        </div>
        <form className="memo-input" onSubmit={onSubmit}>
          <input
            type="text"
            placeholder="写点什么 · 回车添加"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={200}
          />
        </form>
        <div className="memos">
          <AnimatePresence initial={false}>
            {visibleMemos.map((m) => (
              <MemoRow key={m.id} memo={m} />
            ))}
          </AnimatePresence>
          {visibleMemos.length === 0 && <div className="empty">没有备忘</div>}
        </div>
      </motion.div>

      <motion.div className="section" variants={ITEM}>
        <div className="section-head">
          <span>事件流</span>
          <button
            className="link-btn"
            onClick={() => window.light?.clearEvents()}
            disabled={allEvents.length === 0}
          >
            清空
          </button>
        </div>
        <div className="card">
          <div className="events">
            {allEvents.length === 0 ? (
              <div className="empty">暂无事件</div>
            ) : (
              allEvents.map((e, i) => (
                <div className="evt" key={`${e.timestamp}-${i}`}>
                  <span className="evt-time">{formatTime(e.timestamp)}</span>
                  <span className="evt-tag">{EVENT_TAG[e.type]}</span>
                  <span className="evt-text">
                    {e.tool ?? e.message ?? AGENT_LABEL[e._agent as AgentId]}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

const HOOK_AGENTS: { key: HookAgentKey; label: string }[] = [
  { key: "claude", label: "Claude Code" },
  { key: "codex", label: "Codex" },
  { key: "opencode", label: "OpenCode" },
  { key: "deveco", label: "DevEco Code" },
];

// In-app one-click hook setup. Light can only *receive* events, so each agent
// has to call our forwarding script from its own config. This merges that in
// safely (never overwrites the user's other settings).
function HooksSection() {
  const [status, setStatus] = useState<HooksStatus | null>(null);
  const [busy, setBusy] = useState<HookAgentKey | "all" | null>(null);
  const [note, setNote] = useState<string>("");

  const refresh = () => {
    window.light?.getHooksStatus().then(setStatus).catch(() => {});
  };
  useEffect(refresh, []);

  const install = async (agent: HookAgentKey | "all") => {
    if (!window.light?.installHooks || busy) return;
    setBusy(agent);
    setNote("");
    try {
      const res = await window.light.installHooks(agent);
      setStatus(res.status);
      setNote(res.message);
    } catch {
      setNote("接入失败，请重试");
    } finally {
      setBusy(null);
    }
  };

  const allInstalled =
    !!status?.claude.installed &&
    !!status?.codex.installed &&
    !!status?.opencode.installed &&
    !!status?.deveco.installed;

  return (
    <>
      <div className="section-head">
        <span>接入 Agent</span>
        <button
          className="link-btn"
          onClick={() => install("all")}
          disabled={!status?.ready || busy !== null || allInstalled}
        >
          {allInstalled ? "已全部接入" : busy === "all" ? "接入中…" : "一键接入"}
        </button>
      </div>
      <div className="card">
        {!status ? (
          <div className="empty">检测中…</div>
        ) : !status.ready ? (
          <div className="empty">找不到 hooks 脚本目录</div>
        ) : (
          HOOK_AGENTS.map(({ key, label }) => {
            const st = status[key];
            const state = st.installed ? "ok" : st.needsUpdate ? "warn" : "off";
            const stateText =
              state === "ok" ? "已接入" : state === "warn" ? "需更新路径" : "未接入";
            return (
              <div key={key} className="panel-row hook-row">
                <span className={`hook-dot ${state}`} />
                <span className="panel-name">{label}</span>
                <span className="sub hook-state">{stateText}</span>
                <button
                  className="hook-btn"
                  onClick={() => install(key)}
                  disabled={busy !== null || st.installed}
                >
                  {busy === key ? "…" : st.installed ? "✓" : st.needsUpdate ? "更新" : "接入"}
                </button>
              </div>
            );
          })
        )}
      </div>
      {note && <div className="hook-note">{note}</div>}
    </>
  );
}

// ---- Notification settings -------------------------------------------------

function NotifySection() {
  const [cfg, setCfg] = useState<NotifyConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const refresh = () => { window.light?.getNotifyConfig().then(setCfg).catch(() => {}); };
  useEffect(() => { refresh(); }, []);

  const update = (patch: Partial<NotifyConfig>) => {
    if (!window.light?.setNotifyConfig) return;
    window.light.setNotifyConfig(patch).then((next) => setCfg(next));
  };

  const test = async () => {
    if (!window.light?.testNotify || busy) return;
    setBusy(true);
    setNote("");
    try {
      const r = await window.light.testNotify();
      setNote(r.os || r.webhook ? `测试已发送（系统通知 ${r.os ? "✓" : "✗"} · webhook ${r.webhook ? "✓" : "✗"}）` : "测试失败");
    } catch {
      setNote("测试失败");
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return null;
  return (
    <>
      <div className="section-head">
        <span>通知设置</span>
        <button className="link-btn" onClick={test} disabled={busy}>
          {busy ? "发送中…" : "测试"}
        </button>
      </div>
      <div className="card">
        <div className="panel-row hook-row">
          <span className="panel-name">系统通知</span>
          <span className="sub hook-state">{cfg.osEnabled ? "开启" : "关闭"}</span>
          <button
            className="hook-btn"
            onClick={() => update({ osEnabled: !cfg.osEnabled })}
          >
            {cfg.osEnabled ? "✓" : "开"}
          </button>
        </div>
        <div className="panel-row hook-row">
          <span className="panel-name">Webhook</span>
          <span className="sub hook-state">{cfg.webhookEnabled ? "开启" : "关闭"}</span>
          <button
            className="hook-btn"
            onClick={() => update({ webhookEnabled: !cfg.webhookEnabled })}
          >
            {cfg.webhookEnabled ? "✓" : "开"}
          </button>
        </div>
        {cfg.webhookEnabled && (
          <input
            className="notify-url"
            type="text"
            placeholder="https://… （企业微信/飞书/Slack/自建）"
            value={cfg.webhookUrl}
            onChange={(e) => update({ webhookUrl: e.target.value })}
          />
        )}
      </div>
      {note && <div className="hook-note">{note}</div>}
    </>
  );
}

// ---- Stats (Agent behaviour analysis) --------------------------------------

function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

function fmtTok(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function StatsSection() {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    const refresh = () => { window.light?.getStats().then(setStats).catch(() => {}); };
    refresh();
    return window.light?.onHistoryUpdated(() => refresh());
  }, []);

  if (!stats || stats.totalSessions === 0) {
    return (
      <>
        <div className="section-head"><span>统计 · 今日</span></div>
        <div className="card"><div className="empty">暂无数据</div></div>
      </>
    );
  }

  const maxTokens = Math.max(1, ...stats.agents.map((a) => a.totalTokens));
  return (
    <>
      <div className="section-head">
        <span>统计 · 今日</span>
        <span className="section-meta">
          {stats.totalSessions} 会话 · {fmtTok(stats.totalTokens)} tokens · {fmtDur(stats.totalDurationMs)}
        </span>
      </div>
      <div className="card">
        {stats.agents.map((a) => (
          <div key={a.agent} className="stats-agent">
            <div className="panel-row">
              <span className={`dot ${a.errorCount > 0 ? "error" : "done"}`} />
              <span className="panel-name">{AGENT_LABEL[a.agent]}</span>
              <span className="sub">{a.sessionCount} 会话{a.errorCount > 0 ? ` · ${a.errorCount} 错` : ""}</span>
              <span className="panel-meta">{fmtDur(a.totalDurationMs)}</span>
            </div>
            <div className="stats-bar-row">
              <div className="stats-bar">
                <div
                  className="stats-bar-fill"
                  style={{ width: `${(a.totalTokens / maxTokens) * 100}%` }}
                />
              </div>
              <span className="stats-bar-label">{fmtTok(a.totalTokens)}</span>
            </div>
            {a.topTools.length > 0 && (
              <div className="stats-tools">
                {a.topTools.slice(0, 4).map((t) => (
                  <span key={t.tool} className="stats-tool-chip">{t.tool} ×{t.count}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ---- History ----------------------------------------------------------------

function HistorySection() {
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      window.light?.getHistory({ since: today.toISOString(), limit: 30 }).then(setRecords).catch(() => {});
    };
    refresh();
    return window.light?.onHistoryUpdated(() => refresh());
  }, []);

  if (records.length === 0) {
    return (
      <>
        <div className="section-head"><span>历史 · 今日</span></div>
        <div className="card"><div className="empty">暂无历史记录</div></div>
      </>
    );
  }

  return (
    <>
      <div className="section-head">
        <span>历史 · 今日</span>
        <span className="section-meta">{records.length} 条</span>
      </div>
      <div className="card">
        {records.map((r) => {
          const isOpen = expanded === r.id;
          const time = r.startedAt ? formatTime(r.startedAt) : formatTime(r.endedAt);
          return (
            <div key={r.id} className="hist-row-wrap">
              <div
                className="panel-row hist-row"
                onClick={() => setExpanded(isOpen ? null : r.id)}
              >
                <span className={`dot ${r.status}`} />
                <span className="panel-name">{AGENT_LABEL[r.agent]}</span>
                <span className="hist-time">{time}</span>
                <span className="sub hist-prompt">{r.prompt || "(无提示)"}</span>
                <span className="panel-meta">
                  {r.durationMs ? fmtDur(r.durationMs) : ""}
                  {r.usage?.totalTokens ? ` · ${fmtTok(r.usage.totalTokens)}` : ""}
                </span>
              </div>
              {isOpen && (
                <div className="hist-detail">
                  {r.error && <div className="hist-err">错误：{r.error}</div>}
                  <div className="hist-meta">
                    {r.toolCount > 0 && <span>工具调用 {r.toolCount} 次</span>}
                    {r.usage?.contextTokens != null && (
                      <span>上下文 {fmtTok(r.usage.contextTokens)}{r.usage.contextLimit ? ` / ${fmtTok(r.usage.contextLimit)}` : ""}</span>
                    )}
                    {r.usage?.model && <span className="hist-model">{r.usage.model}</span>}
                  </div>
                  {Object.keys(r.tools).length > 0 && (
                    <div className="stats-tools">
                      {Object.entries(r.tools).map(([tool, count]) => (
                        <span key={tool} className="stats-tool-chip">{tool} ×{count}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---- Theme switcher --------------------------------------------------------

function ThemeSection() {
  const [state, setState] = useState<ThemeState | null>(null);
  useEffect(() => {
    window.light?.getTheme().then(setState).catch(() => {});
    return window.light?.onTheme((t) => setState(t));
  }, []);

  const pick = (t: Theme) => window.light?.setTheme(t).then(setState);

  const opts: { key: Theme; label: string }[] = [
    { key: "dark", label: "深色" },
    { key: "light", label: "浅色" },
    { key: "auto", label: "跟随系统" },
  ];

  return (
    <>
      <div className="section-head"><span>主题</span></div>
      <div className="theme-row">
        {opts.map((o) => (
          <button
            key={o.key}
            className={`theme-btn ${state?.theme === o.key ? "active" : ""}`}
            onClick={() => pick(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </>
  );
}

// Staggered spring reveal: the panel springs down, then each section settles
// in just behind it. Keeps the open feel "alive" without being slow.
const PANEL: Variants = {
  hidden: { opacity: 0, y: -10, scale: 0.965 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 330,
      damping: 27,
      staggerChildren: 0.05,
      delayChildren: 0.05,
    },
  },
  exit: { opacity: 0, y: -10, scale: 0.965, transition: { duration: 0.16 } },
};

const ITEM: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
};

// Token + context usage for one session. Renders a progress bar for the
// context window fill plus a compact stat line (current/limit, this-turn
// output, session total, model). Hidden entirely when no usage has been
// reported yet — some agents (e.g. Codex) may never send one.
function UsageRow({ usage }: { usage?: Usage }) {
  if (!usage) return null;
  const hasCtx = usage.contextTokens != null;
  const hasTotal = usage.totalTokens != null;
  const hasOut = usage.outputTokens != null;
  const hasModel = !!usage.model;
  if (!hasCtx && !hasTotal && !hasOut && !hasModel) return null;

  const ratio = contextRatio(usage);
  const showBar = ratio != null;

  return (
    <div className="usage-row">
      {showBar && (
        <div className="usage-bar" title={`上下文 ${contextLabel(usage)}`}>
          <div
            className="usage-bar-fill"
            style={{
              width: `${Math.round(ratio * 100)}%`,
              background: contextColor(usage),
            }}
          />
        </div>
      )}
      <div className="usage-stats">
        {hasCtx && (
          <span className="usage-stat">
            上下文 <strong>{fmtTokens(usage.contextTokens)}</strong>
            {usage.contextLimit ? ` / ${fmtTokens(usage.contextLimit)}` : ""}
            {showBar && <span className="usage-pct">{contextPercent(usage)}</span>}
          </span>
        )}
        {hasOut && (
          <span className="usage-stat">
            本次输出 <strong>{fmtTokens(usage.outputTokens)}</strong>
          </span>
        )}
        {hasTotal && (
          <span className="usage-stat">
            累计 <strong>{fmtTokens(usage.totalTokens)}</strong>
          </span>
        )}
        {hasModel && <span className="usage-model">{usage.model}</span>}
      </div>
    </div>
  );
}

function MemoRow({ memo }: { memo: Memo }) {
  const handleToggle = () => {
    window.light?.toggleMemo(memo.id);
    if (!memo.completed) {
      setTimeout(() => window.light?.deleteMemo(memo.id), 1200);
    }
  };

  return (
    <motion.div
      className={`memo ${memo.completed ? "completed" : ""}`}
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: memo.completed ? 0.45 : 1, height: "auto" }}
      exit={{ opacity: 0, height: 0, x: 40 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <button
        className={`memo-check ${memo.completed ? "on" : ""}`}
        onClick={handleToggle}
        aria-label={memo.completed ? "uncheck" : "complete"}
      >
        {memo.completed && (
          <svg viewBox="0 0 24 24" width="11" height="11">
            <path
              d="M5 12.5l4.2 4.2L19 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      <span className="memo-text">{memo.text}</span>
      <button className="memo-x" onClick={() => window.light?.deleteMemo(memo.id)} title="删除">
        ×
      </button>
    </motion.div>
  );
}
