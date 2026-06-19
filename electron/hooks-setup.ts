// One-click hook installer for the in-app "接入 Claude / Codex" feature.
//
// Light only *receives* events — it can't probe what an agent is doing. Each
// agent must call our forwarding script from its own hooks config:
//   Claude Code → ~/.claude/settings.json
//   Codex CLI   → ~/.codex/hooks.json
//
// This module wires that up for the user with a single click. It MERGES into
// the existing config (never overwrites): it preserves every other key and the
// user's own hook entries, and only ever replaces *our* previous entries
// (matched by the hook script filename), so re-running it after a reinstall or
// path change is safe and idempotent. A `.light-backup` copy is written before
// every change.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type AgentKey = "claude" | "codex";
export type InstallTarget = AgentKey | "both";

export interface AgentHookStatus {
  agent: AgentKey;
  configPath: string;
  configExists: boolean;
  // Wired to *this* install's hooks directory (everything in place).
  installed: boolean;
  // Our script is referenced, but from a different path (e.g. an old install).
  needsUpdate: boolean;
}

export interface HooksStatus {
  hooksDir: string | null;
  // hooksDir resolved and the hook scripts are actually present.
  ready: boolean;
  claude: AgentHookStatus;
  codex: AgentHookStatus;
}

export interface InstallResult {
  ok: boolean;
  message: string;
  status: HooksStatus;
}

interface HookEventSpec {
  event: string; // e.g. "SessionStart"
  type: string; // CLI arg we pass to the hook script, e.g. "session_start"
  matcher?: string; // omitted → no matcher key
}

interface AgentConfig {
  agent: AgentKey;
  label: string;
  script: string; // "claude-hook.mjs"
  configPath: string;
  specs: HookEventSpec[];
}

// ---- locating the bundled hook scripts ------------------------------------

// dev      → <repo>/hooks                       (__dirname = <repo>/dist-electron)
// packaged → <install>/hooks                    (__dirname = <install>/resources/app/dist-electron)
function resolveHooksDir(): string | null {
  const candidates = [
    path.join(__dirname, "..", "hooks"),
    path.join(__dirname, "..", "..", "..", "hooks"),
  ];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "..", "hooks"));
  }
  for (const dir of candidates) {
    try {
      if (
        fs.existsSync(path.join(dir, "claude-hook.mjs")) ||
        fs.existsSync(path.join(dir, "codex-hook.mjs"))
      ) {
        return path.resolve(dir);
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}
function codexDir(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function agentConfigs(): Record<AgentKey, AgentConfig> {
  return {
    claude: {
      agent: "claude",
      label: "Claude Code",
      script: "claude-hook.mjs",
      configPath: path.join(claudeDir(), "settings.json"),
      specs: [
        { event: "SessionStart", type: "session_start" },
        { event: "SessionEnd", type: "session_end" },
        { event: "UserPromptSubmit", type: "user_prompt" },
        { event: "PreToolUse", type: "tool_use", matcher: "*" },
        { event: "Stop", type: "stop" },
      ],
    },
    codex: {
      agent: "codex",
      label: "Codex",
      script: "codex-hook.mjs",
      configPath: path.join(codexDir(), "hooks.json"),
      specs: [
        { event: "SessionStart", type: "session_start", matcher: "startup|resume|clear|compact" },
        { event: "UserPromptSubmit", type: "user_prompt" },
        { event: "PreToolUse", type: "tool_use", matcher: "*" },
        { event: "Stop", type: "stop" },
      ],
    },
  };
}

// ---- command building / matching ------------------------------------------

// Forward slashes work for node on every platform and dodge JSON/`\` escaping
// and Windows shell-quoting headaches (this is what hooks/README recommends).
function buildCommand(hooksDir: string, script: string, type: string): string {
  const p = hooksDir.replace(/\\/g, "/");
  return `node "${p}/${script}" ${type}`;
}

function norm(s: string): string {
  return s.replace(/\\/g, "/").toLowerCase();
}

// Does this command invoke our script at all (any install path)?
function commandIsOurs(command: unknown, script: string): boolean {
  return typeof command === "string" && norm(command).includes(norm(script));
}

// Does this command invoke our script from *this* hooksDir for this event type?
function commandMatchesHere(
  command: unknown,
  hooksDir: string,
  script: string,
  type: string,
): boolean {
  if (typeof command !== "string") return false;
  const c = norm(command);
  return c.includes(norm(`${hooksDir}/${script}`)) && new RegExp(`(^|\\s)${type}(\\s|$)`).test(c);
}

interface HookGroup {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
}

function groupReferencesScript(group: unknown, script: string): boolean {
  const g = group as HookGroup;
  return Array.isArray(g?.hooks) && g.hooks.some((h) => commandIsOurs(h?.command, script));
}

// ---- status ---------------------------------------------------------------

function readJson(filePath: string): { ok: true; value: unknown } | { ok: false } {
  try {
    if (!fs.existsSync(filePath)) return { ok: true, value: undefined };
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return { ok: true, value: {} };
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function agentStatus(cfg: AgentConfig, hooksDir: string | null): AgentHookStatus {
  const configExists = (() => {
    try {
      return fs.existsSync(cfg.configPath);
    } catch {
      return false;
    }
  })();

  const base: AgentHookStatus = {
    agent: cfg.agent,
    configPath: cfg.configPath,
    configExists,
    installed: false,
    needsUpdate: false,
  };
  if (!hooksDir || !configExists) return base;

  const read = readJson(cfg.configPath);
  if (!read.ok || !read.value || typeof read.value !== "object") return base;
  const hooks = (read.value as { hooks?: Record<string, unknown> }).hooks;
  if (!hooks || typeof hooks !== "object") return base;

  let referenced = false;
  const allHere = cfg.specs.every((spec) => {
    const arr = (hooks as Record<string, unknown>)[spec.event];
    if (!Array.isArray(arr)) return false;
    let hereForSpec = false;
    for (const group of arr) {
      const g = group as HookGroup;
      if (!Array.isArray(g?.hooks)) continue;
      for (const h of g.hooks) {
        if (commandIsOurs(h?.command, cfg.script)) referenced = true;
        if (commandMatchesHere(h?.command, hooksDir, cfg.script, spec.type)) hereForSpec = true;
      }
    }
    return hereForSpec;
  });

  base.installed = allHere;
  base.needsUpdate = !allHere && referenced;
  return base;
}

export function getHooksStatus(): HooksStatus {
  const hooksDir = resolveHooksDir();
  const cfgs = agentConfigs();
  return {
    hooksDir,
    ready: hooksDir != null,
    claude: agentStatus(cfgs.claude, hooksDir),
    codex: agentStatus(cfgs.codex, hooksDir),
  };
}

// ---- install (safe merge) -------------------------------------------------

function writeAtomic(filePath: string, contents: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  // Back up the pre-change file so the user always has a recovery copy.
  try {
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, filePath + ".light-backup");
    }
  } catch {
    /* backup is best-effort */
  }
  const tmp = filePath + ".light-tmp";
  fs.writeFileSync(tmp, contents, "utf8");
  fs.renameSync(tmp, filePath);
}

function installOne(cfg: AgentConfig, hooksDir: string): { ok: boolean; message: string } {
  const read = readJson(cfg.configPath);
  if (!read.ok) {
    return { ok: false, message: `${cfg.label}：现有配置无法解析为 JSON，已跳过（未做改动）` };
  }

  let root = read.value;
  if (root === undefined) root = {};
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return { ok: false, message: `${cfg.label}：配置文件格式异常，已跳过（未做改动）` };
  }
  const config = root as { hooks?: unknown };

  if (config.hooks === undefined) config.hooks = {};
  if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) {
    return { ok: false, message: `${cfg.label}：hooks 字段格式异常，已跳过（未做改动）` };
  }
  const hooks = config.hooks as Record<string, unknown>;

  for (const spec of cfg.specs) {
    const existing = Array.isArray(hooks[spec.event]) ? (hooks[spec.event] as unknown[]) : [];
    // Drop only our own previous entries; keep every other group untouched.
    const cleaned = existing.filter((group) => !groupReferencesScript(group, cfg.script));
    const group: HookGroup = {
      hooks: [{ type: "command", command: buildCommand(hooksDir, cfg.script, spec.type) }],
    };
    if (spec.matcher !== undefined) group.matcher = spec.matcher;
    cleaned.push(group);
    hooks[spec.event] = cleaned;
  }

  try {
    writeAtomic(cfg.configPath, JSON.stringify(config, null, 2) + "\n");
  } catch (err) {
    return {
      ok: false,
      message: `${cfg.label}：写入失败 — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: true, message: `${cfg.label} 已接入，重启 ${cfg.label} 后生效` };
}

export function installHooks(target: InstallTarget): InstallResult {
  const hooksDir = resolveHooksDir();
  if (!hooksDir) {
    return {
      ok: false,
      message: "找不到 hooks 脚本目录，无法接入（请确认安装完整）",
      status: getHooksStatus(),
    };
  }

  const cfgs = agentConfigs();
  const targets: AgentKey[] = target === "both" ? ["claude", "codex"] : [target];
  const messages: string[] = [];
  let allOk = true;
  for (const key of targets) {
    const r = installOne(cfgs[key], hooksDir);
    if (!r.ok) allOk = false;
    messages.push(r.message);
  }

  return { ok: allOk, message: messages.join("；"), status: getHooksStatus() };
}
