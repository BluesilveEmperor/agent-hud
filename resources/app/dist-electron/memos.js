"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoStore = void 0;
const node_events_1 = require("node:events");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const MEMO_LIMIT = 50;
const TEXT_LIMIT = 200;
function newId() {
    return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
}
class MemoStore extends node_events_1.EventEmitter {
    memos = [];
    filePath;
    saving = false;
    pendingSave = false;
    constructor(filePath) {
        super();
        this.filePath = filePath;
        this.load();
    }
    load() {
        try {
            if (node_fs_1.default.existsSync(this.filePath)) {
                const raw = node_fs_1.default.readFileSync(this.filePath, "utf8");
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    this.memos = parsed
                        .filter((m) => m && typeof m.id === "string" && typeof m.text === "string")
                        .map((m) => ({
                        id: String(m.id),
                        text: String(m.text).slice(0, TEXT_LIMIT),
                        completed: Boolean(m.completed),
                        createdAt: typeof m.createdAt === "string" ? m.createdAt : new Date().toISOString(),
                        completedAt: typeof m.completedAt === "string" ? m.completedAt : undefined,
                    }));
                }
            }
        }
        catch (err) {
            console.error("[memos] load failed:", err);
            this.memos = [];
        }
    }
    async save() {
        if (this.saving) {
            this.pendingSave = true;
            return;
        }
        this.saving = true;
        try {
            const dir = node_path_1.default.dirname(this.filePath);
            await node_fs_1.default.promises.mkdir(dir, { recursive: true });
            const tmp = this.filePath + ".tmp";
            await node_fs_1.default.promises.writeFile(tmp, JSON.stringify(this.memos, null, 2), "utf8");
            await node_fs_1.default.promises.rename(tmp, this.filePath);
        }
        catch (err) {
            console.error("[memos] save failed:", err);
        }
        finally {
            this.saving = false;
            if (this.pendingSave) {
                this.pendingSave = false;
                this.save();
            }
        }
    }
    list() {
        return JSON.parse(JSON.stringify(this.memos));
    }
    add(rawText) {
        const text = String(rawText ?? "").trim();
        if (!text)
            return null;
        if (this.memos.length >= MEMO_LIMIT) {
            // drop the oldest completed memo to make room
            const dropIdx = this.memos.findIndex((m) => m.completed);
            if (dropIdx >= 0)
                this.memos.splice(dropIdx, 1);
            else
                this.memos.shift();
        }
        const memo = {
            id: newId(),
            text: text.slice(0, TEXT_LIMIT),
            completed: false,
            createdAt: new Date().toISOString(),
        };
        this.memos.push(memo);
        this.save();
        this.emit("change", this.list());
        return memo;
    }
    toggle(id) {
        const m = this.memos.find((x) => x.id === id);
        if (!m)
            return;
        m.completed = !m.completed;
        m.completedAt = m.completed ? new Date().toISOString() : undefined;
        this.save();
        this.emit("change", this.list());
    }
    delete(id) {
        const idx = this.memos.findIndex((x) => x.id === id);
        if (idx < 0)
            return;
        this.memos.splice(idx, 1);
        this.save();
        this.emit("change", this.list());
    }
}
exports.MemoStore = MemoStore;
//# sourceMappingURL=memos.js.map