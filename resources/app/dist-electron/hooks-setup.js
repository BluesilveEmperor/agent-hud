"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHooksStatus = getHooksStatus;
exports.installHooks = installHooks;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
// ---- locating the bundled hook scripts ------------------------------------
// dev      → <repo>/hooks                       (__dirname = <repo>/dist-electron)
// packaged → <install>/hooks                    (__dirname = <install>/resources/app/dist-electron)
function resolveHooksDir() {
    const candidates = [
        node_path_1.default.join(__dirname, "..", "hooks"),
        node_path_1.default.join(__dirname, "..", "..", "..", "hooks"),
    ];
    if (process.resourcesPath) {
        candidates.push(node_path_1.default.join(process.resourcesPath, "..", "hooks"));
    }
    for (const dir of candidates) {
        try {
            if (node_fs_1.default.existsSync(node_path_1.default.join(dir, "claude-hook.mjs")) ||
                node_fs_1.default.existsSync(node_path_1.default.join(dir, "codex-hook.mjs")) ||
                node_fs_1.default.existsSync(node_path_1.default.join(dir, "opencode", "light-hud.js"))) {
                return node_path_1.default.resolve(dir);
            }
        }
        catch {
            /* ignore */
        }
    }
    return null;
}
function claudeDir() {
    return process.env.CLAUDE_CONFIG_DIR || node_path_1.default.join(node_os_1.default.homedir(), ".claude");
}
function codexDir() {
    return process.env.CODEX_HOME || node_path_1.default.join(node_os_1.default.homedir(), ".codex");
}
function opencodeDir() {
    return process.env.OPENCODE_CONFIG_DIR || node_path_1.default.join(node_os_1.default.homedir(), ".config", "opencode");
}
// DevEco Code is built on OpenCode; its config dir defaults to ~/.config/deveco.
// Override with DEVECO_CONFIG_DIR if your install uses a different path. The
// plugin auto-detects its identity from the path, so as long as the directory
// name contains "deveco" it reports as deveco-code.
function devecoDir() {
    return process.env.DEVECO_CONFIG_DIR || node_path_1.default.join(node_os_1.default.homedir(), ".config", "deveco");
}
function agentConfigs() {
    return {
        claude: {
            agent: "claude",
            label: "Claude Code",
            mode: "hooks-json",
            script: "claude-hook.mjs",
            configPath: node_path_1.default.join(claudeDir(), "settings.json"),
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
            configPath: node_path_1.default.join(codexDir(), "hooks.json"),
            specs: [
                { event: "SessionStart", type: "session_start", matcher: "startup|resume|clear|compact" },
                { event: "UserPromptSubmit", type: "user_prompt" },
                { event: "PreToolUse", type: "tool_use", matcher: "*" },
                { event: "Stop", type: "stop" },
            ],
        },
        opencode: {
            agent: "opencode",
            label: "OpenCode",
            mode: "plugin",
            script: "opencode/light-hud.js",
            configPath: node_path_1.default.join(opencodeDir(), "plugins", "light-hud.js"),
            specs: [],
        },
        deveco: {
            agent: "deveco",
            label: "DevEco Code",
            mode: "plugin",
            // Same source plugin as opencode; identity is auto-detected from the
            // install path (…/deveco/plugins/ → deveco-code).
            script: "opencode/light-hud.js",
            configPath: node_path_1.default.join(devecoDir(), "plugins", "light-hud.js"),
            specs: [],
        },
    };
}
// ---- hooks-json mode (Claude / Codex) -------------------------------------
// Forward slashes work for node on every platform and dodge JSON/`\` escaping
// and Windows shell-quoting headaches (this is what hooks/README recommends).
function buildCommand(hooksDir, script, type) {
    const p = hooksDir.replace(/\\/g, "/");
    return `node "${p}/${script}" ${type}`;
}
function norm(s) {
    return s.replace(/\\/g, "/").toLowerCase();
}
// Does this command invoke our script at all (any install path)?
function commandIsOurs(command, script) {
    return typeof command === "string" && norm(command).includes(norm(script));
}
// Does this command invoke our script from *this* hooksDir for this event type?
function commandMatchesHere(command, hooksDir, script, type) {
    if (typeof command !== "string")
        return false;
    const c = norm(command);
    return c.includes(norm(`${hooksDir}/${script}`)) && new RegExp(`(^|\\s)${type}(\\s|$)`).test(c);
}
function groupReferencesScript(group, script) {
    const g = group;
    return Array.isArray(g?.hooks) && g.hooks.some((h) => commandIsOurs(h?.command, script));
}
function readJson(filePath) {
    try {
        if (!node_fs_1.default.existsSync(filePath))
            return { ok: true, value: undefined };
        const raw = node_fs_1.default.readFileSync(filePath, "utf8");
        if (!raw.trim())
            return { ok: true, value: {} };
        return { ok: true, value: JSON.parse(raw) };
    }
    catch {
        return { ok: false };
    }
}
function writeAtomic(filePath, contents) {
    const dir = node_path_1.default.dirname(filePath);
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    try {
        if (node_fs_1.default.existsSync(filePath)) {
            node_fs_1.default.copyFileSync(filePath, filePath + ".light-backup");
        }
    }
    catch {
        /* backup is best-effort */
    }
    const tmp = filePath + ".light-tmp";
    node_fs_1.default.writeFileSync(tmp, contents, "utf8");
    node_fs_1.default.renameSync(tmp, filePath);
}
function hooksJsonStatus(cfg, hooksDir) {
    const configExists = (() => {
        try {
            return node_fs_1.default.existsSync(cfg.configPath);
        }
        catch {
            return false;
        }
    })();
    const base = {
        agent: cfg.agent,
        configPath: cfg.configPath,
        configExists,
        installed: false,
        needsUpdate: false,
    };
    if (!hooksDir || !configExists)
        return base;
    const read = readJson(cfg.configPath);
    if (!read.ok || !read.value || typeof read.value !== "object")
        return base;
    const hooks = read.value.hooks;
    if (!hooks || typeof hooks !== "object")
        return base;
    let referenced = false;
    const allHere = cfg.specs.every((spec) => {
        const arr = hooks[spec.event];
        if (!Array.isArray(arr))
            return false;
        let hereForSpec = false;
        for (const group of arr) {
            const g = group;
            if (!Array.isArray(g?.hooks))
                continue;
            for (const h of g.hooks) {
                if (commandIsOurs(h?.command, cfg.script))
                    referenced = true;
                if (commandMatchesHere(h?.command, hooksDir, cfg.script, spec.type))
                    hereForSpec = true;
            }
        }
        return hereForSpec;
    });
    base.installed = allHere;
    base.needsUpdate = !allHere && referenced;
    return base;
}
function installHooksJson(cfg, hooksDir) {
    const read = readJson(cfg.configPath);
    if (!read.ok) {
        return { ok: false, message: `${cfg.label}：现有配置无法解析为 JSON，已跳过（未做改动）` };
    }
    let root = read.value;
    if (root === undefined)
        root = {};
    if (!root || typeof root !== "object" || Array.isArray(root)) {
        return { ok: false, message: `${cfg.label}：配置文件格式异常，已跳过（未做改动）` };
    }
    const config = root;
    if (config.hooks === undefined)
        config.hooks = {};
    if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) {
        return { ok: false, message: `${cfg.label}：hooks 字段格式异常，已跳过（未做改动）` };
    }
    const hooks = config.hooks;
    for (const spec of cfg.specs) {
        const existing = Array.isArray(hooks[spec.event]) ? hooks[spec.event] : [];
        // Drop only our own previous entries; keep every other group untouched.
        const cleaned = existing.filter((group) => !groupReferencesScript(group, cfg.script));
        const group = {
            hooks: [{ type: "command", command: buildCommand(hooksDir, cfg.script, spec.type) }],
        };
        if (spec.matcher !== undefined)
            group.matcher = spec.matcher;
        cleaned.push(group);
        hooks[spec.event] = cleaned;
    }
    try {
        writeAtomic(cfg.configPath, JSON.stringify(config, null, 2) + "\n");
    }
    catch (err) {
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
function sourcePluginPath(hooksDir, script) {
    return node_path_1.default.join(hooksDir, script);
}
function readText(filePath) {
    try {
        if (!node_fs_1.default.existsSync(filePath))
            return null;
        return node_fs_1.default.readFileSync(filePath, "utf8");
    }
    catch {
        return null;
    }
}
function pluginStatus(cfg, hooksDir) {
    const targetDir = node_path_1.default.dirname(cfg.configPath);
    let configExists = false;
    try {
        configExists = node_fs_1.default.existsSync(targetDir);
    }
    catch {
        /* ignore */
    }
    const base = {
        agent: cfg.agent,
        configPath: cfg.configPath,
        configExists,
        installed: false,
        needsUpdate: false,
    };
    if (!hooksDir)
        return base;
    const src = readText(sourcePluginPath(hooksDir, cfg.script));
    if (!src)
        return base; // source plugin missing — can't install / compare
    const dst = readText(cfg.configPath);
    if (dst == null)
        return base; // not installed yet
    if (!dst.includes(PLUGIN_MARKER))
        return base; // foreign file — leave it alone
    if (dst === src) {
        base.installed = true;
        return base;
    }
    base.needsUpdate = true; // ours but outdated
    return base;
}
function installPlugin(cfg, hooksDir) {
    const src = readText(sourcePluginPath(hooksDir, cfg.script));
    if (!src) {
        return { ok: false, message: `${cfg.label}：找不到插件源文件，已跳过（请确认安装完整）` };
    }
    const targetDir = node_path_1.default.dirname(cfg.configPath);
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
            node_fs_1.default.copyFileSync(cfg.configPath, cfg.configPath + ".light-backup");
        }
        catch {
            /* backup is best-effort */
        }
    }
    try {
        node_fs_1.default.mkdirSync(targetDir, { recursive: true });
        node_fs_1.default.writeFileSync(cfg.configPath, src, "utf8");
    }
    catch (err) {
        return {
            ok: false,
            message: `${cfg.label}：写入失败 — ${err instanceof Error ? err.message : String(err)}`,
        };
    }
    return { ok: true, message: `${cfg.label} 已接入，重启 ${cfg.label} 后生效` };
}
// ---- dispatch -------------------------------------------------------------
function agentStatus(cfg, hooksDir) {
    return cfg.mode === "plugin" ? pluginStatus(cfg, hooksDir) : hooksJsonStatus(cfg, hooksDir);
}
function getHooksStatus() {
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
function installHooks(target) {
    const hooksDir = resolveHooksDir();
    if (!hooksDir) {
        return {
            ok: false,
            message: "找不到 hooks 脚本目录，无法接入（请确认安装完整）",
            status: getHooksStatus(),
        };
    }
    const cfgs = agentConfigs();
    const allKeys = ["claude", "codex", "opencode", "deveco"];
    // "both" is accepted as a back-compat alias for "all".
    const keys = target === "all" || target === "both" ? allKeys : [target];
    const messages = [];
    let allOk = true;
    for (const key of keys) {
        const cfg = cfgs[key];
        const r = cfg.mode === "plugin" ? installPlugin(cfg, hooksDir) : installHooksJson(cfg, hooksDir);
        if (!r.ok)
            allOk = false;
        messages.push(r.message);
    }
    return { ok: allOk, message: messages.join("；"), status: getHooksStatus() };
}
//# sourceMappingURL=hooks-setup.js.map