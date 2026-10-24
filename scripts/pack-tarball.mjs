// Pack the staged Linux app folder into a tarball (portable, no install).
// Also generates an AppImage wrapper script as a convenience.
//
// Run after `npm run stage` (which produces release/AgentHUD/).

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "release", "AgentHUD");

function getVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return pkg.version;
}

if (!fs.existsSync(appDir)) {
  console.error(`[pack-tarball] ${appDir} not found — run \`npm run stage\` first.`);
  process.exit(1);
}

const version = getVersion();
const tarball = path.join(root, "release", `AgentHUD-${version}-linux-x64.tar.gz`);

console.log(`[pack-tarball] creating ${path.basename(tarball)} …`);
if (fs.existsSync(tarball)) fs.rmSync(tarball);

// Create a launcher script inside the app dir so users can run it easily.
const launcher = `#!/bin/bash
# AgentHUD launcher — runs the Electron app from this folder.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/agenthud" "$@"
`;
fs.writeFileSync(path.join(appDir, "run.sh"), launcher, "utf8");
fs.chmodSync(path.join(appDir, "run.sh"), 0o755);
fs.chmodSync(path.join(appDir, "agenthud"), 0o755);

// Register in the desktop app menu (per-user, no root). Path is resolved at
// install time because the tarball can be extracted anywhere.
const desktopInstaller = `#!/bin/bash
# Add AgentHUD to the application menu (per-user). No root needed.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APPS="$HOME/.local/share/applications"
mkdir -p "$APPS"
cat > "$APPS/agenthud.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=AgentHUD
Comment=Desktop status capsule for AI coding agents
Exec=$DIR/run.sh
Icon=$DIR/light.png
Terminal=false
Categories=Utility;
StartupWMClass=AgentHUD
EOF
update-desktop-database "$APPS" 2>/dev/null || true
echo "Installed: $APPS/agenthud.desktop"
`;
fs.writeFileSync(path.join(appDir, "install-desktop.sh"), desktopInstaller, "utf8");
fs.chmodSync(path.join(appDir, "install-desktop.sh"), 0o755);

execSync(`tar czf "${tarball}" -C "${path.join(root, "release")}" AgentHUD`, {
  stdio: "inherit",
});

const sizeMB = (fs.statSync(tarball).size / 1024 / 1024).toFixed(1);
console.log(`[pack-tarball] done → ${path.relative(root, tarball)} (${sizeMB} MB)`);
console.log(`[pack-tarball] extract & run: tar xzf ${path.basename(tarball)} && ./AgentHUD/run.sh`);
