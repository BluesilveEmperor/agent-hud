#!/usr/bin/env node
// Coarse-grained wrapper fallback for OpenCode / DevEco Code.
// Usage:  node agent-wrap.mjs <args-passed-to-the-agent...>
//
// Driven by env:
//   LIGHT_AGENT     "opencode" | "deveco-code"  (which identity to report)
//   LIGHT_WRAP_BIN  the CLI to spawn (e.g. opencode / deveco-code)
// The .cmd/.sh entry scripts (opencode-wrap.*, deveco-wrap.*) set these for
// you. Prefer the plugin install (hooks/opencode/light-hud.mjs) for full
// per-tool fidelity — this wrapper only sees process start / stop.

import http from "node:http";
import { spawn } from "node:child_process";

const PORT = Number(process.env.LIGHT_PORT || 51789);
const HOST = "127.0.0.1";
const AGENT = process.env.LIGHT_AGENT || "opencode";
const BIN = process.env.LIGHT_WRAP_BIN || AGENT;

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
        timeout: 600,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(true));
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}

async function notify(type, extra = {}) {
  await post({
    agent: AGENT,
    type,
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

const args = process.argv.slice(2);

(async () => {
  await notify("session_start");
  await notify("user_prompt", {
    message: args.join(" ").slice(0, 200) || `(${AGENT} session)`,
  });

  const child = spawn(BIN, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  const exitCode = await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(127));
  });

  if (exitCode === 0) {
    await notify("stop");
  } else {
    await notify("error", { message: `${AGENT} exited with ${exitCode}` });
  }
  // Show the done/error state briefly, then remove the session from the HUD.
  await new Promise((r) => setTimeout(r, 4000));
  await notify("session_end");
  process.exit(exitCode);
})();
