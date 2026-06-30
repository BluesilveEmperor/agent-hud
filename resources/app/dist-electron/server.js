"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PORT = void 0;
exports.startServer = startServer;
const node_http_1 = __importDefault(require("node:http"));
const state_1 = require("./state");
exports.DEFAULT_PORT = 51789;
const MAX_BODY_BYTES = 32 * 1024;
function startServer(store, port = exports.DEFAULT_PORT) {
    const server = node_http_1.default.createServer((req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        if (req.method === "GET" && req.url === "/health") {
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, version: 1 }));
            return;
        }
        if (req.method === "GET" && req.url === "/state") {
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, state: store.getState() }));
            return;
        }
        if (req.method === "POST" && req.url === "/event") {
            let received = 0;
            const chunks = [];
            req.on("data", (chunk) => {
                received += chunk.length;
                if (received > MAX_BODY_BYTES) {
                    res.statusCode = 413;
                    res.end(JSON.stringify({ ok: false, error: "body too large" }));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            req.on("end", () => {
                try {
                    const raw = Buffer.concat(chunks).toString("utf8");
                    const body = raw.trim() ? JSON.parse(raw) : {};
                    if (!(0, state_1.isValidAgent)(body.agent)) {
                        res.statusCode = 400;
                        res.end(JSON.stringify({ ok: false, error: "invalid agent" }));
                        return;
                    }
                    if (!(0, state_1.isValidType)(body.type)) {
                        res.statusCode = 400;
                        res.end(JSON.stringify({ ok: false, error: "invalid type" }));
                        return;
                    }
                    const evt = {
                        agent: body.agent,
                        type: body.type,
                        sessionId: body.sessionId,
                        tool: body.tool,
                        message: body.message,
                        timestamp: body.timestamp ?? new Date().toISOString(),
                        usage: body.usage,
                    };
                    const ingested = store.ingest(evt);
                    res.statusCode = 200;
                    res.end(JSON.stringify({ ok: true, event: ingested }));
                }
                catch (err) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "bad json" }));
                }
            });
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: "not found" }));
    });
    server.listen(port, "127.0.0.1");
    return server;
}
//# sourceMappingURL=server.js.map