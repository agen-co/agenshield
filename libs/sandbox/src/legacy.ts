/**
 * Legacy constants and functions kept for backward compatibility.
 * All items in this file have modern replacements elsewhere in the library.
 * Delete this file once all consumers have migrated.
 */

import { spawnSync, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { sudoExec } from './exec/sudo.js';
import { GUARDED_SHELL_CONTENT } from './shell/guarded-shell.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Shared guarded-shell path — kept for backward compat / restore.ts legacy cleanup.
 * New targets use per-target guardedShellPath(agentHome) under $agentHome/.agenshield/bin instead.
 */
export const GUARDED_SHELL_PATH = '/usr/local/bin/guarded-shell';

/**
 * @deprecated Shared ZDOTDIR path — kept for migration compat with old targets.
 * New targets use per-target zdotDir() under $agentHome/.zdot instead.
 */
export const ZDOT_DIR = '/etc/agenshield/zdot';

/**
 * Legacy ZDOTDIR .zshenv content — uses shared /usr/local/bin/guarded-shell.
 * Use zdotZshenvContent(agentHome) instead for per-target .zshenv.
 */
export const ZDOT_ZSHENV_CONTENT = `# AgenShield restricted .zshenv
# Runs AFTER /etc/zshenv — overrides path_helper's full system PATH.

# ALWAYS set HOME based on actual user, never inherit
export HOME="/Users/\$(id -un)"
export HISTFILE="\$HOME/.zsh_history"

# Suppress locale to prevent /etc/zshrc from calling locale command
export LC_ALL=C LANG=C

export PATH="$HOME/bin:$HOME/homebrew/bin"
export SHELL="/usr/local/bin/guarded-shell"

# Homebrew environment (agent-local prefix)
export HOMEBREW_PREFIX="$HOME/homebrew"
export HOMEBREW_CELLAR="$HOME/homebrew/Cellar"
export HOMEBREW_REPOSITORY="$HOME/homebrew"

# NVM initialization
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"

# Clear any leftover env tricks
unset DYLD_LIBRARY_PATH DYLD_FALLBACK_LIBRARY_PATH DYLD_INSERT_LIBRARIES
unset PYTHONPATH NODE_PATH RUBYLIB PERL5LIB
unset SSH_ASKPASS LD_PRELOAD

# Skip system rc files (/etc/zprofile, /etc/zshrc, /etc/zlogin)
# They may call commands not in our restricted PATH (e.g. locale).
# ZDOTDIR files (.zshrc) are still read.
setopt NO_GLOBAL_RCS
`;

/**
 * Legacy shield-exec path.
 * Use shieldExecPath() instead.
 */
export const SHIELD_EXEC_PATH = '/opt/agenshield/bin/shield-exec';

/**
 * Legacy shield-exec content as a string, for installation.
 * Use generateShieldExecContent() instead.
 */
export const SHIELD_EXEC_CONTENT = `#!/opt/agenshield/bin/node-bin
import path from 'node:path';
import net from 'node:net';

const DEFAULT_SOCKET_PATH = (process.env.AGENSHIELD_USER_HOME || process.env.HOME || '') + '/.agenshield/run/agenshield.sock';

function sendRequest(socketPath, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      socket.write(JSON.stringify(request) + '\\n');
    });
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
      const idx = data.indexOf('\\n');
      if (idx >= 0) {
        try {
          const resp = JSON.parse(data.slice(0, idx));
          socket.end();
          resolve(resp);
        } catch (e) {
          socket.end();
          reject(new Error('Invalid JSON response: ' + e.message));
        }
      }
    });
    socket.on('error', (err) => reject(new Error('Socket error: ' + err.message)));
    socket.on('end', () => {
      if (data.trim()) {
        try { resolve(JSON.parse(data.trim())); }
        catch { reject(new Error('Connection closed before response')); }
      } else {
        reject(new Error('Connection closed without response'));
      }
    });
    socket.setTimeout(30000, () => {
      socket.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

async function main() {
  const socketPath = process.env.AGENSHIELD_SOCKET || DEFAULT_SOCKET_PATH;
  const invoked = path.basename(process.argv[1] || 'shield-exec');
  const args = process.argv.slice(2);
  const commandName = invoked === 'shield-exec' ? (args.shift() || '') : invoked;

  if (!commandName) {
    process.stderr.write('Usage: shield-exec <command> [args...]\\n');
    process.exit(1);
  }

  const request = {
    jsonrpc: '2.0',
    id: 'shield-exec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    method: 'exec',
    params: { command: commandName, args: args, cwd: process.cwd(), env: process.env },
  };

  try {
    const response = await sendRequest(socketPath, request);
    if (response.error) {
      process.stderr.write('Error: ' + response.error.message + '\\n');
      process.exit(1);
    }
    const data = response.result;
    if (!data) process.exit(0);
    if (data.stdout) process.stdout.write(data.stdout);
    if (data.stderr) process.stderr.write(data.stderr);
    process.exit(data.exitCode ?? 0);
  } catch (err) {
    process.stderr.write('shield-exec error: ' + err.message + '\\n');
    process.exit(1);
  }
}

main().catch((err) => { process.stderr.write('Fatal: ' + err.message + '\\n'); process.exit(1); });
`;

/**
 * @deprecated Legacy path-registry path.
 * Use pathRegistryPath() from @agenshield/ipc instead.
 */
export const PATH_REGISTRY_PATH = '/etc/agenshield/path-registry.json';

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Synchronous check if a user exists (via dscl).
 * Prefer the async `userExists()` for new code.
 */
export function userExistsSync(username: string): boolean {
  const result = spawnSync('dscl', ['.', '-read', `/Users/${username}`], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return result.status === 0;
}

/**
 * Delete a sandbox user and optionally their home directory.
 * Synchronous — used by the restore/uninstall flow.
 * Use the async `deleteUser()` / `deleteAllUsersAndGroups()` instead.
 */
export function deleteSandboxUser(
  username: string,
  options: { removeHomeDir?: boolean } = {},
): { success: boolean; error?: string } {
  const { removeHomeDir = false } = options;

  if (!userExistsSync(username)) {
    return { success: true };
  }

  // Get home directory before deleting user
  let homeDir: string | undefined;
  try {
    const output = execSync(
      `dscl . -read /Users/${username} NFSHomeDirectory`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    const match = output.match(/NFSHomeDirectory:\s+(.+)/);
    if (match?.[1]) {
      homeDir = match[1].trim();
    }
  } catch {
    // Key not found or user doesn't exist — fall through to default
  }
  // Always fall back to standard location
  if (!homeDir) {
    homeDir = `/Users/${username}`;
  }

  // Delete user
  let result = sudoExec(`dscl . -delete /Users/${username}`);
  if (!result.success) {
    return { success: false, error: `Failed to delete user: ${result.error}` };
  }

  // Delete group
  result = sudoExec(`dscl . -delete /Groups/${username}`);
  // Not critical if this fails

  // Remove home directory if requested (skip protected system paths)
  const PROTECTED_PATHS = ['/var/empty', '/private/var/empty', '/var/run', '/tmp', '/dev/null'];
  if (removeHomeDir && homeDir && !PROTECTED_PATHS.includes(homeDir)) {
    result = sudoExec(`rm -rf "${homeDir}"`);
    if (!result.success) {
      // Log but don't fail - user is already deleted
      console.warn(`Warning: Could not remove home directory: ${result.error}`);
    }
  }

  return { success: true };
}

/**
 * Legacy function from macos.ts.
 * Use `createUser()` instead.
 */
export function createSandboxUser(config: Partial<{
  username: string;
  homeDir: string;
  shell: string;
  realName: string;
}> = {}): {
  success: boolean;
  user?: { username: string; uid: number; gid: number; homeDir: string; shell: string };
  error?: string;
} {
  const cfg = {
    username: config.username ?? 'openclaw',
    homeDir: config.homeDir ?? `/Users/${config.username ?? 'openclaw'}`,
    shell: config.shell ?? '/usr/local/bin/guarded-shell',
    realName: config.realName ?? 'OpenClaw Sandbox',
  };

  if (userExistsSync(cfg.username)) {
    try {
      const uid = parseInt(
        execSync(`dscl . -read /Users/${cfg.username} UniqueID | awk '{print $2}'`, {
          encoding: 'utf-8',
        }).trim(),
        10,
      );
      const gid = parseInt(
        execSync(`dscl . -read /Users/${cfg.username} PrimaryGroupID | awk '{print $2}'`, {
          encoding: 'utf-8',
        }).trim(),
        10,
      );

      return {
        success: true,
        user: { username: cfg.username, uid, gid, homeDir: cfg.homeDir, shell: cfg.shell },
      };
    } catch (err) {
      return { success: false, error: `User exists but could not read info: ${err}` };
    }
  }

  const getNextUid = (): number => {
    try {
      const output = execSync("dscl . -list /Users UniqueID | awk '{print $2}' | sort -n | tail -1", {
        encoding: 'utf-8',
      });
      return Math.max(501, parseInt(output.trim(), 10) + 1);
    } catch {
      return 501;
    }
  };

  const uid = getNextUid();
  const gid = uid;

  let result = sudoExec(`dscl . -create /Groups/${cfg.username}`);
  if (!result.success) return { success: false, error: `Failed to create group: ${result.error}` };

  result = sudoExec(`dscl . -create /Groups/${cfg.username} PrimaryGroupID ${gid}`);
  if (!result.success) return { success: false, error: `Failed to set group ID: ${result.error}` };

  result = sudoExec(`dscl . -create /Users/${cfg.username}`);
  if (!result.success) return { success: false, error: `Failed to create user: ${result.error}` };

  result = sudoExec(`dscl . -create /Users/${cfg.username} UserShell ${cfg.shell}`);
  if (!result.success) return { success: false, error: `Failed to set shell: ${result.error}` };

  result = sudoExec(`dscl . -create /Users/${cfg.username} RealName "${cfg.realName}"`);
  if (!result.success) return { success: false, error: `Failed to set real name: ${result.error}` };

  result = sudoExec(`dscl . -create /Users/${cfg.username} UniqueID ${uid}`);
  if (!result.success) return { success: false, error: `Failed to set UID: ${result.error}` };

  result = sudoExec(`dscl . -create /Users/${cfg.username} PrimaryGroupID ${gid}`);
  if (!result.success) return { success: false, error: `Failed to set GID: ${result.error}` };

  result = sudoExec(`dscl . -create /Users/${cfg.username} NFSHomeDirectory ${cfg.homeDir}`);
  if (!result.success) return { success: false, error: `Failed to set home dir: ${result.error}` };

  result = sudoExec(`mkdir -p ${cfg.homeDir}`);
  if (!result.success) return { success: false, error: `Failed to create home dir: ${result.error}` };

  result = sudoExec(`chown -R ${cfg.username}:${gid} ${cfg.homeDir}`);
  if (!result.success) return { success: false, error: `Failed to set ownership: ${result.error}` };

  sudoExec(`dscl . -create /Users/${cfg.username} IsHidden 1`);

  return {
    success: true,
    user: { username: cfg.username, uid, gid, homeDir: cfg.homeDir, shell: cfg.shell },
  };
}

/**
 * Create and install the guarded shell script to the shared legacy path.
 * New targets use per-target guardedShellPath(agentHome) instead.
 */
export function createGuardedShell(): { success: boolean; error?: string } {
  const tempPath = '/tmp/guarded-shell';
  try {
    fs.writeFileSync(tempPath, GUARDED_SHELL_CONTENT, { mode: 0o755 });
  } catch (err) {
    return { success: false, error: `Failed to write temp file: ${err}` };
  }

  const result = sudoExec(`mv ${tempPath} ${GUARDED_SHELL_PATH} && chmod 755 ${GUARDED_SHELL_PATH}`);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  sudoExec(`chown root:wheel ${GUARDED_SHELL_PATH}`);
  sudoExec(`grep -q "${GUARDED_SHELL_PATH}" /etc/shells || echo "${GUARDED_SHELL_PATH}" >> /etc/shells`);

  return { success: true };
}

/**
 * No longer used — migration is now non-destructive (read-only copy).
 * The original config directory is never touched. Kept for backward compatibility.
 */
export function backupOriginalConfig(_configPath: string): {
  success: boolean;
  backupPath?: string;
  error?: string;
} {
  // No-op: the new migration flow never modifies the original directory.
  return { success: true };
}

/**
 * Generate the broker LaunchDaemon plist (legacy - no UserConfig).
 * Use generateBrokerPlist() with UserConfig instead.
 */
export function generateBrokerPlistLegacy(options?: {
  brokerBinary?: string;
  configPath?: string;
  socketPath?: string;
}): string {
  const brokerBinary = options?.brokerBinary || '/opt/agenshield/bin/agenshield-broker';
  const configPath = options?.configPath || '/opt/agenshield/config/shield.json';
  const home = process.env['AGENSHIELD_USER_HOME'] || process.env['HOME'] || '';
  const socketPath = options?.socketPath || `${home}/.agenshield/run/agenshield.sock`;
  const logsDir = `${home}/.agenshield/logs`;

  const hostAppExists = fs.existsSync('/Applications/AgenShieldES.app');
  const associatedBundleBlock = hostAppExists
    ? `
    <key>AssociatedBundleIdentifiers</key>
    <array>
        <string>com.frontegg.AgenShieldES</string>
    </array>
`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agenshield.broker</string>
${associatedBundleBlock}
    <key>ProgramArguments</key>
    <array>
        <string>${brokerBinary}</string>
    </array>

    <key>UserName</key>
    <string>ash_default_broker</string>

    <key>GroupName</key>
    <string>ash_default</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>${logsDir}/broker.log</string>

    <key>StandardErrorPath</key>
    <string>${logsDir}/broker.error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>AGENSHIELD_CONFIG</key>
        <string>${configPath}</string>
        <key>AGENSHIELD_SOCKET</key>
        <string>${socketPath}</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>

    <key>WorkingDirectory</key>
    <string>/opt/agenshield</string>

    <key>SoftResourceLimits</key>
    <dict>
        <key>NumberOfFiles</key>
        <integer>4096</integer>
    </dict>
</dict>
</plist>
`;
}
