#!/usr/bin/env node
// Forwards a Claude Code hook invocation to the Light desktop app.
// Usage:  node claude-hook.mjs <event-type>
// Where <event-type> is one of: user_prompt | tool_use | stop | notification
// The Claude Code hook system pipes a JSON payload to stdin, which we
// parse for sessionId, tool name, and prompt text.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = Number(process.env.LIGHT_PORT || 51789);
const HOST = "127.0.0.1";
const TYPE = process.argv[2];
// Which agent is reporting: Claude Code by default, or another agent whose
// hooks use the same payload shape (WorkBuddy → "workbuddy"). Passed as the
// second argv by the one-click installer, or via LIGHT_AGENT.
const AGENT = process.argv[3] || process.env.LIGHT_AGENT || "claude-code";

// Debug log so we can see whether Claude is actually invoking us.
const LOG_PATH = path.join(os.tmpdir(), "light-hook.log");
function logLine(s) {
  try {
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${s}\n`);
  } catch {
    /* ignore */
  }
}
logLine(`invoked type=${TYPE} pid=${process.pid} cwd=${process.cwd()}`);

const VALID = new Set([
  "user_prompt",
  "tool_use",
  "stop",
  "notification",
  "error",
  "session_start",
  "session_end",
]);
if (!VALID.has(TYPE)) {
  console.error(`claude-hook: invalid type "${TYPE}"`);
  process.exit(2);
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    // 1-second cap so we never hang Claude's hook pipeline.
    setTimeout(() => resolve(data), 1000).unref();
  });
}

function pickFields(parsed) {
  if (!parsed || typeof parsed !== "object") return {};
  const sessionId =
    typeof parsed.session_id === "string" ? parsed.session_id : undefined;
  const tool =
    typeof parsed.tool_name === "string" ? parsed.tool_name : undefined;
  let message;
  if (typeof parsed.prompt === "string") message = parsed.prompt;
  else if (typeof parsed.message === "string") message = parsed.message;
  // PreToolUse payloads carry the actual command under tool_input — without
  // this, the Bash tool's command text (e.g. `wsl python train.py`) never
  // reaches the HUD, so it can't tell a WSL invocation apart from any other
  // shell command. prompt/message are absent on PreToolUse, so this branch
  // only fires for tool_use-shaped payloads.
  else if (parsed.tool_input && typeof parsed.tool_input === "object") {
    if (typeof parsed.tool_input.command === "string") {
      message = parsed.tool_input.command;
    } else if (typeof parsed.tool_input.description === "string") {
      message = parsed.tool_input.description;
    }
  }
  const transcriptPath =
    typeof parsed.transcript_path === "string" ? parsed.transcript_path : undefined;
  const model =
    typeof parsed.model === "string" ? parsed.model : undefined;
  return { sessionId, tool, message, transcriptPath, model };
}

// Known context window limits per model family. Used to render the "how full
// is the context" bar. Claude Code's hook payload carries a `model` field on
// SessionStart; we match its prefix here. When unknown we fall back to 200k
// (the current Claude 4 default) so the bar still shows something useful.
const CONTEXT_LIMITS = [
  { match: /opus-4-1|opus-4\.1/i, limit: 200000 },
  { match: /opus-4/i, limit: 200000 },
  { match: /sonnet-4/i, limit: 200000 },
  { match: /haiku-4/i, limit: 200000 },
  { match: /3-7-sonnet|3\.7-sonnet/i, limit: 200000 },
  { match: /3-5-haiku|3\.5-haiku/i, limit: 200000 },
  { match: /3-5-sonnet|3\.5-sonnet/i, limit: 200000 },
];
function contextLimitFor(model) {
  if (!model) return undefined;
  for (const { match, limit } of CONTEXT_LIMITS) {
    if (match.test(model)) return limit;
  }
  return 200000;
}

// Parse the Claude Code transcript JSONL and extract token usage.
//
// The transcript is one JSON object per line. Assistant turns carry a
// `message.usage` object with input_tokens / output_tokens /
// cache_read_input_tokens / cache_creation_input_tokens. The LAST assistant
// turn's usage tells us the current context size; summing every turn's
// (input + output) gives the session's cumulative bill.
//
// Returns null if the transcript can't be read or has no usage yet (e.g. the
// session just started and no assistant reply has landed).
function readUsage(transcriptPath, model) {
  if (!transcriptPath) return null;
  let content;
  try {
    content = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }
  let lastUsage = null;
  let totalInput = 0;
  let totalOutput = 0;
  let lastModel;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    // Claude Code transcripts wrap each message under `message`, and assistant
    // turns carry `message.usage`. Some entries (summaries, user turns) have no
    // usage — skip them.
    const msg = entry?.message ?? entry;
    const role = msg?.role || entry?.type || entry?.role;
    const usage = msg?.usage ?? entry?.usage;
    if (!usage || typeof usage !== "object") continue;
    if (role && role !== "assistant" && role !== "result") continue;
    const input = Number(usage.input_tokens ?? usage.inputTokens ?? 0) || 0;
    const output = Number(usage.output_tokens ?? usage.outputTokens ?? 0) || 0;
    const cacheRead = Number(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? 0) || 0;
    const cacheCreate = Number(usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens ?? 0) || 0;
    // The context at the time of this turn = everything sent in = input + cache.
    lastUsage = { input, output, cacheRead, cacheCreate };
    totalInput += input + cacheRead + cacheCreate;
    totalOutput += output;
    if (msg?.model) lastModel = msg.model;
  }
  if (!lastUsage) return null;
  const ctxTokens = lastUsage.input + lastUsage.cacheRead + lastUsage.cacheCreate;
  const resolvedModel = model || lastModel;
  return {
    contextTokens: ctxTokens,
    contextLimit: contextLimitFor(resolvedModel),
    outputTokens: lastUsage.output,
    totalTokens: totalInput + totalOutput,
    model: resolvedModel,
  };
}

function post(payload) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: "/event",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
        },
        timeout: 800,
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body: buf }));
      },
    );
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
    req.write(body);
    req.end();
  });
}

async function postWithLog(payload) {
  const result = await post(payload);
  logLine(`post type=${payload.type} -> ${JSON.stringify(result)}`);
  return result;
}

(async () => {
  const raw = await readStdin();
  let parsed = {};
  try {
    if (raw.trim()) parsed = JSON.parse(raw);
  } catch {
    /* ignore parse errors — the event still goes through */
  }
  const fields = pickFields(parsed);

  // Reading the transcript is the only way to get token usage — Claude Code's
  // hook payload itself doesn't carry it. We do this on the events where a
  // fresh usage figure is most meaningful: session_start (initial state, often
  // empty), tool_use (mid-turn snapshot), and stop (final tally for the turn).
  // session_end/user_prompt skip it to keep the hook fast.
  let usage;
  if (
    fields.transcriptPath &&
    (TYPE === "stop" || TYPE === "tool_use" || TYPE === "session_start")
  ) {
    try {
      usage = readUsage(fields.transcriptPath, fields.model);
      if (usage) logLine(`usage ctx=${usage.contextTokens}/${usage.contextLimit} total=${usage.totalTokens} model=${usage.model}`);
    } catch (e) {
      logLine(`readUsage failed: ${e?.message || e}`);
    }
  }

  const ok = await postWithLog({
    agent: AGENT,
    type: TYPE,
    sessionId: fields.sessionId,
    tool: fields.tool,
    message: fields.message,
    timestamp: new Date().toISOString(),
    usage,
  });
  // Always exit 0 — we don't want to break Claude's hook pipeline if Light is offline.
  process.exit(0);
})();
