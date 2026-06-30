"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WinBridge = void 0;
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const node_readline_1 = __importDefault(require("node:readline"));
const POWERSHELL = "powershell.exe";
class WinBridge {
    store;
    bridgeScript;
    controlScript;
    child = null;
    stopped = false;
    restartTimer = null;
    constructor(store, bridgeDir) {
        this.store = store;
        this.bridgeScript = node_path_1.default.join(bridgeDir, "win-bridge.ps1");
        this.controlScript = node_path_1.default.join(bridgeDir, "media-control.ps1");
    }
    start() {
        if (process.platform !== "win32") {
            console.log("[winbridge] non-Windows platform, skipping");
            return;
        }
        this.spawnChild();
    }
    stop() {
        this.stopped = true;
        if (this.restartTimer)
            clearTimeout(this.restartTimer);
        if (this.child) {
            try {
                this.child.kill();
            }
            catch { }
            this.child = null;
        }
    }
    spawnChild() {
        if (this.stopped)
            return;
        this.child = (0, node_child_process_1.spawn)(POWERSHELL, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", this.bridgeScript], { windowsHide: true });
        this.child.stdout?.setEncoding("utf8");
        const rl = node_readline_1.default.createInterface({ input: this.child.stdout });
        rl.on("line", (line) => this.handleLine(line));
        this.child.stderr?.setEncoding("utf8");
        this.child.stderr?.on("data", (d) => {
            const s = String(d).trim();
            if (s)
                console.error("[winbridge:stderr]", s.slice(0, 200));
        });
        this.child.on("exit", (code) => {
            console.log("[winbridge] exited", code);
            this.child = null;
            if (!this.stopped) {
                this.restartTimer = setTimeout(() => this.spawnChild(), 3000);
            }
        });
        this.child.on("error", (err) => {
            console.error("[winbridge] spawn error", err.message);
        });
    }
    handleLine(line) {
        const trimmed = line.trim();
        if (!trimmed)
            return;
        let obj;
        try {
            obj = JSON.parse(trimmed);
        }
        catch {
            return;
        }
        switch (obj.kind) {
            case "ready":
                this.store.setReady(Boolean(obj.media));
                break;
            case "media":
                if (obj.none) {
                    this.store.clearMedia();
                }
                else {
                    this.store.setMedia(Boolean(obj.playing), obj.title, obj.artist, obj.app);
                }
                break;
        }
    }
    control(action) {
        if (process.platform !== "win32")
            return;
        const valid = ["next", "prev", "playpause", "play", "pause"];
        if (!valid.includes(action))
            return;
        (0, node_child_process_1.execFile)(POWERSHELL, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", this.controlScript, action], { windowsHide: true, timeout: 4000 }, (err) => {
            if (err)
                console.error("[winbridge] control error", action, err.message);
        });
    }
}
exports.WinBridge = WinBridge;
//# sourceMappingURL=winbridge.js.map