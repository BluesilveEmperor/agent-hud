// Cross-platform stage script: assemble a self-contained, runnable app folder.
//
// Works on Windows / macOS / Linux. Detects the host platform and lays out
// the Electron app accordingly:
//   - Windows: release/AgentHUD/AgentHUD.exe + *.dll + resources/
//   - macOS:   release/AgentHUD.app/Contents/MacOS/AgentHUD + ...
//   - Linux:   release/AgentHUD/agenthud + *.so + resources/
//
// The app payload (dist/ + dist-electron/ + hooks/ + bridge/) is identical
// across platforms — only the Electron runtime wrapper differs.
//
// Run AFTER `npm run build`.  npm run dist == build + stage.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platform = process.platform; // win32 | darwin | linux

const APP_NAME = "AgentHUD";
const EXEC_NAME = platform === "win32" ? "AgentHUD.exe" : "agenthud";

// Output dir differs per platform: macOS gets a .app bundle, others get a flat dir.
const outDir = platform === "darwin"
  ? path.join(root, "release", `${APP_NAME}.app`)
  : path.join(root, "release", APP_NAME);
let appDir = platform === "darwin"
  ? path.join(outDir, "Contents", "Resources", "app")
  : path.join(outDir, "resources", "app");

const log = (m) => process.stdout.write(`[stage] ${m}\n`);
const die = (m) => {
  process.stderr.write(`[stage] ERROR: ${m}\n`);
  process.exit(1);
};

function rmrf(p) {
  // Windows AV / indexer / security daemons sometimes hold a freshly-copied
  // file open WITHOUT delete-share (EBUSY on unlink) while still allowing
  // read/write. Deleting everything else still works in that case, so retry
  // briefly and then fall back to a best-effort empty: the straggler stays
  // in place and gets content-overwritten by cpSync later anyway.
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
      return;
    } catch (e) {
      if (e.code !== "EBUSY" && e.code !== "EPERM") throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
    }
  }
  try {
    fs.rmSync(p, { recursive: true, force: true });
    return;
  } catch {
    log(`WARN: ${path.relative(root, p)} 被占用无法删除，保留原文件并继续（内容会被覆盖）`);
  }
}
function copyDir(src, dest) { fs.cpSync(src, dest, { recursive: true }); }

// ---- resolve electron binary location per platform ------------------------
const electronDist = path.join(root, "node_modules", "electron", "dist");
function electronBinaryName() {
  if (platform === "win32") return "electron.exe";
  if (platform === "darwin") return "Electron"; // inside Electron.app/Contents/MacOS/
  return "electron";
}
// On macOS the binary lives inside Electron.app/Contents/MacOS/Electron,
// not at dist/Electron directly.
const electronBin = platform === "darwin"
  ? path.join(electronDist, "Electron.app", "Contents", "MacOS", "Electron")
  : path.join(electronDist, electronBinaryName());

// ---- resolve icon ---------------------------------------------------------
// Windows ships the multi-size .ico; macOS/Linux need a bitmap (nativeImage
// cannot reliably decode .ico off Windows, and macOS wants an .icns bundle
// icon). We ship both and pick per platform at runtime.
const iconSrc = path.join(root, "installer", "light.ico");
const iconPng = path.join(root, "installer", "light.png");

// Build Contents/Resources/icon.icns from the 1024² PNG using macOS's own
// sips + iconutil (no extra dependencies). Silent no-op elsewhere.
function makeIcns(pngSrc, resourcesDir) {
  if (platform !== "darwin" || !fs.existsSync(pngSrc)) return false;
  const iconset = path.join(resourcesDir, "icon.iconset");
  const specs = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];
  try {
    rmrf(iconset);
    fs.mkdirSync(iconset, { recursive: true });
    for (const [size, name] of specs) {
      execFileSync("sips", ["-z", String(size), String(size), pngSrc, "--out", path.join(iconset, name)], {
        stdio: "ignore",
      });
    }
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(resourcesDir, "icon.icns")], {
      stdio: "ignore",
    });
    rmrf(iconset);
    return true;
  } catch (e) {
    log(`WARN: .icns 生成失败（${e.message}），回退为 PNG 图标`);
    try {
      rmrf(iconset);
    } catch {}
    return false;
  }
}

// ---- preconditions --------------------------------------------------------
const distRenderer = path.join(root, "dist");
const distElectron = path.join(root, "dist-electron");

if (!fs.existsSync(path.join(distRenderer, "index.html")))
  die("dist/index.html missing — run `npm run build` first.");
if (!fs.existsSync(path.join(distElectron, "main.js")))
  die("dist-electron/main.js missing — run `npm run build` first.");
if (!fs.existsSync(electronBin))
  die(`Electron binary not found at ${electronBin} — run \`npm install\`.`);

// ---- clean ----------------------------------------------------------------
log(`cleaning ${path.relative(root, outDir)} …`);
rmrf(outDir);
fs.mkdirSync(appDir, { recursive: true });

// ---- electron runtime -----------------------------------------------------
log("copying Electron runtime …");
if (platform === "darwin") {
  // On macOS, node_modules/electron/dist/ contains Electron.app (a bundle).
  // We copy its Contents/ directly into our output .app skeleton so the
  // resulting structure is a valid .app:
  //
  //   release/AgentHUD.app/
  //     Contents/
  //       Info.plist
  //       MacOS/AgentHUD   (renamed Electron)
  //       Resources/app/   (our payload)
  //       ...
  const appBundle = path.join(electronDist, "Electron.app", "Contents");
  const bundleContents = path.join(outDir, "Contents");
  copyDir(appBundle, bundleContents);
  // Rename the inner executable.
  const macOSDir = path.join(bundleContents, "MacOS");
  const oldBin = path.join(macOSDir, "Electron");
  const newBin = path.join(macOSDir, EXEC_NAME);
  if (fs.existsSync(oldBin)) fs.renameSync(oldBin, newBin);
  // Drop the bundled demo app.
  rmrf(path.join(bundleContents, "Resources", "default_app.asar"));
  // Fix Info.plist so the dock/menubar shows "AgentHUD".
  // Also point CFBundleIconFile at the .icns we generate from light.png —
  // without it macOS falls back to the generic Electron icon.
  const resourcesDir = path.join(bundleContents, "Resources");
  const icnsOk = makeIcns(iconPng, resourcesDir);
  const plistPath = path.join(bundleContents, "Info.plist");
  if (fs.existsSync(plistPath)) {
    let plist = fs.readFileSync(plistPath, "utf8");
    // CFBundleExecutable MUST match the renamed binary in Contents/MacOS,
    // otherwise macOS refuses to launch the bundle ("app is damaged").
    plist = plist.replace(/<key>CFBundleExecutable<\/key>\s*<string>[^<]*<\/string>/,
      `<key>CFBundleExecutable</key><string>${EXEC_NAME}</string>`);
    plist = plist.replace(/<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/,
      `<key>CFBundleName</key><string>${APP_NAME}</string>`);
    plist = plist.replace(/<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,
      `<key>CFBundleDisplayName</key><string>${APP_NAME}</string>`);
    // Don't ship Electron's bundle id — it breaks LaunchServices registration
    // when two Electron-based apps are installed.
    plist = plist.replace(/<key>CFBundleIdentifier<\/key>\s*<string>[^<]*<\/string>/,
      `<key>CFBundleIdentifier</key><string>com.agenthud.app</string>`);
    if (icnsOk) {
      if (/<key>CFBundleIconFile<\/key>/.test(plist)) {
        plist = plist.replace(
          /<key>CFBundleIconFile<\/key>\s*<string>[^<]*<\/string>/,
          `<key>CFBundleIconFile</key><string>icon.icns</string>`,
        );
      } else {
        plist = plist.replace("<dict>", `<dict>\n\t<key>CFBundleIconFile</key>\n\t<string>icon.icns</string>`);
      }
    }
    fs.writeFileSync(plistPath, plist, "utf8");
  }
  // Update appDir: on macOS the payload goes into Contents/Resources/app/
  appDir = path.join(bundleContents, "Resources", "app");
} else {
  // Windows / Linux: flat directory layout.
  copyDir(electronDist, outDir);
  const oldBin = path.join(outDir, electronBinaryName());
  const newBin = path.join(outDir, EXEC_NAME);
  if (fs.existsSync(oldBin)) fs.renameSync(oldBin, newBin);
  rmrf(path.join(outDir, "resources", "default_app.asar"));
}

// ---- trim bloat -----------------------------------------------------------
// Remove files that are unnecessary for a lightweight desktop HUD to save
// ~47 MB off the unzipped size.  The Electron exe itself (≈169 MB) is the
// irreducible cost of shipping Chromium; everything else is trimmable.
log("trimming unnecessary files …");
if (platform === "win32") {
  // 1. Locales: keep only en-US and zh-CN (the app targets Chinese users and
  //    English fallback).  55 locales × ~0.7 MB avg = ~37 MB saved.
  const localesDir = path.join(outDir, "locales");
  if (fs.existsSync(localesDir)) {
    const keep = new Set(["en-US.pak", "en-US", "zh-CN.pak", "zh-CN"]);
    for (const entry of fs.readdirSync(localesDir, { withFileTypes: true })) {
      if (!keep.has(entry.name) && !keep.has(entry.name.replace(".pak", ""))) {
        const fp = path.join(localesDir, entry.name);
        entry.isDirectory() ? rmrf(fp) : fs.unlinkSync(fp);
      }
    }
  }
  // 2. Chromium LICENSES file (~10 MB) — not needed at runtime.
  const licenses = path.join(outDir, "LICENSES.chromium.html");
  if (fs.existsSync(licenses)) fs.unlinkSync(licenses);
  // 3. Vulkan software rasteriser — only needed on machines without a GPU
  //    compositor.  Safe to drop for a backdrop-blur overlay app (~5 MB).
  const vkSw = path.join(outDir, "vk_swiftshader.dll");
  if (fs.existsSync(vkSw)) fs.unlinkSync(vkSw);
  const vkDir = path.join(outDir, "vk_swiftshader");
  if (fs.existsSync(vkDir)) rmrf(vkDir);
} else if (platform === "darwin") {
  const localesDir = path.join(outDir, "Contents", "Resources", "locales");
  if (fs.existsSync(localesDir)) {
    const keep = new Set(["en-US.pak", "en-US", "zh-CN.pak", "zh-CN"]);
    for (const entry of fs.readdirSync(localesDir, { withFileTypes: true })) {
      if (!keep.has(entry.name) && !keep.has(entry.name.replace(".pak", ""))) {
        const fp = path.join(localesDir, entry.name);
        entry.isDirectory() ? rmrf(fp) : fs.unlinkSync(fp);
      }
    }
  }
} else if (platform === "linux") {
  const localesDir = path.join(outDir, "locales");
  if (fs.existsSync(localesDir)) {
    const keep = new Set(["en-US.pak", "en-US", "zh-CN.pak", "zh-CN"]);
    for (const entry of fs.readdirSync(localesDir, { withFileTypes: true })) {
      if (!keep.has(entry.name) && !keep.has(entry.name.replace(".pak", ""))) {
        const fp = path.join(localesDir, entry.name);
        entry.isDirectory() ? rmrf(fp) : fs.unlinkSync(fp);
      }
    }
  }
}

// ---- app payload ----------------------------------------------------------
log("copying app payload …");
copyDir(distRenderer, path.join(appDir, "dist"));
copyDir(distElectron, path.join(appDir, "dist-electron"));
// bridge/ contains Windows-only PowerShell scripts; copy it anyway (harmless
// on other platforms, and the code guards on process.platform before running).
if (fs.existsSync(path.join(root, "bridge"))) {
  copyDir(path.join(root, "bridge"), path.join(appDir, "bridge"));
}
if (fs.existsSync(iconSrc)) {
  fs.copyFileSync(iconSrc, path.join(appDir, "icon.ico"));
}
if (fs.existsSync(iconPng)) {
  fs.copyFileSync(iconPng, path.join(appDir, "icon.png"));
}

// Trimmed production package.json.
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const appPkg = {
  name: pkg.name,
  productName: APP_NAME,
  version: pkg.version,
  description: pkg.description,
  main: "dist-electron/main.js",
  author: pkg.author || APP_NAME,
  license: pkg.license || "MIT",
};
fs.writeFileSync(path.join(appDir, "package.json"), JSON.stringify(appPkg, null, 2), "utf8");

// ---- integration scripts + icon at install root ---------------------------
log("copying hooks + icon …");
const hooksOut = platform === "darwin"
  ? path.join(outDir, "Contents", "Resources", "hooks")
  : path.join(outDir, "hooks");
copyDir(path.join(root, "hooks"), hooksOut);
if (fs.existsSync(iconSrc)) {
  const iconOut = platform === "darwin"
    ? path.join(outDir, "Contents", "Resources", "light.ico")
    : path.join(outDir, "light.ico");
  fs.copyFileSync(iconSrc, iconOut);
}
// macOS/Linux resolve the window + tray icon from this PNG.
if (fs.existsSync(iconPng)) {
  const pngOut = platform === "darwin"
    ? path.join(outDir, "Contents", "Resources", "light.png")
    : path.join(outDir, "light.png");
  fs.copyFileSync(iconPng, pngOut);
}

// ---- Linux: make executable + create .desktop entry -----------------------
if (platform === "linux") {
  try { fs.chmodSync(path.join(outDir, EXEC_NAME), 0o755); } catch {}
  const desktop = `[Desktop Entry]
Type=Application
Name=AgentHUD
Comment=桌面状态胶囊
Exec=${path.join(outDir, EXEC_NAME)}
Icon=${path.join(outDir, "light.ico")}
Terminal=false
Categories=Utility;`;
  fs.writeFileSync(path.join(outDir, "agenthud.desktop"), desktop, "utf8");
}

// ---- done -----------------------------------------------------------------
function dirSize(p) {
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const fp = path.join(p, e.name);
    total += e.isDirectory() ? dirSize(fp) : fs.statSync(fp).size;
  }
  return total;
}
const mb = (dirSize(outDir) / 1024 / 1024).toFixed(1);
log(`done → ${path.relative(root, outDir)}  (${mb} MB)`);
if (platform === "win32") {
  log("next: iscc installer/light.iss  (Inno Setup)");
} else if (platform === "darwin") {
  log("next: hdiutil create -volname AgentHUD -srcfolder release/AgentHUD.app -ov -format UDZO release/AgentHUD.dmg");
} else {
  log("next: tar czf release/AgentHUD-linux.tar.gz -C release AgentHUD  (or use AppImage)");
}
