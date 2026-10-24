#!/usr/bin/env node
/**
 * AGENT HUD plugin for OpenCode / DevEco Code / CodeArts Agent.
 *
 * OpenCode exposes a plugin event system (session.* / tool.execute.* /
 * message.* events). DevEco Code is built on top of OpenCode, so the same
 * plugin works for both. This plugin subscribes to those events and forwards
 * them to the AGENT HUD desktop capsule over localhost HTTP
 * (127.0.0.1:51789), so the HUD can show working / done / error state the
 * same way it does for Claude Code.
 *
 * Which agent identity is reported is auto-detected from where this file is
 * installed:
 *   ~/.config/opencode/plugins/light-hud.js   ->  "opencode"
 *   ~/.config/deveco/plugins/light-hud.js      ->  "deveco-code"
 *   ~/.codeartsdoer/plugins/light-hud.js       ->  "codearts"
 * Override with the LIGHT_AGENT env var if auto-detection misfires.
 *
 * Install: copy this file into the plugins directory above (or use the HUD's
 * in-app "一键接入" which does it for you). OpenCode auto-loads every .js/.ts
 * file in the plugins directory at startup — no config entry needed.
 *
 * Event mapping (opencode -> HUD):
 *   session.created        -> session_start   (idle, fresh session)
 *   message.updated (user) -> user_prompt      (working)
 *   tool.execute.before    -> tool_use         (working, with tool name)
 *   session.idle           -> stop             (done)
 *   session.error          -> error
 *   session.deleted        -> session_end
 */

const PORT = Number(process.env.LIGHT_PORT || 51789);
const HOST = "127.0.0.1";
const ENDPOINT = `http://${HOST}:${PORT}/event`;

// Auto-detect agent identity from the install path (a deveco plugins dir ->
// deveco-code, a codeartsdoer plugins dir -> codearts), with an env override
// for edge cases.
function detectAgent() {
  const where = String(import.meta.url).toLowerCase();
  if (where.includes("codeartsdoer") || where.includes("codearts")) return "codearts";
  if (where.includes("deveco")) return "deveco-code";
  return "opencode";
}
const AGENT = process.env.LIGHT_AGENT || detectAgent();

// Last seen session id — tool hooks don't always carry one, so we fall back
// to this so tool_use events land in the same HUD session as the prompt.
let lastSessionId;

function pick(obj, ...keys) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    if (obj[k] != null) return obj[k];
  }
  return undefined;
}

function pickSessionId(event) {
  const p = event?.properties ?? event ?? {};
  const sid =
    pick(p, "sessionID", "sessionId", "session_id") ||
    pick(p?.info, "sessionID", "sessionId", "session_id") ||
    pick(p?.session, "id", "sessionID") ||
    pick(p?.sessionID, "id") ||
    lastSessionId;
  return sid ? String(sid) : undefined;
}

function pickRole(event) {
  const p = event?.properties ?? event ?? {};
  const msg = p.message ?? p.info?.message ?? p.info ?? p;
  // OpenCode/CodeArts put the message record under properties.info, so the
  // role lives at info.role — p.role only exists in flattened payloads.
  return pick(msg, "role") || pick(p?.info, "role") || pick(p, "role");
}

function pickMessageText(event) {
  const p = event?.properties ?? event ?? {};
  // properties.info is where OpenCode/CodeArts put the message record.
  const msg = p.message ?? p.info?.message ?? p.info ?? p;
  if (typeof msg === "string") return msg.slice(0, 200);
  if (typeof msg.text === "string") return msg.text.slice(0, 200);
  const parts = msg.parts ?? msg.content;
  if (Array.isArray(parts)) {
    const t = parts
      .map((x) => (typeof x === "string" ? x : pick(x, "text") || ""))
      .join(" ")
      .trim();
    if (t) return t.slice(0, 200);
  }
  return undefined;
}

function describeArgs(args) {
  if (args == null) return undefined;
  if (typeof args === "string") return args.slice(0, 120);
  try {
    if (args.command) return String(args.command).slice(0, 120);
    if (args.filePath) return String(args.filePath);
    if (args.path) return String(args.path);
    if (args.pattern) return String(args.pattern).slice(0, 120);
    if (args.query) return String(args.query).slice(0, 120);
    if (args.url) return String(args.url).slice(0, 120);
    return JSON.stringify(args).slice(0, 120);
  } catch {
    return undefined;
  }
}

// Known context window limits per model family. OpenCode routes to many
// providers; we match the common ones and fall back to 200k.
const CONTEXT_LIMITS = [
  { match: /gpt-5|gpt-4\.1|gpt-4o/i, limit: 1047576 },
  { match: /gpt-4-turbo/i, limit: 128000 },
  { match: /o1|o3|o4/i, limit: 200000 },
  { match: /claude.*opus/i, limit: 200000 },
  { match: /claude.*sonnet/i, limit: 200000 },
  { match: /claude.*haiku/i, limit: 200000 },
  { match: /gemini.*1\.5|gemini-2/i, limit: 1000000 },
  { match: /deepseek/i, limit: 128000 },
  { match: /qwen/i, limit: 131072 },
];
function contextLimitFor(model) {
  if (!model) return undefined;
  for (const { match, limit } of CONTEXT_LIMITS) {
    if (match.test(model)) return limit;
  }
  return 200000;
}

// Extract a Usage object from an OpenCode message event. OpenCode's message
// `info` carries token usage in a few shapes depending on provider; we probe
// the common locations and normalise them. Returns undefined if no usage found.
function pickUsage(event) {
  const p = event?.properties ?? event ?? {};
  const msg = p.message ?? p.info?.message ?? p.info ?? p;
  // Usage may live at message.info.usage, message.usage, or message.metadata.usage.
  const u =
    msg?.usage ?? msg?.info?.usage ?? msg?.metadata?.usage ?? p?.usage ?? p?.info?.usage;
  if (!u || typeof u !== "object") return undefined;
  const input = Number(u.input_tokens ?? u.inputTokens ?? u.prompt_tokens ?? u.promptTokens ?? 0) || 0;
  const output = Number(u.output_tokens ?? u.outputTokens ?? u.completion_tokens ?? u.completionTokens ?? 0) || 0;
  const cacheRead = Number(u.cache_read_input_tokens ?? u.cacheReadInputTokens ?? u.cacheRead ?? 0) || 0;
  const cacheCreate = Number(u.cache_creation_input_tokens ?? u.cacheCreationInputTokens ?? u.cacheWrite ?? 0) || 0;
  if (!input && !output && !cacheRead && !cacheCreate) return undefined;
  const model = msg?.model ?? p?.model ?? p?.info?.model;
  return {
    contextTokens: input + cacheRead + cacheCreate,
    contextLimit: contextLimitFor(model),
    outputTokens: output,
    totalTokens: input + output + cacheRead + cacheCreate,
    model,
  };
}

async function notify(type, extra = {}) {
  const payload = {
    agent: AGENT,
    type,
    timestamp: new Date().toISOString(),
    ...extra,
  };
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(800),
    });
  } catch {
    // HUD offline — never break the agent.
  }
}

// OpenCode loads every exported plugin function from files in the plugins
// directory. We export a single named function returning the hooks map.
export const LightHud = async () => {
  return {
    // Generic event subscriber — handles session + message lifecycle.
    event: async ({ event } = {}) => {
      if (!event || !event.type) return;
      const sid = pickSessionId(event);
      if (sid) lastSessionId = sid;
      switch (event.type) {
        case "session.created":
          await notify("session_start", { sessionId: sid });
          break;
        case "session.idle": {
          // session.idle = the assistant finished its turn — the best moment
          // to grab the final usage for the turn.
          const usage = pickUsage(event);
          await notify("stop", { sessionId: sid, usage });
          break;
        }
        case "session.error":
          await notify("error", {
            sessionId: sid,
            message: pickMessageText(event),
          });
          break;
        case "session.deleted":
          await notify("session_end", { sessionId: sid });
          break;
        case "message.updated":
        case "message.part.updated": {
          const role = pickRole(event);
          if (role === "user") {
            await notify("user_prompt", {
              sessionId: sid,
              message: pickMessageText(event),
            });
          } else if (role === "assistant") {
            // Assistant messages carry usage. Forward as a tool_use-shaped
            // snapshot so the HUD's context bar stays live mid-turn — but we
            // don't want to flip the pill to "working" if it's already done,
            // so only attach usage (no status change implied beyond what the
            // HUD state machine already does with a tool_use event).
            const usage = pickUsage(event);
            if (usage) {
              await notify("tool_use", { sessionId: sid, usage });
            }
          }
          break;
        }
        default:
          break;
      }
    },

    // Tool hooks carry the tool name + args directly.
    //
    // OpenCode's `tool.execute.before(input, output)` signature puts the
    // *tool input* (the command the agent is about to run) in the FIRST
    // argument `input`, while `output` is the result of a PREVIOUS execution
    // and is undefined at "before" time. We must read the command from
    // `input`, not `output` — otherwise Bash commands (and therefore WSL
    // invocations like `wsl python train.py`) are never forwarded to the HUD
    // and the WSL monitor silently never fires.
    "tool.execute.before": async (input, output) => {
      const tool = pick(input, "tool", "name") || "tool";
      const sid =
        pick(input, "sessionID", "sessionId", "session_id") || lastSessionId;
      const args = input?.args ?? input?.input;
      await notify("tool_use", {
        sessionId: sid,
        tool: String(tool),
        message: describeArgs(args),
      });
    },
  };
};
