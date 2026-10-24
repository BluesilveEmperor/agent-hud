#!/usr/bin/env node
// Forwards a Hermes Agent shell-hook invocation to the Light desktop app.
// Usage:  node hermes-hook.mjs <event-type>
// Where <event-type> is one of: session_start | session_end | user_prompt |
//                               tool_use | stop
//
// Hermes (https://hermes-agent.nousresearch.com) runs each configured shell
// hook as a subprocess: a JSON payload arrives on stdin and an optional JSON
// response is read back from stdout. Payload shape (all events):
//   { "hook_event_name": "pre_tool_call", "tool_name": ..., "tool_input": ...,
//     "session_id": "...", "cwd": "...", "extra": { ...event-specific } }
// Event-specific fields (user_message, model, platform, ...) live in `extra`.
//
// Registered in ~/.hermes/config.yaml (see hooks/README.md §5):
//   on_session_start    -> session_start
//   on_session_finalize -> session_end   (fires on /new, GC, CLI exit)
//   pre_llm_call        -> user_prompt   (extra.user_message)
//   pre_tool_call       -> tool_use
//   post_llm_call       -> stop          (turn completed)
//   on_session_end      -> stop          (covers interrupted turns)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = Number(process.env.LIGHT_PORT || 51789);
const HOST = "127.0.0.1";
const TYPE = process.argv[2];

// Debug log so we can see whether Hermes is actually invoking us.
const LOG_PATH = path.join(os.tmpdir(), "light-hook.log");
function logLine(s) {
  try {
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${s}\n`);
  } catch {
    /* ignore */
  }
}
logLine(`hermes invoked type=${TYPE} pid=${process.pid} cwd=${process.cwd()}`);

const VALID = new Set([
  "user_prompt",
  "tool_use",
  "stop",
  "session_start",
  "session_end",
]);
if (!VALID.has(TYPE)) {
  // Hermes treats malformed output / non-zero exits as warnings only, but we
  // still exit cleanly — an unknown type just means no event is forwarded.
  console.log("{}");
  process.exit(0);
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    // 1-second cap so we never hang Hermes' hook pipeline.
    setTimeout(() => resolve(data), 1000).unref();
  });
}

function pickFields(parsed) {
  if (!parsed || typeof parsed !== "object") return {};
  const sessionId =
    typeof parsed.session_id === "string" ? parsed.session_id : undefined;
  const tool =
    typeof parsed.tool_name === "string" ? parsed.tool_name : undefined;
  const extra =
    parsed.extra && typeof parsed.extra === "object" ? parsed.extra : {};

  let message;
  if (typeof extra.user_message === "string") message = extra.user_message;
  else if (typeof parsed.tool_input === "object" && parsed.tool_input) {
    if (typeof parsed.tool_input.command === "string") {
      message = parsed.tool_input.command;
    } else if (typeof parsed.tool_input.description === "string") {
      message = parsed.tool_input.description;
    } else if (typeof parsed.tool_input.path === "string") {
      message = parsed.tool_input.path;
    }
  }

  const model = typeof extra.model === "string" ? extra.model : undefined;
  return { sessionId, tool, message, model };
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

(async () => {
  const raw = await readStdin();
  let parsed = {};
  try {
    if (raw.trim()) parsed = JSON.parse(raw);
  } catch {
    /* ignore parse errors — the event still goes through */
  }
  const fields = pickFields(parsed);

  const result = await post({
    agent: "hermes",
    type: TYPE,
    sessionId: fields.sessionId,
    tool: fields.tool,
    message: fields.message,
    timestamp: new Date().toISOString(),
    // Hermes' hook payload carries the model id but no token counters, so we
    // report only what we know — the HUD hides the usage bar in that case.
    usage: fields.model ? { model: fields.model } : undefined,
  });
  logLine(`hermes post type=${TYPE} -> ${JSON.stringify(result)}`);

  // Hermes expects an optional JSON response on stdout. "{}" is a silent
  // no-op: never block, never inject context. Always exit 0 so a HUD outage
  // can never disturb the agent loop.
  console.log("{}");
  process.exit(0);
})();
