"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const state_1 = require("./state");
const server_1 = require("./server");
const memos_1 = require("./memos");
const system_1 = require("./system");
const winbridge_1 = require("./winbridge");
const hooks_setup_1 = require("./hooks-setup");
const history_1 = require("./history");
const notifier_1 = require("./notifier");
const theme_1 = require("./theme");
const WINDOW_WIDTH = 640;
const WINDOW_HEIGHT = 520;
const CURSOR_POLL_MS = 60;
let mainWindow = null;
let tray = null;
let cursorTimer = null;
let currentlyIgnoring = true;
let hotZones = [];
let lastHoverSent = null;
const store = new state_1.StateStore();
const systemStore = new system_1.SystemStore();
let memoStore = null;
let winBridge = null;
let historyStore = null;
let notifier = null;
let themeStore = null;
function getDevServerUrl() {
    return process.env.VITE_DEV_SERVER_URL;
}
// The branded icon, resolved for both layouts:
//   packaged → resources/app/icon.ico   (staged by scripts/stage.mjs)
//   dev      → <root>/installer/light.ico
function resolveIcon() {
    const candidates = [
        node_path_1.default.join(__dirname, "..", "icon.ico"),
        node_path_1.default.join(__dirname, "..", "installer", "light.ico"),
    ];
    for (const c of candidates) {
        try {
            if (node_fs_1.default.existsSync(c))
                return c;
        }
        catch {
            /* ignore */
        }
    }
    return undefined;
}
function createWindow() {
    const display = electron_1.screen.getPrimaryDisplay();
    const { width: screenW } = display.workAreaSize;
    mainWindow = new electron_1.BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        x: Math.round((screenW - WINDOW_WIDTH) / 2),
        y: 0,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        movable: true,
        skipTaskbar: true,
        hasShadow: false,
        focusable: true,
        show: false,
        icon: resolveIcon(),
        backgroundColor: "#00000000",
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    setIgnore(true);
    const devUrl = getDevServerUrl();
    if (devUrl) {
        mainWindow.loadURL(devUrl);
    }
    else {
        mainWindow.loadFile(node_path_1.default.join(__dirname, "..", "dist", "index.html"));
    }
    mainWindow.once("ready-to-show", () => {
        mainWindow?.showInactive();
        startCursorPoll();
        // Apply the persisted theme before the capsule becomes visible, so there's
        // no dark→light flash on a light-mode user's screen.
        pushThemeToRenderer();
    });
    // Click outside the island/panel (focus moves to another app) → collapse panel.
    mainWindow.on("blur", () => {
        mainWindow?.webContents.send("light:blur");
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
        stopCursorPoll();
    });
}
function setIgnore(ignore) {
    if (!mainWindow)
        return;
    if (ignore === currentlyIgnoring)
        return;
    if (ignore) {
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
    else {
        mainWindow.setIgnoreMouseEvents(false);
    }
    currentlyIgnoring = ignore;
}
function startCursorPoll() {
    stopCursorPoll();
    cursorTimer = setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed())
            return;
        const cursor = electron_1.screen.getCursorScreenPoint();
        const bounds = mainWindow.getBounds();
        const localX = cursor.x - bounds.x;
        const localY = cursor.y - bounds.y;
        const overHotZone = hotZones.some((z) => localX >= z.x && localX < z.x + z.w && localY >= z.y && localY < z.y + z.h);
        setIgnore(!overHotZone);
        // Authoritative hover signal. DOM mouseenter/leave are unreliable while the
        // window is click-through (the OS stops delivering events once the cursor
        // leaves a hot zone, so the renderer's `mouseleave` may never fire and the
        // pill stays stuck "expanded"). The cursor poll always knows the truth, so
        // we drive hover from here and only emit on change.
        if (overHotZone !== lastHoverSent) {
            lastHoverSent = overHotZone;
            mainWindow.webContents.send("light:hover", overHotZone);
        }
    }, CURSOR_POLL_MS);
}
function stopCursorPoll() {
    if (cursorTimer)
        clearInterval(cursorTimer);
    cursorTimer = null;
    lastHoverSent = null;
}
function buildTrayIcon() {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAY0lEQVR42mNgGAWjYBQMfMD0n4Ghj+E/A+M/A+M/Iw" +
        "MTAxMDAyMDIwMjAyMDIwMzAxMjEwMTIxMDEwMzExMTM/+gM4ABAAYGRgYGBkYGRgZGBgZGBgYAAFLgC2sFqFQ0AAAAA" +
        "SUVORK5CYII=", "base64");
    return electron_1.nativeImage.createFromBuffer(png);
}
function createTray() {
    const iconPath = resolveIcon();
    const trayImg = iconPath ? electron_1.nativeImage.createFromPath(iconPath) : buildTrayIcon();
    tray = new electron_1.Tray(trayImg);
    tray.setToolTip("Light · 桌面状态胶囊");
    const refresh = () => {
        const cur = themeStore?.get() ?? "dark";
        const menu = electron_1.Menu.buildFromTemplate([
            {
                label: mainWindow?.isVisible() ? "Hide" : "Show",
                click: () => {
                    if (!mainWindow)
                        return;
                    if (mainWindow.isVisible())
                        mainWindow.hide();
                    else
                        mainWindow.showInactive();
                },
            },
            { type: "separator" },
            {
                label: "一键接入全部 Agent",
                click: () => {
                    const result = (0, hooks_setup_1.installHooks)("all");
                    electron_1.dialog.showMessageBox({
                        type: result.ok ? "info" : "warning",
                        title: "Light · 接入",
                        message: result.ok ? "接入完成" : "接入未全部成功",
                        detail: result.message,
                        buttons: ["好的"],
                        noLink: true,
                    });
                },
            },
            { type: "separator" },
            {
                label: "主题",
                submenu: [
                    {
                        label: "深色",
                        type: "radio",
                        checked: cur === "dark",
                        click: () => applyTheme("dark"),
                    },
                    {
                        label: "浅色",
                        type: "radio",
                        checked: cur === "light",
                        click: () => applyTheme("light"),
                    },
                    {
                        label: "跟随系统",
                        type: "radio",
                        checked: cur === "auto",
                        click: () => applyTheme("auto"),
                    },
                ],
            },
            { type: "separator" },
            { label: `HTTP :${server_1.DEFAULT_PORT}`, enabled: false },
            { type: "separator" },
            { label: "Quit", click: () => electron_1.app.quit() },
        ]);
        tray?.setContextMenu(menu);
    };
    refresh();
    tray.on("click", () => {
        if (!mainWindow)
            return;
        if (mainWindow.isVisible())
            mainWindow.hide();
        else
            mainWindow.showInactive();
        refresh();
    });
}
// Push the current effective theme to the renderer by toggling the `light`
// class on <html>. Called on startup (after the page loads), on every theme
// change, and when the OS theme flips while in "auto" mode.
function pushThemeToRenderer() {
    if (!mainWindow || mainWindow.isDestroyed())
        return;
    const eff = themeStore?.effective() ?? "dark";
    // Add the class that matches, remove the other. We use both classes so the
    // CSS can target either mode explicitly (and survives a missed event).
    const addClass = eff === "light" ? "light" : "dark";
    const removeClass = eff === "light" ? "dark" : "light";
    mainWindow.webContents.executeJavaScript(`document.documentElement.classList.remove('${removeClass}');` +
        `document.documentElement.classList.add('${addClass}');`).catch(() => { });
    mainWindow.webContents.send("light:theme", { theme: themeStore?.get() ?? "dark", effective: eff });
    tray?.setContextMenu(electron_1.Menu.buildFromTemplate([])); // force tray menu rebuild on next open
    // Rebuild tray menu so the radio reflects the new selection. We can't just
    // call refresh() because it's local to createTray; instead we recreate by
    // re-reading themeStore. Simpler: emit an event the tray rebuilds on.
    rebuildTrayMenu();
}
// Avoid circular ref with createTray: rebuild the menu from a standalone
// helper. This keeps the radio buttons in sync after a theme change.
function rebuildTrayMenu() {
    if (!tray)
        return;
    const cur = themeStore?.get() ?? "dark";
    const menu = electron_1.Menu.buildFromTemplate([
        {
            label: mainWindow?.isVisible() ? "Hide" : "Show",
            click: () => {
                if (!mainWindow)
                    return;
                if (mainWindow.isVisible())
                    mainWindow.hide();
                else
                    mainWindow.showInactive();
            },
        },
        { type: "separator" },
        {
            label: "一键接入全部 Agent",
            click: () => {
                const result = (0, hooks_setup_1.installHooks)("all");
                electron_1.dialog.showMessageBox({
                    type: result.ok ? "info" : "warning",
                    title: "Light · 接入",
                    message: result.ok ? "接入完成" : "接入未全部成功",
                    detail: result.message,
                    buttons: ["好的"],
                    noLink: true,
                });
            },
        },
        { type: "separator" },
        {
            label: "主题",
            submenu: [
                { label: "深色", type: "radio", checked: cur === "dark", click: () => applyTheme("dark") },
                { label: "浅色", type: "radio", checked: cur === "light", click: () => applyTheme("light") },
                { label: "跟随系统", type: "radio", checked: cur === "auto", click: () => applyTheme("auto") },
            ],
        },
        { type: "separator" },
        { label: `HTTP :${server_1.DEFAULT_PORT}`, enabled: false },
        { type: "separator" },
        { label: "Quit", click: () => electron_1.app.quit() },
    ]);
    tray.setContextMenu(menu);
}
function applyTheme(t) {
    if (!themeStore)
        return;
    themeStore.set(t);
    pushThemeToRenderer();
}
function wireIpc() {
    electron_1.ipcMain.handle("light:get-state", () => store.getState());
    electron_1.ipcMain.handle("light:get-memos", () => memoStore?.list() ?? []);
    electron_1.ipcMain.handle("light:get-system", () => systemStore.getState());
    electron_1.ipcMain.on("light:media-control", (_evt, action) => {
        winBridge?.control(action);
    });
    electron_1.ipcMain.on("light:set-hot-zones", (_evt, zones) => {
        if (!Array.isArray(zones))
            return;
        hotZones = zones.filter((z) => z && typeof z.x === "number" && typeof z.y === "number" &&
            typeof z.w === "number" && typeof z.h === "number");
    });
    electron_1.ipcMain.on("light:add-memo", (_evt, text) => {
        if (typeof text !== "string")
            return;
        memoStore?.add(text);
    });
    electron_1.ipcMain.on("light:toggle-memo", (_evt, id) => {
        if (typeof id !== "string")
            return;
        memoStore?.toggle(id);
    });
    electron_1.ipcMain.on("light:delete-memo", (_evt, id) => {
        if (typeof id !== "string")
            return;
        memoStore?.delete(id);
    });
    electron_1.ipcMain.on("light:clear-events", () => {
        store.clearEvents();
    });
    electron_1.ipcMain.on("light:remove-session", (_evt, key) => {
        if (typeof key === "string")
            store.removeSession(key);
    });
    electron_1.ipcMain.handle("light:get-hooks-status", () => (0, hooks_setup_1.getHooksStatus)());
    electron_1.ipcMain.handle("light:install-hooks", (_evt, agent) => {
        const valid = [
            "claude",
            "codex",
            "opencode",
            "deveco",
            "all",
            "both",
        ];
        const target = valid.includes(agent) ? agent : "all";
        return (0, hooks_setup_1.installHooks)(target);
    });
    // History & stats
    electron_1.ipcMain.handle("light:get-history", (_evt, q) => {
        return historyStore?.query(q ?? {}) ?? [];
    });
    electron_1.ipcMain.handle("light:get-stats", (_evt, opts) => {
        return historyStore?.stats(opts ?? {}) ?? null;
    });
    // Notifications
    electron_1.ipcMain.handle("light:get-notify-config", () => {
        return notifier?.getConfig() ?? { osEnabled: true, webhookEnabled: false, webhookUrl: "", minDurationMs: 8000 };
    });
    electron_1.ipcMain.handle("light:set-notify-config", (_evt, patch) => {
        return notifier?.setConfig(patch) ?? { osEnabled: true, webhookEnabled: false, webhookUrl: "", minDurationMs: 8000 };
    });
    electron_1.ipcMain.handle("light:test-notify", async () => {
        return notifier ? await notifier.test() : { os: false, webhook: false, error: "notifier not ready" };
    });
    // Theme
    electron_1.ipcMain.handle("light:get-theme", () => {
        return { theme: themeStore?.get() ?? "dark", effective: themeStore?.effective() ?? "dark" };
    });
    electron_1.ipcMain.handle("light:set-theme", (_evt, t) => {
        if (t !== "light" && t !== "dark" && t !== "auto")
            return null;
        applyTheme(t);
        return { theme: themeStore?.get() ?? "dark", effective: themeStore?.effective() ?? "dark" };
    });
    electron_1.ipcMain.on("light:quit", () => electron_1.app.quit());
    store.on("state", (state) => {
        mainWindow?.webContents.send("light:state", state);
    });
    store.on("event", (evt) => {
        mainWindow?.webContents.send("light:event", evt);
    });
    // When a session is retired (done/error/idle → dropped), record it into
    // history and fire the completion notification. This is the single choke
    // point where "a task finished" becomes both a persistent record and a
    // potentially cross-scene alert.
    store.on("retire", (session) => {
        if (historyStore) {
            const durationMs = session.startedAt
                ? new Date(session.lastEventAt).getTime() - new Date(session.startedAt).getTime()
                : undefined;
            historyStore.record({
                agent: session.agent,
                sessionId: session.sessionId,
                seq: session.seq,
                prompt: session.lastPrompt,
                startedAt: session.startedAt,
                endedAt: session.lastEventAt,
                durationMs,
                status: session.status === "error" ? "error" : session.status === "done" ? "done" : "idle",
                events: session.recent,
                usage: session.usage,
                error: session.status === "error" ? session.lastPrompt : undefined,
            });
            mainWindow?.webContents.send("light:history-updated");
        }
        // Only notify on done/error — a session that quietly idled out (GC'd
        // after 30 min) isn't worth a popup.
        if (notifier && (session.status === "done" || session.status === "error")) {
            notifier.notify(session);
        }
    });
    systemStore.on("change", (state) => {
        mainWindow?.webContents.send("light:system", state);
    });
}
electron_1.app.whenReady().then(() => {
    const userData = electron_1.app.getPath("userData");
    const memosPath = node_path_1.default.join(userData, "memos.json");
    memoStore = new memos_1.MemoStore(memosPath);
    memoStore.on("change", (list) => {
        mainWindow?.webContents.send("light:memos", list);
    });
    historyStore = new history_1.HistoryStore(node_path_1.default.join(userData, "history.jsonl"));
    notifier = new notifier_1.Notifier(userData);
    themeStore = new theme_1.ThemeStore(userData);
    (0, server_1.startServer)(store, server_1.DEFAULT_PORT);
    createWindow();
    createTray();
    wireIpc();
    // In "auto" mode, follow the OS theme: when the user flips Windows between
    // light/dark, we re-resolve and push the new effective colour to the
    // renderer + tray menu immediately.
    electron_1.nativeTheme.on("updated", () => {
        if (themeStore?.get() === "auto")
            pushThemeToRenderer();
    });
    // Windows bridge: SMTC media + notification listener. Dev: <root>/bridge.
    const bridgeDir = node_path_1.default.join(__dirname, "..", "bridge");
    winBridge = new winbridge_1.WinBridge(systemStore, bridgeDir);
    winBridge.start();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on("before-quit", () => {
    winBridge?.stop();
});
electron_1.app.on("window-all-closed", (e) => {
    e.preventDefault();
});
//# sourceMappingURL=main.js.map