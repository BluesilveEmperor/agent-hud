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

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(src, dest) { fs.cpSync(src, dest, { recursive: true }); }

// ---- resolve electron binary location per platform ------------------------
const electronDist = path.join(root, "node_modules", "electron", "dist");
function electronBinaryName() {
  if (platform === "win32") return "electron.exe";
  if (platform === "darwin") return "Electron"; // inside Electron.app/Contents/MacOS/
  return "electron";
}
const electronBin = path.join(electronDist, electronBinaryName());

// ---- resolve icon ---------------------------------------------------------
// .ico on Windows, .png/.icns on Mac, .png on Linux. We ship .ico; on Mac/Linux
// we fall back to it (Electron accepts .ico cross-platform for the tray; the
// window icon is less critical on Mac where the dock uses the .app icon).
const iconSrc = path.join(root, "installer", "light.ico");

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
  const plistPath = path.join(bundleContents, "Info.plist");
  if (fs.existsSync(plistPath)) {
    let plist = fs.readFileSync(plistPath, "utf8");
    plist = plist.replace(/<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/,
      `<key>CFBundleName</key><string>${APP_NAME}</string>`);
    plist = plist.replace(/<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,
      `<key>CFBundleDisplayName</key><string>${APP_NAME}</string>`);
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
