import { contextBridge, ipcRenderer } from "electron";

interface HotZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

contextBridge.exposeInMainWorld("light", {
  onEvent: (cb: (evt: unknown) => void) => {
    const listener = (_: unknown, evt: unknown) => cb(evt);
    ipcRenderer.on("light:event", listener);
    return () => ipcRenderer.off("light:event", listener);
  },
  onState: (cb: (state: unknown) => void) => {
    const listener = (_: unknown, state: unknown) => cb(state);
    ipcRenderer.on("light:state", listener);
    return () => ipcRenderer.off("light:state", listener);
  },
  onMemos: (cb: (memos: unknown) => void) => {
    const listener = (_: unknown, memos: unknown) => cb(memos);
    ipcRenderer.on("light:memos", listener);
    return () => ipcRenderer.off("light:memos", listener);
  },
  onSystem: (cb: (state: unknown) => void) => {
    const listener = (_: unknown, state: unknown) => cb(state);
    ipcRenderer.on("light:system", listener);
    return () => ipcRenderer.off("light:system", listener);
  },
  onBlur: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("light:blur", listener);
    return () => ipcRenderer.off("light:blur", listener);
  },
  onHover: (cb: (over: boolean) => void) => {
    const listener = (_: unknown, over: boolean) => cb(over);
    ipcRenderer.on("light:hover", listener);
    return () => ipcRenderer.off("light:hover", listener);
  },
  getState: () => ipcRenderer.invoke("light:get-state"),
  getMemos: () => ipcRenderer.invoke("light:get-memos"),
  getSystem: () => ipcRenderer.invoke("light:get-system"),
  addMemo: (text: string) => ipcRenderer.send("light:add-memo", text),
  toggleMemo: (id: string) => ipcRenderer.send("light:toggle-memo", id),
  deleteMemo: (id: string) => ipcRenderer.send("light:delete-memo", id),
  clearEvents: () => ipcRenderer.send("light:clear-events"),
  removeSession: (key: string) => ipcRenderer.send("light:remove-session", key),
  getHooksStatus: () => ipcRenderer.invoke("light:get-hooks-status"),
  installHooks: (agent: string) => ipcRenderer.invoke("light:install-hooks", agent),
  getHistory: (q: unknown) => ipcRenderer.invoke("light:get-history", q),
  getStats: (opts: unknown) => ipcRenderer.invoke("light:get-stats", opts),
  getNotifyConfig: () => ipcRenderer.invoke("light:get-notify-config"),
  setNotifyConfig: (patch: Record<string, unknown>) => ipcRenderer.invoke("light:set-notify-config", patch),
  testNotify: () => ipcRenderer.invoke("light:test-notify"),
  getTheme: () => ipcRenderer.invoke("light:get-theme"),
  setTheme: (t: string) => ipcRenderer.invoke("light:set-theme", t),
  onTheme: (cb: (t: { theme: string; effective: string }) => void) => {
    const listener = (_: unknown, v: { theme: string; effective: string }) => cb(v);
    ipcRenderer.on("light:theme", listener);
    return () => ipcRenderer.off("light:theme", listener);
  },
  onHistoryUpdated: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("light:history-updated", listener);
    return () => ipcRenderer.off("light:history-updated", listener);
  },
  mediaControl: (action: string) => ipcRenderer.send("light:media-control", action),
  setHotZones: (zones: HotZone[]) => ipcRenderer.send("light:set-hot-zones", zones),
  quit: () => ipcRenderer.send("light:quit"),
});
