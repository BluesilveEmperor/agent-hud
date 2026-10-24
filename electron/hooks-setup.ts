// One-click installer for the in-app "接入 Agent" feature.
//
// Three install modes:
//   - "hooks-json": Claude Code / Codex — MERGE hook entries into the agent's
//     JSON config (~/.claude/settings.json, ~/.codex/hooks.json).
//   - "plugin": OpenCode / DevEco Code — COPY the light-hud.js plugin into
//     the agent's plugins directory (~/.config/opencode/plugins/,
//     ~/.config/deveco/plugins/). OpenCode auto-loads plugins at startup, so
//     no config entry is needed.
//   - "hooks-yaml": Hermes Agent — MERGE hook entries into the YAML hooks:
//     block of ~/.hermes/config.yaml, and PRE-APPROVE each (event, command)
//     pair in ~/.hermes/shell-hooks-allowlist.json so the hooks also register
//     in non-TTY runs (gateway/cron/CI) without an interactive prompt.
//
// All modes are safe & idempotent: they only replace *our own* previous
// entries / files (matched by hook-script name, or by a marker comment for
// plugins), preserve everything else, and write a `.light-backup` copy before
// any change.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type AgentKey =
  | "claude"
  | "codex"
  | "opencode"
  | "deveco"
  | "codearts"
  | "workbuddy"
  | "hermes";
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
  codearts: AgentHookStatus;
  workbuddy: AgentHookStatus;
  hermes: AgentHookStatus;
}

export interface InstallResult {
  ok: boolean;
  message: string;
  status: HooksStatus;
}

type InstallMode = "hooks-json" | "plugin" | "hooks-yaml";

interface HookEventSpec {
  // hooks-json: the agent's JSON event key, e.g. "SessionStart"
  // hooks-yaml: the Hermes shell-hook event name, e.g. "on_session_start"
  event: string;
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
  // hooks-json only: extra argv passed to the hook script so a shared script
  // (claude-hook.mjs) can report the right agent identity.
  agentArg?: string;
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
        fs.existsSync(path.join(dir, "hermes-hook.mjs")) ||
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
// CodeArts Agent CLI (Huawei Cloud 码道) is also an OpenCode fork: its plugin
// dir is ~/.codeartsdoer/plugins (user level) and auto-loads every .js/.ts file
// on startup. The plugin auto-detects its identity from this path
// (…/codeartsdoer/plugins/ → "codearts"). CODEARTS_HOME overrides.
function codeartsDir(): string {
  return process.env.CODEARTS_HOME || path.join(os.homedir(), ".codeartsdoer");
}
// WorkBuddy (Tencent) uses a Claude-Code-compatible hooks block inside
// ~/.workbuddy/settings.json — same event names and payload shape, so the
// Claude hook script is reused as-is. WORKBUDDY_CONFIG_DIR overrides.
function workbuddyDir(): string {
  return process.env.WORKBUDDY_CONFIG_DIR || path.join(os.homedir(), ".workbuddy");
}
// Hermes Agent keeps its config in ~/.hermes (config.yaml + allowlist JSON).
// HERMES_HOME overrides it if the install uses a non-default location.
function hermesDir(): string {
  return process.env.HERMES_HOME || path.join(os.homedir(), ".hermes");
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
    codearts: {
      agent: "codearts",
      label: "CodeArts Agent",
      mode: "plugin",
      // Same source plugin; identity auto-detected from the install path
      // (…/codeartsdoer/plugins/ → "codearts").
      script: "opencode/light-hud.js",
      configPath: path.join(codeartsDir(), "plugins", "light-hud.js"),
      specs: [],
    },
    workbuddy: {
      agent: "workbuddy",
      label: "WorkBuddy",
      mode: "hooks-json",
      // Claude-Code-compatible hooks block; the script parses the same stdin
      // JSON (session_id / hook_event_name / tool_name / prompt).
      script: "claude-hook.mjs",
      configPath: path.join(workbuddyDir(), "settings.json"),
      agentArg: "workbuddy",
      specs: [
        { event: "SessionStart", type: "session_start" },
        { event: "SessionEnd", type: "session_end" },
        { event: "UserPromptSubmit", type: "user_prompt" },
        { event: "PreToolUse", type: "tool_use", matcher: "*" },
        { event: "Stop", type: "stop" },
      ],
    },
    hermes: {
      agent: "hermes",
      label: "Hermes",
      mode: "hooks-yaml",
      script: "hermes-hook.mjs",
      configPath: path.join(hermesDir(), "config.yaml"),
      specs: [
        // Hermes shell-hook event names (VALID_HOOKS) → HUD event types.
        // on_session_finalize covers /new, gateway GC and CLI exit — that is
        // the reliable "window closed" signal. on_session_end fires whenever a
        // conversation run ends (including interrupted turns), so it maps to
        // "stop" rather than "session_end".
        { event: "on_session_start", type: "session_start" },
        { event: "on_session_finalize", type: "session_end" },
        { event: "pre_llm_call", type: "user_prompt" },
        { event: "pre_tool_call", type: "tool_use" },
        { event: "post_llm_call", type: "stop" },
        { event: "on_session_end", type: "stop" },
      ],
    },
  };
}

// ---- hooks-json mode (Claude / Codex) -------------------------------------

// Forward slashes work for node on every platform and dodge JSON/`\` escaping
// and Windows shell-quoting headaches (this is what hooks/README recommends).
function buildCommand(
  hooksDir: string,
  script: string,
  type: string,
  agentArg?: string,
): string {
  const p = hooksDir.replace(/\\/g, "/");
  return `node "${p}/${script}" ${type}${agentArg ? ` ${agentArg}` : ""}`;
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
    // Keep the FIRST backup only: repeated 接入/取消 cycles must not bury the
    // user's original config under our own intermediate states.
    if (fs.existsSync(filePath) && !fs.existsSync(filePath + ".light-backup")) {
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
      hooks: [{ type: "command", command: buildCommand(hooksDir, cfg.script, spec.type, cfg.agentArg) }],
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

// ---- hooks-yaml mode (Hermes Agent) ---------------------------------------
//
// ~/.hermes/config.yaml holds a block-mapping `hooks:` section:
//   hooks:
//     pre_tool_call:
//       - matcher: "terminal"
//         command: "..."
//         timeout: 5
// We have no YAML library bundled, so we do a conservative LINE-based merge:
// only our own `- command:` entries (identified by the hook-script name) are
// touched, everything else is preserved verbatim. If the file's shape is not
// the expected block style (e.g. inline `hooks: {...}`), we bail out and ask
// the user to wire it manually rather than risk corrupting their config.
//
// Hermes also requires first-use consent per (event, command) pair; in
// non-TTY runs an unapproved hook silently stays unregistered. We pre-write
// ~/.hermes/shell-hooks-allowlist.json so the hooks work immediately.

function yamlCommand(hooksDir: string, script: string, type: string): string {
  return buildCommand(hooksDir, script, type);
}

// Extract the scalar value of a `- command: ...` list line, stripping one
// pair of surrounding single/double quotes (and YAML '' escapes).
function parseYamlCommandLine(line: string): string | null {
  const m = line.match(/^\s*-\s*command\s*:\s*(.*)$/);
  if (!m) return null;
  let v = m[1].trim();
  // Drop a trailing comment on unquoted scalars.
  if (!v.startsWith("'") && !v.startsWith('"')) {
    const hash = v.indexOf(" #");
    if (hash >= 0) v = v.slice(0, hash).trimEnd();
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1);
  }
  return v;
}

// Find the `hooks:` block. Returns content line range [start, end) or null
// when there is no hooks key. Throws when the block uses an unsupported
// inline style.
function findHooksBlock(lines: string[]): { start: number; end: number } | null {
  const idx = lines.findIndex((l) => /^hooks\s*:/.test(l));
  if (idx < 0) return null;
  if (!/^hooks\s*:\s*(#.*)?$/.test(lines[idx])) {
    throw new Error("inline-hooks");
  }
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "" || l.trimStart().startsWith("#")) continue;
    if (/^\S/.test(l)) {
      end = i;
      break;
    }
  }
  return { start: idx + 1, end };
}

function yamlHasEntry(lines: string[], command: string): boolean {
  return lines.some((l) => parseYamlCommandLine(l) === command);
}

function hooksYamlStatus(cfg: AgentConfig, hooksDir: string | null): AgentHookStatus {
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

  const text = readText(cfg.configPath);
  if (text == null) return base;
  const lines = text.split(/\r?\n/);
  const referenced = lines.some((l) => /^\s*-\s*command\s*:/.test(l) && l.includes(cfg.script));
  const allHere = cfg.specs.every((spec) =>
    yamlHasEntry(lines, yamlCommand(hooksDir, cfg.script, spec.type)),
  );
  base.installed = allHere;
  base.needsUpdate = !allHere && referenced;
  return base;
}

// Pre-approve our (event, command) pairs in shell-hooks-allowlist.json so the
// hooks register even in non-TTY runs. Same merge discipline as hooks-json:
// only our own pairs are added, everything else is preserved.
function mergeHermesAllowlist(
  allowPath: string,
  pairs: Array<{ event: string; command: string }>,
): { ok: boolean; message?: string } {
  const read = readJson(allowPath);
  if (!read.ok) {
    return { ok: false, message: "allowlist 文件无法解析为 JSON（已跳过预授权）" };
  }
  let root = read.value;
  if (root === undefined) root = {};
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return { ok: false, message: "allowlist 文件格式异常（已跳过预授权）" };
  }
  const obj = root as { approvals?: unknown };
  if (obj.approvals === undefined) obj.approvals = [];
  if (!Array.isArray(obj.approvals)) {
    return { ok: false, message: "allowlist approvals 字段格式异常（已跳过预授权）" };
  }
  const approvals = obj.approvals as Array<{ event?: unknown; command?: unknown }>;
  for (const p of pairs) {
    const exists = approvals.some((a) => a?.event === p.event && a?.command === p.command);
    if (!exists) approvals.push({ event: p.event, command: p.command });
  }
  try {
    writeAtomic(allowPath, JSON.stringify(obj, null, 2) + "\n");
  } catch (err) {
    return {
      ok: false,
      message: `allowlist 写入失败 — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: true };
}

// Remove every `- command:` entry that names our hook script (plus its
// continuation lines), then drop the event keys that removal left empty —
// but only keys we introduced (a user-filled key is never empty).
// Shared by install (idempotent re-merge) and uninstall.
function stripYamlOurEntries(lines: string[], cfg: AgentConfig): string[] {
  let block: { start: number; end: number } | null;
  try {
    block = findHooksBlock(lines);
  } catch {
    return lines;
  }
  if (!block) return lines;

  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const inBlock = i >= block.start && i < block.end;
    if (inBlock && /^\s*-\s*command\s*:/.test(l) && l.includes(cfg.script)) {
      const dashIndent = l.length - l.trimStart().length;
      while (i + 1 < block.end) {
        const n = lines[i + 1];
        if (n.trim() === "") break;
        const indent = n.length - n.trimStart().length;
        if (indent > dashIndent && !/^\s*-\s/.test(n)) {
          i++;
          continue;
        }
        break;
      }
      continue;
    }
    kept.push(l);
  }

  try {
    block = findHooksBlock(kept);
  } catch {
    return kept;
  }
  if (!block) return kept;

  const specEvents = new Set(cfg.specs.map((s) => s.event));
  const out: string[] = [];
  for (let i = 0; i < kept.length; i++) {
    const l = kept[i];
    const m = l.match(/^(\s{2})([A-Za-z_]\w*)\s*:\s*(#.*)?$/);
    const inBlock = i >= block.start - 1 && i < block.end;
    if (inBlock && m && specEvents.has(m[2])) {
      let hasEntry = false;
      for (let j = i + 1; j < block.end; j++) {
        const n = kept[j];
        if (n.trim() === "" || n.trimStart().startsWith("#")) continue;
        const indent = n.length - n.trimStart().length;
        if (indent <= 2) break;
        if (/^\s*-\s/.test(n)) {
          hasEntry = true;
          break;
        }
      }
      if (!hasEntry) continue;
    }
    out.push(l);
  }
  return out;
}

function installHooksYaml(cfg: AgentConfig, hooksDir: string): { ok: boolean; message: string } {
  if (hooksDir.includes("'")) {
    return { ok: false, message: `${cfg.label}：hooks 路径含单引号，无法安全写入 YAML，请手动接入` };
  }

  let text = "";
  try {
    if (fs.existsSync(cfg.configPath)) text = fs.readFileSync(cfg.configPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      message: `${cfg.label}：读取 config.yaml 失败 — ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let lines = text.split(/\r?\n/);
  let block: { start: number; end: number } | null;
  try {
    block = findHooksBlock(lines);
  } catch {
    return {
      ok: false,
      message: `${cfg.label}：config.yaml 的 hooks 为行内格式，无法安全合并，请按 hooks/README.md 手动接入（未做改动）`,
    };
  }
  if (!block) block = { start: lines.length, end: lines.length };

  // 1+2. Drop only our own previous entries (- command lines naming our
  //      script) plus continuation lines, then drop event keys we left empty.
  lines = stripYamlOurEntries(lines, cfg);

  // 3. Insert a fresh entry for every spec, recomputing the block each time.
  for (const spec of cfg.specs) {
    const command = yamlCommand(hooksDir, cfg.script, spec.type);
    const entryLine = `    - command: '${command}'`;
    try {
      block = findHooksBlock(lines);
    } catch {
      block = null;
    }
    if (!block) {
      // No hooks: section at all — append one at the end of the file.
      while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
      lines.push("", "hooks:");
      for (const s of cfg.specs.slice(cfg.specs.indexOf(spec))) {
        lines.push(`  ${s.event}:`, `    - command: '${yamlCommand(hooksDir, cfg.script, s.type)}'`);
      }
      break;
    }
    const evRe = new RegExp(`^\\s{2}${spec.event}\\s*:\\s*(#.*)?$`);
    let evIdx = -1;
    for (let i = block.start; i < block.end; i++) {
      if (evRe.test(lines[i])) {
        evIdx = i;
        break;
      }
    }
    if (evIdx < 0) {
      // Event key missing — append it at the end of the hooks block.
      lines.splice(block.end, 0, `  ${spec.event}:`, entryLine);
      continue;
    }
    // Insert after the event's existing entries (end of its sub-block).
    let insertAt = evIdx + 1;
    for (let j = evIdx + 1; j < block.end; j++) {
      const n = lines[j];
      if (n.trim() === "" || n.trimStart().startsWith("#")) break;
      const indent = n.length - n.trimStart().length;
      if (indent <= 2) break;
      insertAt = j + 1;
    }
    lines.splice(insertAt, 0, entryLine);
  }

  try {
    writeAtomic(cfg.configPath, lines.join("\n").replace(/\n*$/,"\n"));
  } catch (err) {
    return {
      ok: false,
      message: `${cfg.label}：写入失败 — ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 4. Pre-approve the exact (event, command) pairs. A failure here is not
  //    fatal: the user can still approve interactively on first use.
  const allowPath = path.join(path.dirname(cfg.configPath), "shell-hooks-allowlist.json");
  const pairs = cfg.specs.map((s) => ({
    event: s.event,
    command: yamlCommand(hooksDir, cfg.script, s.type),
  }));
  const allow = mergeHermesAllowlist(allowPath, pairs);
  const suffix = allow.ok ? "" : `；注意：${allow.message}，首次运行可能需交互确认`;
  return { ok: true, message: `${cfg.label} 已接入，重启 ${cfg.label} 后生效${suffix}` };
}

// ---- uninstall (undo one agent, or all) -----------------------------------
//
// Every mode removes ONLY our own artifacts; a user's own hooks/plugins that
// happen to share the file are detected (foreign plugin = no marker) and left
// untouched. Originals are always backed up as `.light-backup` first.

function uninstallHooksJson(cfg: AgentConfig): { ok: boolean; message: string } {
  const read = readJson(cfg.configPath);
  if (!read.ok) {
    return { ok: false, message: `${cfg.label}：现有配置无法解析为 JSON，已跳过（未做改动）` };
  }
  const root = read.value;
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return { ok: true, message: `${cfg.label}：没有本应用写入的 hooks，无需取消` };
  }
  const config = root as { hooks?: unknown };
  if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) {
    return { ok: true, message: `${cfg.label}：没有本应用写入的 hooks，无需取消` };
  }
  const hooks = config.hooks as Record<string, unknown>;

  let removed = 0;
  for (const event of Object.keys(hooks)) {
    const arr = hooks[event];
    if (!Array.isArray(arr)) continue;
    const cleaned = arr.filter((group) => !groupReferencesScript(group, cfg.script));
    removed += arr.length - cleaned.length;
    if (cleaned.length > 0) hooks[event] = cleaned;
    else delete hooks[event];
  }

  if (removed === 0) {
    return { ok: true, message: `${cfg.label}：没有本应用写入的 hooks，无需取消` };
  }
  // Only drop the hooks object if we emptied it entirely.
  if (Object.keys(hooks).length === 0) delete config.hooks;

  try {
    writeAtomic(cfg.configPath, JSON.stringify(config, null, 2) + "\n");
  } catch (err) {
    return {
      ok: false,
      message: `${cfg.label}：写入失败 — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: true, message: `${cfg.label} 已取消接入（清掉 ${removed} 条 hook，其余配置保留）` };
}

function uninstallPlugin(cfg: AgentConfig): { ok: boolean; message: string } {
  const existing = readText(cfg.configPath);
  if (existing == null) {
    return { ok: true, message: `${cfg.label}：未接入，无需取消` };
  }
  if (!existing.includes(PLUGIN_MARKER)) {
    return {
      ok: false,
      message: `${cfg.label}：目标插件不是本应用写入的，已跳过（未删除）：${cfg.configPath}`,
    };
  }
  // Rename instead of delete: the file stops being loaded (wrong extension)
  // and stays recoverable. install() copies over the same backup name.
  const backup = cfg.configPath + ".light-backup";
  try {
    try {
      fs.rmSync(backup, { force: true });
    } catch {
      /* ignore */
    }
    fs.renameSync(cfg.configPath, backup);
  } catch (err) {
    return {
      ok: false,
      message: `${cfg.label}：取消接入失败 — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return {
    ok: true,
    message: `${cfg.label} 已取消接入（插件改名为 .light-backup，重启 ${cfg.label} 后生效）`,
  };
}

function uninstallHooksYaml(cfg: AgentConfig): { ok: boolean; message: string } {
  let text = "";
  try {
    if (!fs.existsSync(cfg.configPath)) {
      return { ok: true, message: `${cfg.label}：未接入，无需取消` };
    }
    text = fs.readFileSync(cfg.configPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      message: `${cfg.label}：读取 config.yaml 失败 — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const before = text;
  const stripped = stripYamlOurEntries(text.split(/\r?\n/), cfg);
  const next = stripped.join("\n").replace(/\n*$/, "\n");
  if (next === before) {
    return { ok: true, message: `${cfg.label}：没有本应用写入的 hooks，无需取消` };
  }
  try {
    writeAtomic(cfg.configPath, next);
  } catch (err) {
    return {
      ok: false,
      message: `${cfg.label}：写入失败 — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: true, message: `${cfg.label} 已取消接入（其余 hooks 保留）` };
}

export function uninstallHooks(target: InstallTarget): InstallResult {
  const cfgs = agentConfigs();
  const allKeys: AgentKey[] = [
    "claude",
    "codex",
    "opencode",
    "deveco",
    "codearts",
    "workbuddy",
    "hermes",
  ];
  const keys: AgentKey[] = target === "all" || target === "both" ? allKeys : [target];

  const messages: string[] = [];
  let allOk = true;
  for (const key of keys) {
    const cfg = cfgs[key];
    const r =
      cfg.mode === "plugin"
        ? uninstallPlugin(cfg)
        : cfg.mode === "hooks-yaml"
          ? uninstallHooksYaml(cfg)
          : uninstallHooksJson(cfg);
    if (!r.ok) allOk = false;
    messages.push(r.message);
  }
  return { ok: allOk, message: messages.join("；"), status: getHooksStatus() };
}

// ---- dispatch -------------------------------------------------------------

function agentStatus(cfg: AgentConfig, hooksDir: string | null): AgentHookStatus {
  if (cfg.mode === "plugin") return pluginStatus(cfg, hooksDir);
  if (cfg.mode === "hooks-yaml") return hooksYamlStatus(cfg, hooksDir);
  return hooksJsonStatus(cfg, hooksDir);
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
    codearts: agentStatus(cfgs.codearts, hooksDir),
    workbuddy: agentStatus(cfgs.workbuddy, hooksDir),
    hermes: agentStatus(cfgs.hermes, hooksDir),
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
  const allKeys: AgentKey[] = [
    "claude",
    "codex",
    "opencode",
    "deveco",
    "codearts",
    "workbuddy",
    "hermes",
  ];
  // "both" is accepted as a back-compat alias for "all".
  const keys: AgentKey[] =
    target === "all" || target === "both" ? allKeys : [target];

  const messages: string[] = [];
  let allOk = true;
  for (const key of keys) {
    const cfg = cfgs[key];
    const r =
      cfg.mode === "plugin"
        ? installPlugin(cfg, hooksDir)
        : cfg.mode === "hooks-yaml"
          ? installHooksYaml(cfg, hooksDir)
          : installHooksJson(cfg, hooksDir);
    if (!r.ok) allOk = false;
    messages.push(r.message);
  }

  return { ok: allOk, message: messages.join("；"), status: getHooksStatus() };
}
