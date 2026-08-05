// One-click installer for the in-app "接入 Agent" feature.
//
// Two install modes:
//   - "hooks-json": Claude Code / Codex — MERGE hook entries into the agent's
//     JSON config (~/.claude/settings.json, ~/.codex/hooks.json).
//   - "plugin": OpenCode / DevEco Code — COPY the light-hud.js plugin into
//     the agent's plugins directory (~/.config/opencode/plugins/,
//     ~/.config/deveco/plugins/). OpenCode auto-loads plugins at startup, so
//     no config entry is needed.
//
// Both modes are safe & idempotent: they only replace *our own* previous
// entries / files (matched by hook-script name, or by a marker comment for
// plugins), preserve everything else, and write a `.light-backup` copy before
// any change.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type AgentKey = "claude" | "codex" | "opencode" | "deveco";
export type InstallTarget = AgentKey | "all" | "both";

export interface AgentHookStatus {
  agent: AgentKey;
  configPath: string;
  configExists: boolean;
  // Wired to *this* install's hooks directory (everything in place).
  installed: boolean;
  // Our script/plugin is referenced, but from a different path / older version.
  needsUpdate: boolean;
}

export interface HooksStatus {
  hooksDir: string | null;
  // hooksDir resolved and the hook scripts are actually present.
  ready: boolean;
  claude: AgentHookStatus;
  codex: AgentHookStatus;
  opencode: AgentHookStatus;
  deveco: AgentHookStatus;
}

export interface InstallResult {
  ok: boolean;
  message: string;
  status: HooksStatus;
}

type InstallMode = "hooks-json" | "plugin";

interface HookEventSpec {
  event: string; // e.g. "SessionStart"
  type: string; // CLI arg we pass to the hook script, e.g. "session_start"
  matcher?: string; // omitted → no matcher key
}

interface AgentConfig {
  agent: AgentKey;
  label: string;
  mode: InstallMode;
  // hooks-json: the hook script filename ("claude-hook.mjs")
  // plugin: the source plugin file relative to hooksDir ("opencode/light-hud.js")
  script: string;
  // hooks-json: the agent's config file to merge into
  // plugin: the target plugin file path to copy to
  configPath: string;
  specs: HookEventSpec[]; // hooks-json only
}

// ---- locating the bundled hook scripts ------------------------------------

// dev      → <repo>/hooks                       (__dirname = <repo>/dist-electron)
// packaged → <install>/hooks                    (__dirname = <install>/resources/app/dist-electron)
//
// IMPORTANT: When running from inside an ASAR archive, paths like
// "app.asar/hooks" resolve via Electron's virtual filesystem and fs.existsSync
// returns true, but Node.js cannot execute files inside ASAR.  We must check
// external paths FIRST and skip any path that falls inside an .asar file.
function resolveHooksDir(): string | null {
  // Candidate order matters: external paths first, ASAR-internal last.
  const candidates: string[] = [];

  // 1. External hooks directory (packaged): <install>/hooks
  //    __dirname = .../resources/app/dist-electron  →  go up 3 levels
  candidates.push(path.join(__dirname, "..", "..", "..", "hooks"));

  // 2. Via process.resourcesPath (packaged): <install>/hooks
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "..", "hooks"));
  }

  // 3. Dev mode: <repo>/hooks  (only valid when running from source)
  candidates.push(path.join(__dirname, "..", "hooks"));

  for (const dir of candidates) {
    // Skip paths that fall inside an .asar archive — Node can't execute them.
    if (dir.includes(".asar" + path.sep) || dir.includes(".asar/")) continue;

    try {
      if (
        fs.existsSync(path.join(dir, "claude-hook.mjs")) ||
        fs.existsSync(path.join(dir, "codex-hook.mjs")) ||
        fs.existsSync(path.join(dir, "opencode", "light-hud.js"))
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
function opencodeDir(): string {
  return process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode");
}
// DevEco Code is built on OpenCode; its config dir defaults to ~/.config/deveco.
// Override with DEVECO_CONFIG_DIR if your install uses a different path. The
// plugin auto-detects its identity from the path, so as long as the directory
// name contains "deveco" it reports as deveco-code.
function devecoDir(): string {
  return process.env.DEVECO_CONFIG_DIR || path.join(os.homedir(), ".config", "deveco");
}

function agentConfigs(): Record<AgentKey, AgentConfig> {
  return {
    claude: {
      agent: "claude",
      label: "Claude Code",
      mode: "hooks-json",
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
      mode: "hooks-json",
      script: "codex-hook.mjs",
      configPath: path.join(codexDir(), "hooks.json"),
      specs: [
        { event: "SessionStart", type: "session_start", matcher: "startup|resume|clear|compact" },
        { event: "UserPromptSubmit", type: "user_prompt" },
        { event: "PreToolUse", type: "tool_use", matcher: "*" },
        { event: "Stop", type: "stop" },
        { event: "SessionEnd", type: "session_end" },
      ],
    },
    opencode: {
      agent: "opencode",
      label: "OpenCode",
      mode: "plugin",
      script: "opencode/light-hud.js",
      configPath: path.join(opencodeDir(), "plugins", "light-hud.js"),
      specs: [],
    },
    deveco: {
      agent: "deveco",
      label: "DevEco Code",
      mode: "plugin",
      // Same source plugin as opencode; identity is auto-detected from the
      // install path (…/deveco/plugins/ → deveco-code).
      script: "opencode/light-hud.js",
      configPath: path.join(devecoDir(), "plugins", "light-hud.js"),
      specs: [],
    },
  };
}

// ---- hooks-json mode (Claude / Codex) -------------------------------------

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

function writeAtomic(filePath: string, contents: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
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

function hooksJsonStatus(cfg: AgentConfig, hooksDir: string | null): AgentHookStatus {
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

function installHooksJson(cfg: AgentConfig, hooksDir: string): { ok: boolean; message: string } {
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

// ---- plugin mode (OpenCode / DevEco Code) ---------------------------------

// Marker string present at the top of our plugin source. We use it to tell
// "our plugin, possibly outdated" apart from a user's own unrelated plugin
// file that happens to have the same name.
const PLUGIN_MARKER = "AGENT HUD plugin for OpenCode / DevEco Code";

function sourcePluginPath(hooksDir: string, script: string): string {
  return path.join(hooksDir, script);
}

function readText(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function pluginStatus(cfg: AgentConfig, hooksDir: string | null): AgentHookStatus {
  const targetDir = path.dirname(cfg.configPath);
  let configExists = false;
  try {
    configExists = fs.existsSync(targetDir);
  } catch {
    /* ignore */
  }
  const base: AgentHookStatus = {
    agent: cfg.agent,
    configPath: cfg.configPath,
    configExists,
    installed: false,
    needsUpdate: false,
  };
  if (!hooksDir) return base;

  const src = readText(sourcePluginPath(hooksDir, cfg.script));
  if (!src) return base; // source plugin missing — can't install / compare

  const dst = readText(cfg.configPath);
  if (dst == null) return base; // not installed yet
  if (!dst.includes(PLUGIN_MARKER)) return base; // foreign file — leave it alone
  if (dst === src) {
    base.installed = true;
    return base;
  }
  base.needsUpdate = true; // ours but outdated
  return base;
}

function installPlugin(cfg: AgentConfig, hooksDir: string): { ok: boolean; message: string } {
  const src = readText(sourcePluginPath(hooksDir, cfg.script));
  if (!src) {
    return { ok: false, message: `${cfg.label}：找不到插件源文件，已跳过（请确认安装完整）` };
  }
  const targetDir = path.dirname(cfg.configPath);
  // Back up an existing plugin of ours (or any same-named file) so the user
  // always has a recovery copy. Foreign files without our marker are skipped
  // for safety — we never clobber something we didn't write.
  const existing = readText(cfg.configPath);
  if (existing != null) {
    if (!existing.includes(PLUGIN_MARKER)) {
      return {
        ok: false,
        message: `${cfg.label}：目标已存在非本应用的插件，已跳过（未覆盖）：${cfg.configPath}`,
      };
    }
    try {
      fs.copyFileSync(cfg.configPath, cfg.configPath + ".light-backup");
    } catch {
      /* backup is best-effort */
    }
  }
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(cfg.configPath, src, "utf8");
  } catch (err) {
    return {
      ok: false,
      message: `${cfg.label}：写入失败 — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: true, message: `${cfg.label} 已接入，重启 ${cfg.label} 后生效` };
}

// ---- dispatch -------------------------------------------------------------

function agentStatus(cfg: AgentConfig, hooksDir: string | null): AgentHookStatus {
  return cfg.mode === "plugin" ? pluginStatus(cfg, hooksDir) : hooksJsonStatus(cfg, hooksDir);
}

export function getHooksStatus(): HooksStatus {
  const hooksDir = resolveHooksDir();
  const cfgs = agentConfigs();
  return {
    hooksDir,
    ready: hooksDir != null,
    claude: agentStatus(cfgs.claude, hooksDir),
    codex: agentStatus(cfgs.codex, hooksDir),
    opencode: agentStatus(cfgs.opencode, hooksDir),
    deveco: agentStatus(cfgs.deveco, hooksDir),
  };
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
  const allKeys: AgentKey[] = ["claude", "codex", "opencode", "deveco"];
  // "both" is accepted as a back-compat alias for "all".
  const keys: AgentKey[] =
    target === "all" || target === "both" ? allKeys : [target];

  const messages: string[] = [];
  let allOk = true;
  for (const key of keys) {
    const cfg = cfgs[key];
    const r = cfg.mode === "plugin" ? installPlugin(cfg, hooksDir) : installHooksJson(cfg, hooksDir);
    if (!r.ok) allOk = false;
    messages.push(r.message);
  }

  return { ok: allOk, message: messages.join("；"), status: getHooksStatus() };
}
