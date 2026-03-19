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
CLAIM_URL_BASE="http://\${DAEMON_HOST}:\${DAEMON_PORT}/api/launch-gate/claude/claim"
SHIELD_URL="http://\${DAEMON_HOST}:\${DAEMON_PORT}/api/launch-gate/claude/shield"

check_daemon() {
  curl -sf "http://\${DAEMON_HOST}:\${DAEMON_PORT}/api/health" >/dev/null 2>&1
}

query_gate() {
  curl -sf "\${GATE_URL}" 2>/dev/null
}

start_claim() {
  curl -sf -X POST "\${CLAIM_URL_BASE}" 2>/dev/null
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

# Main gate loop — handles claim + shielding by polling until ready
BROWSER_OPENED=""
SHIELD_WAIT=0
SHIELD_REQUESTED=""
SHIELD_ATTEMPTS=0
WAS_CLAIMING=""
while true; do
  RESPONSE=$(query_gate)
  if [ -z "$RESPONSE" ]; then
    echo "Failed to contact AgenShield daemon." >&2
    exit 1
  fi

  STATUS=$(parse_field "$RESPONSE" "status")

  # Detect claim-to-shield transition: if we were claiming and now status
  # is neither claim_required nor claim_pending, auto-request shielding once.
  if [ -n "$WAS_CLAIMING" ] && [ "$STATUS" != "claim_required" ] && [ "$STATUS" != "claim_pending" ]; then
    if [ -z "$SHIELD_REQUESTED" ] && [ "$STATUS" = "not_shielded" ]; then
      echo "" >&2
      echo "Login complete. Starting shielding..." >&2
      curl -sf -X POST "\${SHIELD_URL}" >/dev/null 2>&1
      SHIELD_REQUESTED="1"
      sleep 2
      continue
    fi
    WAS_CLAIMING=""
  fi

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
      WAS_CLAIMING="1"
      echo "" >&2
      echo "Login required for your organization." >&2
      CLAIM_RESPONSE=$(start_claim)
      CLAIM_URL=$(parse_field "$CLAIM_RESPONSE" "claimUrl")
      if [ -n "$CLAIM_URL" ]; then
        echo "Open this URL to login:" >&2
        echo "  $CLAIM_URL" >&2
        echo "" >&2
        printf "Waiting for login approval (press Ctrl+C to cancel)..." >&2
        BROWSER_OPENED="1"
      fi
      sleep 3
      ;;
    claim_pending)
      WAS_CLAIMING="1"
      if [ -z "$BROWSER_OPENED" ]; then
        # A claim session is pending but we haven't opened the browser yet.
        # Show the URL but don't auto-open — the user may have started the
        # claim from the menu bar or a previous wrapper invocation.
        CLAIM_POLL=$(start_claim)
        if [ -n "$CLAIM_POLL" ]; then
          POLL_URL=$(parse_field "$CLAIM_POLL" "claimUrl")
          if [ -n "$POLL_URL" ]; then
            echo "Login is pending. Complete it in your browser:" >&2
            echo "  $POLL_URL" >&2
            BROWSER_OPENED="1"
          fi
        fi
      fi
      printf "\\rWaiting for login approval..." >&2
      sleep 3
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
      SHIELD_ATTEMPTS=$((SHIELD_ATTEMPTS + 1))
      if [ "$SHIELD_ATTEMPTS" -gt 2 ]; then
        echo "" >&2
        echo "Shielding failed. Run 'agenshield install' to retry." >&2
        exit 1
      fi
      echo "" >&2
      echo "Claude Code is not yet shielded by AgenShield." >&2
      if [ -n "$SHIELD_REQUESTED" ]; then
        # Already requested shielding — wait without re-prompting
        sleep 3
      elif [ -t 0 ]; then
        printf "Shield now? [Y/n] " >&2
        read -r SHIELD_ANSWER
        case "\$SHIELD_ANSWER" in
          [nN]*)
            echo "Skipping. Claude Code unavailable until shielded." >&2
            exit 1
            ;;
          *)
            curl -sf -X POST "\${SHIELD_URL}" >/dev/null 2>&1
            SHIELD_REQUESTED="1"
            echo "Starting shielding..." >&2
            sleep 2
            ;;
        esac
      else
        # Non-interactive: trigger once then exit on next failure
        if [ "$SHIELD_ATTEMPTS" -le 1 ]; then
          curl -sf -X POST "\${SHIELD_URL}" >/dev/null 2>&1
          SHIELD_REQUESTED="1"
          echo "Starting shielding..." >&2
          sleep 2
        else
          echo "Claude Code not shielded. Run 'agenshield install' to shield." >&2
          exit 1
        fi
      fi
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
export function installClaudeWrapper(): { installed: string[] } {
  const installed: string[] = [];
  const wrapperPaths = [
    path.join(AGENSHIELD_HOME, 'bin', 'claude'),
    '/usr/local/bin/claude',
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
