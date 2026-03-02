/**
 * Copy Claude Credentials Step
 *
 * Extracts OAuth tokens from the host user's macOS Keychain and writes them
 * as ~/.claude/.credentials.json in the agent's home directory.
 *
 * On macOS, Claude Code stores OAuth credentials in the Keychain (service:
 * "Claude Code" or "Claude Code-credentials"), NOT in files. The agent user
 * cannot access the host user's Keychain entries. This step bridges the gap
 * by reading the host's Keychain entry (requires root/host user privileges)
 * and writing the credentials as a file fallback that Claude Code reads.
 *
 * Best-effort: if Keychain access fails, logs a warning and relies on
 * browser-based OAuth re-auth via the `open` wrapper.
 */

import type { InstallStep } from '../types.js';

export const copyClaudeCredentialsStep: InstallStep = {
  id: 'copy_claude_credentials',
  name: 'Copy Claude credentials',
  description: 'Extract OAuth tokens from host Keychain and write .credentials.json for agent',
  phase: 9,
  progressMessage: 'Copying Claude Code credentials from Keychain...',
  runsAs: 'root',
  timeout: 15_000,
  weight: 2,

  skip(ctx) {
    // Skip on fresh installs (no host credentials to copy) or non-macOS
    return !!ctx.freshInstall || process.platform !== 'darwin';
  },

  async run(ctx) {
    const agentConfigDir = `${ctx.agentHome}/.claude`;
    const credentialsFile = `${agentConfigDir}/.credentials.json`;

    // Try "Claude Code" first, then "Claude Code-credentials"
    const keychainServices = ['Claude Code', 'Claude Code-credentials'];

    const script = `
set -e

CRED_JSON=""

# Try each known Keychain service name
for SERVICE in ${keychainServices.map(s => `"${s}"`).join(' ')}; do
  CRED_JSON=$(sudo -u "${ctx.hostUsername}" security find-generic-password -s "$SERVICE" -w 2>/dev/null || true)
  if [ -n "$CRED_JSON" ]; then
    break
  fi
done

if [ -z "$CRED_JSON" ]; then
  echo "NO_KEYCHAIN_ENTRY"
  exit 0
fi

# Validate it looks like JSON before writing
if echo "$CRED_JSON" | head -c 1 | grep -q '{'; then
  mkdir -p "${agentConfigDir}"
  printf '%s' "$CRED_JSON" > "${credentialsFile}"
  chmod 600 "${credentialsFile}"
  chown ${ctx.agentUsername}:${ctx.socketGroupName} "${credentialsFile}"
  echo "CREDENTIALS_COPIED"
else
  echo "INVALID_FORMAT"
fi
`;

    const result = await ctx.execAsRoot(script, { timeout: 15_000 });

    if (result.output?.includes('NO_KEYCHAIN_ENTRY')) {
      ctx.onLog?.('No Claude Code Keychain entry found — agent will need to authenticate via browser');
      return {
        changed: false,
        warnings: ['No Keychain credentials found — browser OAuth will be required'],
      };
    }

    if (result.output?.includes('INVALID_FORMAT')) {
      ctx.onLog?.('Keychain entry found but not valid JSON — skipping');
      return {
        changed: false,
        warnings: ['Keychain credentials in unexpected format'],
      };
    }

    if (result.output?.includes('CREDENTIALS_COPIED')) {
      ctx.onLog?.('Copied Claude Code OAuth credentials from Keychain');
      return { changed: true };
    }

    // Best-effort: if script failed unexpectedly, don't block the pipeline
    ctx.onLog?.('Could not extract Keychain credentials — agent will authenticate via browser');
    return {
      changed: false,
      warnings: ['Keychain credential extraction failed — browser OAuth will be required'],
    };
  },
};
