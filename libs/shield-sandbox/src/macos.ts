/**
 * macOS sandbox user management
 *
 * Creates and configures an unprivileged user for running OpenClaw
 * in an isolated environment.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import type { SandboxUser, SandboxConfig, CreateUserResult, DirectoryStructure } from './types';
import { GUARDED_SHELL_PATH, GUARDED_SHELL_CONTENT } from './guarded-shell';

const DEFAULT_CONFIG: SandboxConfig = {
  username: 'openclaw',
  homeDir: '/Users/openclaw',
  shell: '/usr/local/bin/guarded-shell',
  realName: 'OpenClaw Sandbox',
};

/**
 * Execute a command with sudo
 */
function sudoExec(cmd: string): { success: boolean; output?: string; error?: string } {
  try {
    const output = execSync(`sudo ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { success: true, output: output.trim() };
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    return { success: false, error: error.stderr || error.message || 'Unknown error' };
  }
}

/**
 * Check if a user exists
 */
export function userExists(username: string): boolean {
  const result = spawnSync('dscl', ['.', '-read', `/Users/${username}`], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return result.status === 0;
}

/**
 * Get the next available UID (> 500)
 */
function getNextUid(): number {
  try {
    const output = execSync("dscl . -list /Users UniqueID | awk '{print $2}' | sort -n | tail -1", {
      encoding: 'utf-8',
    });
    const maxUid = parseInt(output.trim(), 10);
    return Math.max(501, maxUid + 1);
  } catch {
    return 501;
  }
}

/**
 * Create the guarded shell script
 */
export function createGuardedShell(): { success: boolean; error?: string } {
  // Write to temp file first
  const tempPath = '/tmp/guarded-shell';
  try {
    fs.writeFileSync(tempPath, GUARDED_SHELL_CONTENT, { mode: 0o755 });
  } catch (err) {
    return { success: false, error: `Failed to write temp file: ${err}` };
  }

  // Move to final location with sudo
  const result = sudoExec(`mv ${tempPath} ${GUARDED_SHELL_PATH} && chmod 755 ${GUARDED_SHELL_PATH}`);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  // Set ownership to root
  sudoExec(`chown root:wheel ${GUARDED_SHELL_PATH}`);

  // Add to /etc/shells if not already there
  sudoExec(`grep -q "${GUARDED_SHELL_PATH}" /etc/shells || echo "${GUARDED_SHELL_PATH}" >> /etc/shells`);

  return { success: true };
}

/**
 * Create the sandbox user on macOS
 */
export function createSandboxUser(config: Partial<SandboxConfig> = {}): CreateUserResult {
  const cfg: SandboxConfig = { ...DEFAULT_CONFIG, ...config };

  // Check if user already exists
  if (userExists(cfg.username)) {
    // Get existing user info
    try {
      const uid = parseInt(
        execSync(`dscl . -read /Users/${cfg.username} UniqueID | awk '{print $2}'`, {
          encoding: 'utf-8',
        }).trim(),
        10
      );
      const gid = parseInt(
        execSync(`dscl . -read /Users/${cfg.username} PrimaryGroupID | awk '{print $2}'`, {
          encoding: 'utf-8',
        }).trim(),
        10
      );

      return {
        success: true,
        user: {
          username: cfg.username,
          uid,
          gid,
          homeDir: cfg.homeDir,
          shell: cfg.shell,
        },
      };
    } catch (err) {
      return { success: false, error: `User exists but could not read info: ${err}` };
    }
  }

  // Create guarded shell first
  const shellResult = createGuardedShell();
  if (!shellResult.success) {
    return { success: false, error: `Failed to create guarded shell: ${shellResult.error}` };
  }

  const uid = getNextUid();
  const gid = uid;

  // Create group
  let result = sudoExec(`dscl . -create /Groups/${cfg.username}`);
  if (!result.success) return { success: false, error: `Failed to create group: ${result.error}` };

  result = sudoExec(`dscl . -create /Groups/${cfg.username} PrimaryGroupID ${gid}`);
  if (!result.success) return { success: false, error: `Failed to set group ID: ${result.error}` };

  // Create user
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

  // Create home directory
  result = sudoExec(`mkdir -p ${cfg.homeDir}`);
  if (!result.success)
    return { success: false, error: `Failed to create home dir: ${result.error}` };

  result = sudoExec(`chown -R ${cfg.username}:${cfg.username} ${cfg.homeDir}`);
  if (!result.success)
    return { success: false, error: `Failed to set ownership: ${result.error}` };

  // Hide user from login window
  result = sudoExec(`dscl . -create /Users/${cfg.username} IsHidden 1`);
  // Not critical if this fails

  return {
    success: true,
    user: {
      username: cfg.username,
      uid,
      gid,
      homeDir: cfg.homeDir,
      shell: cfg.shell,
    },
  };
}

/**
 * Create the directory structure for the sandbox user
 */
export function createDirectoryStructure(user: SandboxUser): {
  success: boolean;
  dirs?: DirectoryStructure;
  error?: string;
} {
  const dirs: DirectoryStructure = {
    binDir: path.join(user.homeDir, 'bin'),
    wrappersDir: path.join(user.homeDir, 'bin-wrappers'),
    configDir: path.join(user.homeDir, '.openclaw'),
    packageDir: path.join(user.homeDir, '.openclaw-pkg'),
    npmDir: path.join(user.homeDir, '.npm-global'),
  };

  // Create all directories
  for (const dir of Object.values(dirs)) {
    const result = sudoExec(`mkdir -p ${dir}`);
    if (!result.success) {
      return { success: false, error: `Failed to create ${dir}: ${result.error}` };
    }
  }

  // Set ownership
  const result = sudoExec(`chown -R ${user.username}:${user.username} ${user.homeDir}`);
  if (!result.success) {
    return { success: false, error: `Failed to set ownership: ${result.error}` };
  }

  // Create .bashrc and .zshrc with proper PATH
  const rcContent = `# AgenShield Sandbox Environment
export PATH="$HOME/bin-wrappers:$HOME/bin:$HOME/.npm-global/bin"
export npm_config_prefix="$HOME/.npm-global"
`;

  const tempRc = '/tmp/sandbox-rc';
  fs.writeFileSync(tempRc, rcContent);
  sudoExec(`cp ${tempRc} ${user.homeDir}/.bashrc`);
  sudoExec(`cp ${tempRc} ${user.homeDir}/.zshrc`);
  sudoExec(`chown ${user.username}:${user.username} ${user.homeDir}/.bashrc ${user.homeDir}/.zshrc`);
  fs.unlinkSync(tempRc);

  return { success: true, dirs };
}

/**
 * Delete the sandbox user
 *
 * @param username - The username to delete
 * @param options - Options for deletion
 * @param options.removeHomeDir - Whether to remove the home directory (default: false)
 */
export function deleteSandboxUser(
  username: string,
  options: { removeHomeDir?: boolean } = {}
): { success: boolean; error?: string } {
  const { removeHomeDir = false } = options;

  if (!userExists(username)) {
    return { success: true };
  }

  // Get home directory before deleting user
  let homeDir: string | undefined;
  try {
    const output = execSync(`dscl . -read /Users/${username} NFSHomeDirectory | awk '{print $2}'`, {
      encoding: 'utf-8',
    }).trim();
    if (output) {
      homeDir = output;
    }
  } catch {
    // Fallback to default location
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

  // Remove home directory if requested
  if (removeHomeDir && homeDir) {
    result = sudoExec(`rm -rf "${homeDir}"`);
    if (!result.success) {
      // Log but don't fail - user is already deleted
      console.warn(`Warning: Could not remove home directory: ${result.error}`);
    }
  }

  return { success: true };
}
