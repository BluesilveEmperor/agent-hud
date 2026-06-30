"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("light", {
    onEvent: (cb) => {
        const listener = (_, evt) => cb(evt);
        electron_1.ipcRenderer.on("light:event", listener);
        return () => electron_1.ipcRenderer.off("light:event", listener);
    },
    onState: (cb) => {
        const listener = (_, state) => cb(state);
        electron_1.ipcRenderer.on("light:state", listener);
        return () => electron_1.ipcRenderer.off("light:state", listener);
    },
    onMemos: (cb) => {
        const listener = (_, memos) => cb(memos);
        electron_1.ipcRenderer.on("light:memos", listener);
        return () => electron_1.ipcRenderer.off("light:memos", listener);
    },
    onSystem: (cb) => {
        const listener = (_, state) => cb(state);
        electron_1.ipcRenderer.on("light:system", listener);
        return () => electron_1.ipcRenderer.off("light:system", listener);
    },
    onBlur: (cb) => {
        const listener = () => cb();
        electron_1.ipcRenderer.on("light:blur", listener);
        return () => electron_1.ipcRenderer.off("light:blur", listener);
    },
    onHover: (cb) => {
        const listener = (_, over) => cb(over);
        electron_1.ipcRenderer.on("light:hover", listener);
        return () => electron_1.ipcRenderer.off("light:hover", listener);
    },
    getState: () => electron_1.ipcRenderer.invoke("light:get-state"),
    getMemos: () => electron_1.ipcRenderer.invoke("light:get-memos"),
    getSystem: () => electron_1.ipcRenderer.invoke("light:get-system"),
    addMemo: (text) => electron_1.ipcRenderer.send("light:add-memo", text),
    toggleMemo: (id) => electron_1.ipcRenderer.send("light:toggle-memo", id),
    deleteMemo: (id) => electron_1.ipcRenderer.send("light:delete-memo", id),
    clearEvents: () => electron_1.ipcRenderer.send("light:clear-events"),
    removeSession: (key) => electron_1.ipcRenderer.send("light:remove-session", key),
    getHooksStatus: () => electron_1.ipcRenderer.invoke("light:get-hooks-status"),
    installHooks: (agent) => electron_1.ipcRenderer.invoke("light:install-hooks", agent),
    getHistory: (q) => electron_1.ipcRenderer.invoke("light:get-history", q),
    getStats: (opts) => electron_1.ipcRenderer.invoke("light:get-stats", opts),
    getNotifyConfig: () => electron_1.ipcRenderer.invoke("light:get-notify-config"),
    setNotifyConfig: (patch) => electron_1.ipcRenderer.invoke("light:set-notify-config", patch),
    testNotify: () => electron_1.ipcRenderer.invoke("light:test-notify"),
    getTheme: () => electron_1.ipcRenderer.invoke("light:get-theme"),
    setTheme: (t) => electron_1.ipcRenderer.invoke("light:set-theme", t),
    onTheme: (cb) => {
        const listener = (_, v) => cb(v);
        electron_1.ipcRenderer.on("light:theme", listener);
        return () => electron_1.ipcRenderer.off("light:theme", listener);
    },
    onHistoryUpdated: (cb) => {
        const listener = () => cb();
        electron_1.ipcRenderer.on("light:history-updated", listener);
        return () => electron_1.ipcRenderer.off("light:history-updated", listener);
    },
    mediaControl: (action) => electron_1.ipcRenderer.send("light:media-control", action),
    setHotZones: (zones) => electron_1.ipcRenderer.send("light:set-hot-zones", zones),
    quit: () => electron_1.ipcRenderer.send("light:quit"),
});
//# sourceMappingURL=preload.js.map