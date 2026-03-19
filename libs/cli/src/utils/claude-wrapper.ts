/**
 * Claude Bootstrap Wrapper Installer
 *
 * Installs a launcher script at /usr/local/bin/claude and ~/.agenshield/bin/claude
 * that gates Claude Code through the AgenShield daemon launch-gate API.
 *
 * The wrapper:
 * - Contacts the daemon to check device claim + shielding status
 * - Blocks execution until claim and shielding are complete
 * - Execs the shielded Claude entrypoint when ready
 * - NEVER falls back to the unshielded host Claude binary
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { AGENSHIELD_HOME } from './home.js';

const WRAPPER_SCRIPT = `#!/bin/sh
# AgenShield Claude Code Launcher
# Installed by: agenshield install
# This wrapper gates Claude Code through AgenShield's launch-gate API.
# It NEVER falls back to the unshielded host binary.
#
# AGENSHIELD_ROUTER marker — do not remove

DAEMON_PORT="\${AGENSHIELD_PORT:-5200}"
DAEMON_HOST="\${AGENSHIELD_HOST:-127.0.0.1}"
GATE_URL="http://\${DAEMON_HOST}:\${DAEMON_PORT}/api/launch-gate/claude"

check_daemon() {
  curl -sf "http://\${DAEMON_HOST}:\${DAEMON_PORT}/api/health" >/dev/null 2>&1
}

query_gate() {
  curl -sf "\${GATE_URL}" 2>/dev/null
}

parse_field() {
  echo "$1" | grep -o "\\"$2\\":\\"[^\\"]*\\"" | head -1 | cut -d'"' -f4
}

# Wait for daemon
attempts=0
while ! check_daemon; do
  attempts=$((attempts + 1))
  if [ $attempts -gt 30 ]; then
    echo "AgenShield daemon is not running. Start it with: agenshield start" >&2
    exit 1
  fi
  sleep 1
done

# Main gate loop — polls until ready or exits with actionable message
SHIELD_WAIT=0
while true; do
  RESPONSE=$(query_gate)
  if [ -z "$RESPONSE" ]; then
    echo "Failed to contact AgenShield daemon." >&2
    exit 1
  fi

  STATUS=$(parse_field "$RESPONSE" "status")

  case "$STATUS" in
    ready)
      BINARY=$(parse_field "$RESPONSE" "binary")
      if [ -n "$BINARY" ] && [ -x "$BINARY" ]; then
        exec "$BINARY" "$@"
      fi
      echo "Shielded Claude binary not found." >&2
      exit 1
      ;;
    claim_required)
      echo "" >&2
      echo "Login required. Please login using the AgenShield menu bar app, then try again." >&2
      exit 1
      ;;
    claim_pending)
      echo "" >&2
      echo "Login is pending. Please complete login using the AgenShield menu bar app, then try again." >&2
      exit 1
      ;;
    shield_in_progress)
      SHIELD_WAIT=$((SHIELD_WAIT + 1))
      if [ "$SHIELD_WAIT" -gt 300 ]; then
        echo "" >&2
        echo "Shielding timed out after 10 minutes." >&2
        exit 1
      fi
      PROGRESS=$(echo "$RESPONSE" | grep -o '"progress":[0-9]*' | head -1 | cut -d':' -f2)
      printf "\\rShielding Claude Code... \${PROGRESS:-0}%%" >&2
      sleep 2
      ;;
    not_shielded)
      echo "" >&2
      echo "Claude Code is not yet shielded. Please shield it using the AgenShield menu bar app, then try again." >&2
      exit 1
      ;;
    not_enrolled)
      echo "Device not registered. Run: agenshield install --cloud-url <url> --token <token>" >&2
      exit 1
      ;;
    failed)
      MESSAGE=$(parse_field "$RESPONSE" "message")
      echo "AgenShield error: \${MESSAGE:-unknown error}" >&2
      exit 1
      ;;
    *)
      echo "Unexpected status: \${STATUS}" >&2
      exit 1
      ;;
  esac
done
`;

/**
 * Install the Claude bootstrap wrapper.
 * Places the wrapper at both /usr/local/bin/claude and ~/.agenshield/bin/claude.
 */
export function installClaudeWrapper(opts?: { skipSystemPath?: boolean }): { installed: string[] } {
  const installed: string[] = [];
  const wrapperPaths = [
    path.join(AGENSHIELD_HOME, 'bin', 'claude'),
    ...(opts?.skipSystemPath ? [] : ['/usr/local/bin/claude']),
  ];

  for (const wrapperPath of wrapperPaths) {
    try {
      const dir = path.dirname(wrapperPath);

      // Check if existing file is already our wrapper (has AGENSHIELD_ROUTER marker)
      if (fs.existsSync(wrapperPath)) {
        try {
          const existing = fs.readFileSync(wrapperPath, 'utf-8');
          if (!existing.includes('AGENSHIELD_ROUTER')) {
            // Not our wrapper — back up the original
            const backupPath = wrapperPath + '.agenshield-backup';
            if (!fs.existsSync(backupPath)) {
              fs.copyFileSync(wrapperPath, backupPath);
            }
          }
        } catch {
          // Can't read — might be a binary, skip backup
        }
      }

      // Write wrapper — use sudo for /usr/local/bin
      if (wrapperPath.startsWith('/usr/local/')) {
        const tmpPath = `/tmp/agenshield-claude-wrapper-${Date.now()}.sh`;
        fs.writeFileSync(tmpPath, WRAPPER_SCRIPT, { mode: 0o755 });
        try {
          execSync(`sudo cp "${tmpPath}" "${wrapperPath}"`, { stdio: 'pipe' });
          execSync(`sudo chmod 755 "${wrapperPath}"`, { stdio: 'pipe' });
          installed.push(wrapperPath);
        } catch {
          // sudo might fail — non-fatal
        }
        fs.unlinkSync(tmpPath);
      } else {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(wrapperPath, WRAPPER_SCRIPT, { mode: 0o755 });
        installed.push(wrapperPath);
      }
    } catch {
      // Non-fatal — continue with next path
    }
  }

  return { installed };
}

/**
 * Check if the Claude wrapper is already installed.
 */
export function isClaudeWrapperInstalled(): boolean {
  const wrapperPath = path.join(AGENSHIELD_HOME, 'bin', 'claude');
  try {
    const content = fs.readFileSync(wrapperPath, 'utf-8');
    return content.includes('AGENSHIELD_ROUTER');
  } catch {
    return false;
  }
}
