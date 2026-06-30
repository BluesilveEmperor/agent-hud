"use strict";
// Theme store: light / dark / auto (follow system).
//
// Persisted to userData/theme.json. The "auto" mode resolves to light or dark
// by reading Electron's nativeTheme.shouldUseDarkColors, and re-resolves
// whenever the OS theme changes (main.ts wires the nativeTheme 'updated'
// event). The effective colour is applied to the renderer by toggling a
// `light` class on <html>.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThemeStore = void 0;
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const DEFAULT = "dark";
class ThemeStore {
    filePath;
    theme = DEFAULT;
    constructor(userDataDir) {
        this.filePath = node_path_1.default.join(userDataDir, "theme.json");
        this.load();
    }
    load() {
        try {
            if (node_fs_1.default.existsSync(this.filePath)) {
                const raw = node_fs_1.default.readFileSync(this.filePath, "utf8");
                const parsed = JSON.parse(raw);
                const t = parsed?.theme;
                if (t === "light" || t === "dark" || t === "auto")
                    this.theme = t;
            }
        }
        catch {
            /* ignore — fall back to default */
        }
    }
    save() {
        try {
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(this.filePath), { recursive: true });
            node_fs_1.default.writeFileSync(this.filePath, JSON.stringify({ theme: this.theme }), "utf8");
        }
        catch {
            /* ignore */
        }
    }
    get() {
        return this.theme;
    }
    set(t) {
        this.theme = t;
        this.save();
        return this.theme;
    }
    // Resolve "auto" to the actual colour the renderer should use right now.
    effective() {
        if (this.theme === "auto")
            return electron_1.nativeTheme.shouldUseDarkColors ? "dark" : "light";
        return this.theme;
    }
}
exports.ThemeStore = ThemeStore;
//# sourceMappingURL=theme.js.map