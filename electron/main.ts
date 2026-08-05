import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog, nativeTheme } from "electron";
import path from "node:path";
import fs from "node:fs";
import { StateStore, type LightEvent, type AppState, type SessionState } from "./state";
import { DEFAULT_PORT, startServer } from "./server";
import { MemoStore, type Memo } from "./memos";
import { SystemStore, type SystemState } from "./system";
import { WinBridge, type MediaAction } from "./winbridge";
import { getHooksStatus, installHooks, type InstallTarget } from "./hooks-setup";
import { HistoryStore, type HistoryQuery, type SessionRecord } from "./history";
import { Notifier, type NotifyConfig } from "./notifier";
import { ThemeStore, type Theme, type EffectiveTheme } from "./theme";

interface HotZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

const WINDOW_WIDTH = 640;
const WINDOW_HEIGHT = 520;
const CURSOR_POLL_MS = 60;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let cursorTimer: NodeJS.Timeout | null = null;
let currentlyIgnoring = true;
let hotZones: HotZone[] = [];
let lastHoverSent: boolean | null = null;

const store = new StateStore();
const systemStore = new SystemStore();
let memoStore: MemoStore | null = null;
let winBridge: WinBridge | null = null;
let historyStore: HistoryStore | null = null;
let notifier: Notifier | null = null;
let themeStore: ThemeStore | null = null;

function getDevServerUrl(): string | undefined {
  return process.env.VITE_DEV_SERVER_URL;
}

// The branded icon, resolved for both layouts:
//   packaged → resources/app/icon.ico   (staged by scripts/stage.mjs)
//   dev      → <root>/installer/light.ico
function resolveIcon(): string | undefined {
  const candidates = [
    path.join(__dirname, "..", "icon.ico"),
    path.join(__dirname, "..", "installer", "light.ico"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function createWindow(): void {
  const display = screen.getPrimaryDisplay();
  const { width: screenW } = display.workAreaSize;
  const plat = process.platform;

  mainWindow = new BrowserWindow({
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
    // Linux compositors can be finicky with transparent frameless windows.
    // These hints help them place it as an overlay/popup rather than a normal
    // tiled window. macOS and Windows ignore the `type` hint.
    ...(plat === "linux" ? { type: "notification" as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
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
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
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

function setIgnore(ignore: boolean): void {
  if (!mainWindow) return;
  if (ignore === currentlyIgnoring) return;
  // On Windows, a transparent frameless window with `forward: true` causes
  // DWM to keep a hit-test shell that blocks clicks/slides on the desktop
  // beneath the window — even though the clicks are "forwarded" they never
  // reach the underlying apps.  Dropping `forward: true` lets the OS
  // completely ignore the window when the cursor is outside the hot zones,
  // so clicks pass through cleanly to whatever is underneath.
  if (ignore) {
    mainWindow.setIgnoreMouseEvents(true);
  } else {
    mainWindow.setIgnoreMouseEvents(false);
  }
  currentlyIgnoring = ignore;
}

function startCursorPoll(): void {
  stopCursorPoll();
  cursorTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();
    const localX = cursor.x - bounds.x;
    const localY = cursor.y - bounds.y;
    const overHotZone = hotZones.some(
      (z) => localX >= z.x && localX < z.x + z.w && localY >= z.y && localY < z.y + z.h,
    );
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

function stopCursorPoll(): void {
  if (cursorTimer) clearInterval(cursorTimer);
  cursorTimer = null;
  lastHoverSent = null;
}

function buildTrayIcon(): Electron.NativeImage {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAY0lEQVR42mNgGAWjYBQMfMD0n4Ghj+E/A+M/A+M/Iw" +
      "MTAxMDAyMDIwMjAyMDIwMzAxMjEwMTIxMDEwMzExMTM/+gM4ABAAYGRgYGBkYGRgZGBgZGBgYAAFLgC2sFqFQ0AAAAA" +
      "SUVORK5CYII=",
    "base64",
  );
  return nativeImage.createFromBuffer(png);
}

function createTray(): void {
  const iconPath = resolveIcon();
  const trayImg = iconPath ? nativeImage.createFromPath(iconPath) : buildTrayIcon();
  tray = new Tray(trayImg);
  tray.setToolTip("Light · 桌面状态胶囊");
  const refresh = () => {
    const cur = themeStore?.get() ?? "dark";
    const menu = Menu.buildFromTemplate([
      {
        label: mainWindow?.isVisible() ? "Hide" : "Show",
        click: () => {
          if (!mainWindow) return;
          if (mainWindow.isVisible()) mainWindow.hide();
          else mainWindow.showInactive();
        },
      },
      { type: "separator" },
      {
        label: "一键接入全部 Agent",
        click: () => {
          const result = installHooks("all");
          dialog.showMessageBox({
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
      { label: `HTTP :${DEFAULT_PORT}`, enabled: false },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]);
    tray?.setContextMenu(menu);
  };
  refresh();
  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else mainWindow.showInactive();
    refresh();
  });
}

// Push the current effective theme to the renderer by toggling the `light`
// class on <html>. Called on startup (after the page loads), on every theme
// change, and when the OS theme flips while in "auto" mode.
function pushThemeToRenderer(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const eff: EffectiveTheme = themeStore?.effective() ?? "dark";
  // Add the class that matches, remove the other. We use both classes so the
  // CSS can target either mode explicitly (and survives a missed event).
  const addClass = eff === "light" ? "light" : "dark";
  const removeClass = eff === "light" ? "dark" : "light";
  mainWindow.webContents.executeJavaScript(
    `document.documentElement.classList.remove('${removeClass}');` +
    `document.documentElement.classList.add('${addClass}');`,
  ).catch(() => { /* window may be loading */ });
  mainWindow.webContents.send("light:theme", { theme: themeStore?.get() ?? "dark", effective: eff });
  tray?.setContextMenu(Menu.buildFromTemplate([])); // force tray menu rebuild on next open
  // Rebuild tray menu so the radio reflects the new selection. We can't just
  // call refresh() because it's local to createTray; instead we recreate by
  // re-reading themeStore. Simpler: emit an event the tray rebuilds on.
  rebuildTrayMenu();
}

// Avoid circular ref with createTray: rebuild the menu from a standalone
// helper. This keeps the radio buttons in sync after a theme change.
function rebuildTrayMenu(): void {
  if (!tray) return;
  const cur = themeStore?.get() ?? "dark";
  const menu = Menu.buildFromTemplate([
    {
      label: mainWindow?.isVisible() ? "Hide" : "Show",
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) mainWindow.hide();
        else mainWindow.showInactive();
      },
    },
    { type: "separator" },
    {
      label: "一键接入全部 Agent",
      click: () => {
        const result = installHooks("all");
        dialog.showMessageBox({
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
    { label: `HTTP :${DEFAULT_PORT}`, enabled: false },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function applyTheme(t: Theme): void {
  if (!themeStore) return;
  themeStore.set(t);
  pushThemeToRenderer();
}

function wireIpc(): void {
  ipcMain.handle("light:get-state", (): AppState => store.getState());
  ipcMain.handle("light:get-memos", (): Memo[] => memoStore?.list() ?? []);
  ipcMain.handle("light:get-system", (): SystemState => systemStore.getState());
  ipcMain.on("light:media-control", (_evt, action: MediaAction) => {
    winBridge?.control(action);
  });
  ipcMain.on("light:set-hot-zones", (_evt, zones: HotZone[]) => {
    if (!Array.isArray(zones)) return;
    hotZones = zones.filter(
      (z) =>
        z && typeof z.x === "number" && typeof z.y === "number" &&
        typeof z.w === "number" && typeof z.h === "number",
    );
  });
  ipcMain.on("light:add-memo", (_evt, text: string) => {
    if (typeof text !== "string") return;
    memoStore?.add(text);
  });
  ipcMain.on("light:toggle-memo", (_evt, id: string) => {
    if (typeof id !== "string") return;
    memoStore?.toggle(id);
  });
  ipcMain.on("light:delete-memo", (_evt, id: string) => {
    if (typeof id !== "string") return;
    memoStore?.delete(id);
  });
  ipcMain.on("light:clear-events", () => {
    store.clearEvents();
  });
  ipcMain.on("light:remove-session", (_evt, key: string) => {
    if (typeof key === "string") store.removeSession(key);
  });
  ipcMain.handle("light:get-hooks-status", () => getHooksStatus());
  ipcMain.handle("light:install-hooks", (_evt, agent: InstallTarget) => {
    const valid: InstallTarget[] = [
      "claude",
      "codex",
      "opencode",
      "deveco",
      "all",
      "both",
    ];
    const target: InstallTarget = valid.includes(agent) ? agent : "all";
    return installHooks(target);
  });

  // History & stats
  ipcMain.handle("light:get-history", (_evt, q: HistoryQuery | undefined) => {
    return historyStore?.query(q ?? {}) ?? ([] as SessionRecord[]);
  });
  ipcMain.handle("light:get-stats", (_evt, opts: { since?: string; until?: string } | undefined) => {
    return historyStore?.stats(opts ?? {}) ?? null;
  });

  // Notifications
  ipcMain.handle("light:get-notify-config", (): NotifyConfig => {
    return notifier?.getConfig() ?? { osEnabled: true, webhookEnabled: false, webhookUrl: "", minDurationMs: 8000 };
  });
  ipcMain.handle("light:set-notify-config", (_evt, patch: Partial<NotifyConfig>): NotifyConfig => {
    return notifier?.setConfig(patch) ?? { osEnabled: true, webhookEnabled: false, webhookUrl: "", minDurationMs: 8000 };
  });
  ipcMain.handle("light:test-notify", async () => {
    return notifier ? await notifier.test() : { os: false, webhook: false, error: "notifier not ready" };
  });

  // Theme
  ipcMain.handle("light:get-theme", (): { theme: Theme; effective: EffectiveTheme } => {
    return { theme: themeStore?.get() ?? "dark", effective: themeStore?.effective() ?? "dark" };
  });
  ipcMain.handle("light:set-theme", (_evt, t: Theme) => {
    if (t !== "light" && t !== "dark" && t !== "auto") return null;
    applyTheme(t);
    return { theme: themeStore?.get() ?? "dark", effective: themeStore?.effective() ?? "dark" };
  });

  ipcMain.on("light:quit", () => app.quit());

  store.on("state", (state: AppState) => {
    mainWindow?.webContents.send("light:state", state);
  });
  store.on("event", (evt: LightEvent) => {
    mainWindow?.webContents.send("light:event", evt);
  });

  // When a session is retired (done/error/idle → dropped), record it into
  // history and fire the completion notification. This is the single choke
  // point where "a task finished" becomes both a persistent record and a
  // potentially cross-scene alert.
  store.on("retire", (session: SessionState) => {
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

  systemStore.on("change", (state: SystemState) => {
    mainWindow?.webContents.send("light:system", state);
  });
}

app.whenReady().then(() => {
  const userData = app.getPath("userData");
  const memosPath = path.join(userData, "memos.json");
  memoStore = new MemoStore(memosPath);
  memoStore.on("change", (list: Memo[]) => {
    mainWindow?.webContents.send("light:memos", list);
  });

  historyStore = new HistoryStore(path.join(userData, "history.jsonl"));
  notifier = new Notifier(userData);
  themeStore = new ThemeStore(userData);

  // Give the live pill an estimated duration for a running WSL command, from
  // this command's historical average in past sessions. No history → the pill
  // shows "running" without a percentage.
  store.setWslEstimator((cmd) => historyStore?.wslAvgDuration(cmd));

  startServer(store, DEFAULT_PORT);
  createWindow();
  createTray();
  wireIpc();

  // In "auto" mode, follow the OS theme: when the user flips Windows between
  // light/dark, we re-resolve and push the new effective colour to the
  // renderer + tray menu immediately.
  nativeTheme.on("updated", () => {
    if (themeStore?.get() === "auto") pushThemeToRenderer();
  });

  // Windows bridge: SMTC media + notification listener. Dev: <root>/bridge.
  const bridgeDir = path.join(__dirname, "..", "bridge");
  winBridge = new WinBridge(systemStore, bridgeDir);
  winBridge.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  winBridge?.stop();
});

app.on("window-all-closed", (e: Electron.Event) => {
  e.preventDefault();
});
