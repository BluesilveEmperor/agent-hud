// Pack the staged .app into a .dmg on macOS.
// Uses hdiutil (built into macOS, no extra deps).
//
// Run after `npm run stage` (which produces release/AgentHUD.app).

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appPath = path.join(root, "release", "AgentHUD.app");
const dmgPath = path.join(root, "release", `AgentHUD-${getVersion()}.dmg`);

function getVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return pkg.version;
}

if (!fs.existsSync(appPath)) {
  console.error(`[pack-dmg] ${appPath} not found — run \`npm run stage\` first.`);
  process.exit(1);
}

console.log(`[pack-dmg] creating ${path.basename(dmgPath)} …`);

// Remove old dmg
if (fs.existsSync(dmgPath)) fs.rmSync(dmgPath);

// hdiutil create -volname "AgentHUD" -srcfolder <app> -ov -format UDZO <dmg>
execSync(
  `hdiutil create -volname "AgentHUD" -srcfolder "${appPath}" -ov -format UDZO "${dmgPath}"`,
  { stdio: "inherit" },
);

const sizeMB = (fs.statSync(dmgPath).size / 1024 / 1024).toFixed(1);
console.log(`[pack-dmg] done → ${path.relative(root, dmgPath)} (${sizeMB} MB)`);
