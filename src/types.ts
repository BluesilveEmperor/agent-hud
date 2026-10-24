export type AgentId =
  | "claude-code"
  | "codex"
  | "trae"
  | "opencode"
  | "deveco-code"
  | "codearts"
  | "workbuddy"
  | "hermes";

export type AgentStatus = "idle" | "working" | "done" | "error";

export type EventType =
  | "session_start"
  | "session_end"
  | "user_prompt"
  | "tool_use"
  | "stop"
  | "notification"
  | "error";

export interface Usage {
  contextTokens?: number;
  contextLimit?: number;
  outputTokens?: number;
  totalTokens?: number;
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
  // True when a tool_use event was detected as a WSL invocation.
  wsl?: boolean;
  // The command that runs inside WSL (parsed by detectWsl), for stats.
  wslCommand?: string;
}

export interface SessionState {
  key: string;
  agent: AgentId;
  sessionId: string;
  seq: number;
  status: AgentStatus;
  currentTool?: string;
  lastPrompt?: string;
  lastEventAt: string;
  startedAt?: string;
  recent: LightEvent[];
  usage?: Usage;
  etaSeconds?: number;
  // Live WSL invocation info while the agent is (or last was) running a
  // `wsl ...` command.
  wsl?: {
    command: string;
    distro?: string;
    startedAt: string;
    // Estimated total duration from historical averages of the same command.
    estimatedTotalMs?: number;
  };
}

export interface AppState {
  sessions: SessionState[];
}

export interface Memo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string;
}

export interface MediaState {
  playing: boolean;
  title: string;
  artist: string;
  app: string;
  icon?: string;
  updatedAt: string;
}

export interface SystemState {
  media: MediaState | null;
  bridgeReady: boolean;
}

export type MediaAction = "next" | "prev" | "playpause" | "play" | "pause";

export interface HotZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type HookAgentKey =
  | "claude"
  | "codex"
  | "opencode"
  | "deveco"
  | "codearts"
  | "workbuddy"
  | "hermes";

export interface AgentHookStatus {
  agent: HookAgentKey;
  configPath: string;
  configExists: boolean;
  installed: boolean;
  needsUpdate: boolean;
}

export interface HooksStatus {
  hooksDir: string | null;
  ready: boolean;
  claude: AgentHookStatus;
  codex: AgentHookStatus;
  opencode: AgentHookStatus;
  deveco: AgentHookStatus;
  codearts: AgentHookStatus;
  workbuddy: AgentHookStatus;
  hermes: AgentHookStatus;
}

export interface HooksInstallResult {
  ok: boolean;
  message: string;
  status: HooksStatus;
}

// A finished session, as read back from the history store. Mirrors the
// SessionRecord shape in electron/history.ts.
export interface SessionRecord {
  id: string;
  agent: AgentId;
  sessionId: string;
  seq: number;
  prompt?: string;
  startedAt?: string;
  endedAt: string;
  durationMs?: number;
  status: "done" | "error" | "idle";
  toolCount: number;
  tools: Record<string, number>;
  usage?: Usage;
  error?: string;
  wslCount: number;
  wslCommands: Record<string, number>;
  wslCommandDurations: Record<string, number>;
  wslDurationMs: number;
}

export interface HistoryQuery {
  agent?: AgentId;
  since?: string;
  until?: string;
  limit?: number;
}

export interface AgentStats {
  agent: AgentId;
  sessionCount: number;
  errorCount: number;
  totalDurationMs: number;
  totalTokens: number;
  avgContextTokens?: number;
  toolCount: number;
  topTools: { tool: string; count: number }[];
  wslCount: number;
  wslDurationMs: number;
  topWslCommands: { tool: string; count: number }[];
}

export interface Stats {
  since: string;
  until: string;
  agents: AgentStats[];
  totalSessions: number;
  totalErrors: number;
  totalTokens: number;
  totalDurationMs: number;
  topTools: { tool: string; count: number }[];
  totalWslCount: number;
  totalWslDurationMs: number;
  topWslCommands: { tool: string; count: number }[];
}

export interface NotifyConfig {
  osEnabled: boolean;
  webhookEnabled: boolean;
  webhookUrl: string;
  minDurationMs: number;
}

export interface NotifyTestResult {
  os: boolean;
  webhook: boolean;
  error?: string;
}

export type Theme = "light" | "dark" | "auto";
export type EffectiveTheme = "light" | "dark";

export interface ThemeState {
  theme: Theme;
  effective: EffectiveTheme;
}

declare global {
  interface Window {
    light: {
      onEvent: (cb: (evt: LightEvent) => void) => () => void;
      onState: (cb: (state: AppState) => void) => () => void;
      onMemos: (cb: (memos: Memo[]) => void) => () => void;
      onSystem: (cb: (state: SystemState) => void) => () => void;
      onBlur: (cb: () => void) => () => void;
      // Cursor-over-hotzone signal from the main process. Optional: only the
      // real Electron bridge provides it; the browser dev mock relies on DOM
      // mouse events instead.
      onHover?: (cb: (over: boolean) => void) => () => void;
      getState: () => Promise<AppState>;
      getMemos: () => Promise<Memo[]>;
      getSystem: () => Promise<SystemState>;
      addMemo: (text: string) => void;
      toggleMemo: (id: string) => void;
      deleteMemo: (id: string) => void;
      clearEvents: () => void;
      removeSession: (key: string) => void;
      getHooksStatus: () => Promise<HooksStatus>;
      installHooks: (agent: HookAgentKey | "all") => Promise<HooksInstallResult>;
      uninstallHooks: (agent: HookAgentKey | "all") => Promise<HooksInstallResult>;
      getHistory: (q?: HistoryQuery) => Promise<SessionRecord[]>;
      getStats: (opts?: { since?: string; until?: string }) => Promise<Stats | null>;
      getNotifyConfig: () => Promise<NotifyConfig>;
      setNotifyConfig: (patch: Partial<NotifyConfig>) => Promise<NotifyConfig>;
      testNotify: () => Promise<NotifyTestResult>;
      getTheme: () => Promise<ThemeState>;
      setTheme: (t: Theme) => Promise<ThemeState>;
      onTheme: (cb: (t: ThemeState) => void) => () => void;
      onHistoryUpdated: (cb: () => void) => () => void;
      mediaControl: (action: MediaAction) => void;
      setHotZones: (zones: HotZone[]) => void;
      // Input lease for the click-through poll (see electron/main.ts).
      setInputBusy: (busy: { pointer: boolean; focus: boolean }) => void;
      quit: () => void;
    };
  }
}
