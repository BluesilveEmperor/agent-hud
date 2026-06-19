#!/usr/bin/env node
// Forwards a Codex CLI hook invocation to the Light desktop app.
// Usage:  node codex-hook.mjs <event-type>
// Where <event-type> is one of: session_start | user_prompt | tool_use | stop
//
// Codex CLI's hooks system mirrors Claude Code's: it pipes a JSON payload to
// the command's stdin (fields: session_id, tool_name, tool_input, prompt, cwd,
// hook_event_name …). We parse it and POST a Light event to 127.0.0.1:51789.
//
// Wire it up in ~/.codex/hooks.json — see codex-hooks.example.json. Note Codex
// has no SessionEnd event, so a Codex session is never explicitly removed; it
// simply settles to "idle" after Stop and is garbage-collected later.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = Number(process.env.LIGHT_PORT || 51789);
const HOST = "127.0.0.1";
const TYPE = process.argv[2];
const LOG_PATH = path.join(os.tmpdir(), "light-codex-hook.log");

const VALID = new Set([
  "session_start",
  "user_prompt",
  "tool_use",
  "stop",
  "notification",
  "error",
  "session_end",
]);

function logLine(message) {
  try {
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* ignore */
  }
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    // 1-second cap so we never hang Codex's hook pipeline.
    setTimeout(() => resolve(data), 1000).unref();
  });
}

function safeStringify(value, max = 200) {
  if (value == null) return undefined;
  if (typeof value === "string") return value.slice(0, max);
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return undefined;
  }
}

function pickFields(parsed) {
  if (!parsed || typeof parsed !== "object") return {};

  let message;
  if (typeof parsed.prompt === "string") {
    message = parsed.prompt;
  } else if (typeof parsed.last_assistant_message === "string") {
    message = parsed.last_assistant_message;
  } else if (parsed.tool_input && typeof parsed.tool_input === "object") {
    message = safeStringify(parsed.tool_input.command ?? parsed.tool_input);
  }

  return {
    sessionId: typeof parsed.session_id === "string" ? parsed.session_id : undefined,
    tool: typeof parsed.tool_name === "string" ? parsed.tool_name : undefined,
    message,
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
        res.on("data", (chunk) => {
          buf += chunk;
        });
        res.on("end", () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body: buf }));
      },
    );
    req.on("error", (error) => resolve({ ok: false, error: error.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
    req.write(body);
    req.end();
  });
}

(async () => {
  logLine(`invoked type=${TYPE} pid=${process.pid} cwd=${process.cwd()}`);

  if (!VALID.has(TYPE)) {
    logLine(`invalid type=${TYPE}`);
    process.exit(0);
  }

  const raw = await readStdin();
  let parsed = {};
  try {
    if (raw.trim()) parsed = JSON.parse(raw);
  } catch {
    logLine("stdin parse failed");
  }

  const fields = pickFields(parsed);
  const result = await post({
    agent: "codex",
    type: TYPE,
    sessionId: fields.sessionId,
    tool: fields.tool,
    message: fields.message,
    timestamp: new Date().toISOString(),
  });
  logLine(`post type=${TYPE} -> ${JSON.stringify(result)}`);

  // Hook failures must never interrupt Codex if Light isn't running.
  process.exit(0);
})();
