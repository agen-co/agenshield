/**
 * Write Gateway Plist Step
 *
 * Generates the crash-guarded launcher script and writes the gateway
 * LaunchDaemon plist. The plist is NOT loaded — target-lifecycle handles
 * gateway startup after the broker socket is confirmed.
 */

import type { InstallStep } from '../types.js';
import { checkedExecAsRoot } from '../shared/install-helpers.js';

export const writeGatewayPlistStep: InstallStep = {
  id: 'write_gateway_plist',
  name: 'Write gateway plist',
  description: 'Write gateway launcher and LaunchDaemon plist (deferred start)',
  phase: 12,
  progressMessage: 'Writing OpenClaw gateway LaunchDaemon...',
  runsAs: 'root',
  timeout: 30_000,
  weight: 10,

  async run(ctx) {
    const socketPath = `${ctx.agentHome}/.agenshield/run/agenshield.sock`;
    const launcherPath = `${ctx.agentHome}/.agenshield/bin/gw-launcher.sh`;

    // Generate crash-guarded launcher script
    const launcherContent = `#!/bin/bash
# OpenClaw Gateway Launcher — crash-guarded wrapper
# Tracks crashes, waits for broker socket, runs pre-flight checks.
# Exit 78 (EX_CONFIG) tells launchd that restarting won't help.

set -euo pipefail

CRASH_FILE="/tmp/agenshield-gw-crashes"
MAX_CRASHES=5
CRASH_WINDOW=300
SOCKET_PATH="\${AGENSHIELD_SOCKET:-${socketPath}}"
NVM_SH="${ctx.agentHome}/.nvm/nvm.sh"

# ── Crash tracking ────────────────────────────────────────────
now=$(date +%s)
touch "$CRASH_FILE"
# Append current timestamp
echo "$now" >> "$CRASH_FILE"
# Keep only timestamps within the window
cutoff=$(( now - CRASH_WINDOW ))
awk -v c="$cutoff" '$1 >= c' "$CRASH_FILE" > "$CRASH_FILE.tmp" && mv "$CRASH_FILE.tmp" "$CRASH_FILE"
crash_count=$(wc -l < "$CRASH_FILE" | tr -d ' ')
if [ "$crash_count" -ge "$MAX_CRASHES" ]; then
  echo "FATAL: $crash_count crashes in \${CRASH_WINDOW}s — halting restart loop" >&2
  launchctl disable system/com.agenshield.${ctx.profileBaseName}.gateway 2>/dev/null || true
  exit 78
fi

# ── Pre-flight checks ────────────────────────────────────────
# Source NVM
if [ ! -s "$NVM_SH" ]; then
  echo "FATAL: nvm.sh not found at $NVM_SH" >&2
  exit 78
fi
source "$NVM_SH"

if ! command -v node >/dev/null 2>&1; then
  echo "FATAL: node not found in PATH after sourcing NVM" >&2
  exit 78
fi

if ! command -v openclaw >/dev/null 2>&1; then
  echo "FATAL: openclaw not found in PATH" >&2
  exit 78
fi

# ── Wait for broker socket ────────────────────────────────────
SOCKET_WAIT=90
elapsed=0
while [ ! -S "$SOCKET_PATH" ] && [ "$elapsed" -lt "$SOCKET_WAIT" ]; do
  sleep 0.5
  elapsed=$(( elapsed + 1 ))
done

if [ ! -S "$SOCKET_PATH" ]; then
  echo "FATAL: broker socket not found at $SOCKET_PATH after \${SOCKET_WAIT}s" >&2
  exit 78
fi

# ── All checks passed — clear crash log and start gateway ─────
rm -f "$CRASH_FILE"
exec openclaw gateway start
`;

    // Install the launcher script
    await checkedExecAsRoot(ctx,
      `mkdir -p "${ctx.agentHome}/.agenshield/bin"\ncat > "${launcherPath}" << 'LAUNCHER_EOF'\n${launcherContent}\nLAUNCHER_EOF\nchown root:wheel "${launcherPath}" && chmod 755 "${launcherPath}"`,
      'gateway_launcher', 15_000);

    // Write the gateway plist with resource limits
    const gatewayPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.agenshield.${ctx.profileBaseName}.gateway</string>
  <key>UserName</key>
  <string>${ctx.agentUsername}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${launcherPath}</string>
  </array>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ExitTimeOut</key>
  <integer>20</integer>
  <key>HardResourceLimits</key>
  <dict>
    <key>NumberOfProcesses</key>
    <integer>256</integer>
    <key>NumberOfFiles</key>
    <integer>4096</integer>
  </dict>
  <key>SoftResourceLimits</key>
  <dict>
    <key>NumberOfFiles</key>
    <integer>4096</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${ctx.agentHome}/.agenshield/logs/gateway.log</string>
  <key>StandardErrorPath</key>
  <string>${ctx.agentHome}/.agenshield/logs/gateway.error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${ctx.agentHome}</string>
    <key>NVM_DIR</key>
    <string>${ctx.agentHome}/.nvm</string>
    <key>HOMEBREW_PREFIX</key>
    <string>${ctx.agentHome}/homebrew</string>
    <key>HOMEBREW_CELLAR</key>
    <string>${ctx.agentHome}/homebrew/Cellar</string>
    <key>HOMEBREW_NO_AUTO_UPDATE</key>
    <string>1</string>
    <key>HOMEBREW_NO_INSTALL_FROM_API</key>
    <string>1</string>
    <key>AGENSHIELD_SOCKET</key>
    <string>${socketPath}</string>
  </dict>
</dict>
</plist>`;

    const gatewayPlistPath = `/Library/LaunchDaemons/com.agenshield.${ctx.profileBaseName}.gateway.plist`;
    await checkedExecAsRoot(ctx,
      `cat > "${gatewayPlistPath}" << 'GATEWAYPLIST_EOF'\n${gatewayPlist}\nGATEWAYPLIST_EOF\nchmod 644 "${gatewayPlistPath}"`,
      'gateway_plist_write', 15_000);

    // Also write a gateway config JSON for the ProcessManager (direct spawn fallback).
    // The daemon's ProcessManager reads this to know the command and env for spawning.
    const gatewayConfigDir = `${ctx.agentHome}/.agenshield/config`;
    const gatewayConfig = JSON.stringify({
      command: 'openclaw gateway run',
      port: 18789,
      env: {
        HOME: ctx.agentHome,
        NVM_DIR: `${ctx.agentHome}/.nvm`,
        HOMEBREW_PREFIX: `${ctx.agentHome}/homebrew`,
        HOMEBREW_CELLAR: `${ctx.agentHome}/homebrew/Cellar`,
        HOMEBREW_NO_AUTO_UPDATE: '1',
        HOMEBREW_NO_INSTALL_FROM_API: '1',
        AGENSHIELD_SOCKET: socketPath,
      },
    }, null, 2);

    await checkedExecAsRoot(ctx,
      `mkdir -p "${gatewayConfigDir}"\ncat > "${gatewayConfigDir}/gateway.json" << 'GWCONFIG_EOF'\n${gatewayConfig}\nGWCONFIG_EOF\nchmod 644 "${gatewayConfigDir}/gateway.json"`,
      'gateway_config_write', 15_000);

    return {
      changed: true,
      outputs: { gatewayPlistPath, gatewayConfigPath: `${gatewayConfigDir}/gateway.json` },
    };
  },
};
