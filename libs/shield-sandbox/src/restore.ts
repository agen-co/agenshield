/**
 * Restore utilities for AgenShield uninstall
 *
 * Restores the original OpenClaw installation from backup.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { InstallationBackup } from '@agenshield/ipc';
import { BACKUP_CONFIG, DEFAULT_PORT } from '@agenshield/ipc';
import { loadBackup, deleteBackup, restoreOriginalConfig } from './backup';
import { deleteSandboxUser } from './macos';
import { GUARDED_SHELL_PATH } from './guarded-shell';

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

export type RestoreStep =
  | 'validate'
  | 'stop-daemon'
  | 'stop-broker'
  | 'kill-processes'
  | 'restore-config'
  | 'restore-package'
  | 'delete-user'
  | 'remove-shell'
  | 'cleanup'
  | 'verify';

export interface RestoreProgress {
  step: RestoreStep;
  success: boolean;
  message: string;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  steps: RestoreProgress[];
  error?: string;
}

/**
 * Find daemon PID by port using lsof
 * Fallback for manually started daemons without launchd
 */
function findDaemonPidByPort(port: number): number | null {
  try {
    const output = execSync(`lsof -ti :${port}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    }).trim();
    if (output) {
      const pid = parseInt(output.split('\n')[0], 10);
      if (!isNaN(pid)) return pid;
    }
  } catch {
    // lsof failed or no process found
  }
  return null;
}

/**
 * Stop the AgenShield daemon
 */
/**
 * Wait for a process to exit, escalating to SIGKILL if needed.
 * Returns true if the process is gone.
 */
function waitForProcessExit(pid: number, timeoutMs = 5000): boolean {
  const start = Date.now();
  // Poll until process is gone or timeout
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0); // Throws ESRCH if process is gone
    } catch {
      return true; // Process exited
    }
    execSync('sleep 0.2', { stdio: 'pipe' });
  }
  // Still alive — escalate to SIGKILL
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return true; // Already gone
  }
  // Wait a bit more after SIGKILL
  const killStart = Date.now();
  while (Date.now() - killStart < 2000) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    execSync('sleep 0.2', { stdio: 'pipe' });
  }
  return false;
}

function stopDaemon(): RestoreProgress {
  const plistPath = '/Library/LaunchDaemons/com.agenshield.daemon.plist';

  // Remove plist FIRST to prevent launchd from respawning, then unload
  if (fs.existsSync(plistPath)) {
    sudoExec(`rm -f "${plistPath}"`);
    sudoExec(`launchctl unload "${plistPath}" 2>/dev/null || true`);
  }

  // Kill any process still on the port
  const pid = findDaemonPidByPort(DEFAULT_PORT);

  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (err) {
      const errCode = (err as NodeJS.ErrnoException).code;
      if (errCode === 'ESRCH') {
        return {
          step: 'stop-daemon',
          success: true,
          message: `Daemon process ${pid} already terminated`,
        };
      }
      // EPERM — try sudo kill
      sudoExec(`kill -9 ${pid}`);
    }

    const exited = waitForProcessExit(pid);
    if (!exited) {
      // Last resort: sudo kill -9
      sudoExec(`kill -9 ${pid}`);
      waitForProcessExit(pid, 2000);
    }

    return {
      step: 'stop-daemon',
      success: true,
      message: `Daemon stopped (PID ${pid})`,
    };
  }

  return {
    step: 'stop-daemon',
    success: true,
    message: 'Daemon not installed (plist not found, no process on port)',
  };
}

/**
 * Stop and remove the broker LaunchDaemon
 */
function stopBrokerDaemon(): RestoreProgress {
  const plistPath = '/Library/LaunchDaemons/com.agenshield.broker.plist';

  if (!fs.existsSync(plistPath)) {
    return {
      step: 'stop-broker',
      success: true,
      message: 'Broker daemon not installed (plist not found)',
    };
  }

  // Remove plist first to prevent respawn, then unload
  sudoExec(`rm -f "${plistPath}"`);
  sudoExec(`launchctl unload "${plistPath}" 2>/dev/null || true`);

  return {
    step: 'stop-broker',
    success: true,
    message: 'Broker daemon stopped and plist removed',
  };
}

/**
 * Kill all processes running as a specific user
 *
 * This ensures that:
 * 1. Terminal sessions running as the user are terminated
 * 2. Home directory can be removed without "resource busy" errors
 */
function killUserProcesses(username: string): RestoreProgress {
  // First, try graceful termination
  try {
    sudoExec(`pkill -u ${username} 2>/dev/null || true`);
  } catch {
    // Ignore - user may not exist or have no processes
  }

  // Brief wait for graceful termination
  try {
    execSync('sleep 1', { encoding: 'utf-8' });
  } catch {
    // Ignore sleep errors
  }

  // Force kill any remaining processes
  try {
    sudoExec(`pkill -9 -u ${username} 2>/dev/null || true`);
  } catch {
    // Ignore
  }

  return {
    step: 'kill-processes',
    success: true,
    message: `Terminated processes for user "${username}"`,
  };
}

/**
 * Restore the original config directory
 */
function restoreConfig(backup: InstallationBackup): RestoreProgress {
  const { configBackupPath, configPath } = backup.originalInstallation;

  if (!configBackupPath) {
    return {
      step: 'restore-config',
      success: true,
      message: 'No config backup to restore',
    };
  }

  if (!fs.existsSync(configBackupPath)) {
    return {
      step: 'restore-config',
      success: true,
      message: `Config backup not found at ${configBackupPath}, skipping`,
    };
  }

  const targetPath = configPath || path.join(backup.originalUserHome, '.openclaw');
  const result = restoreOriginalConfig(configBackupPath, targetPath);

  if (!result.success) {
    return {
      step: 'restore-config',
      success: false,
      message: 'Failed to restore config',
      error: result.error,
    };
  }

  return {
    step: 'restore-config',
    success: true,
    message: `Config restored to ${targetPath}`,
  };
}

/**
 * Restore the original package (for git installs only)
 * For npm installs, the package is still in place
 */
function restorePackage(backup: InstallationBackup): RestoreProgress {
  const { method, packagePath } = backup.originalInstallation;

  if (method === 'npm') {
    // npm package wasn't moved, just copied
    // The original is still at the npm global location
    return {
      step: 'restore-package',
      success: true,
      message: 'npm package was not moved (still at original location)',
    };
  }

  // For git installs, we need to check if we can restore
  // The original was copied, not moved, so it should still be there
  if (packagePath && fs.existsSync(packagePath)) {
    return {
      step: 'restore-package',
      success: true,
      message: `Git package still at original location: ${packagePath}`,
    };
  }

  return {
    step: 'restore-package',
    success: true,
    message: 'Package location verified',
  };
}

/**
 * Delete the sandbox user and their home directory
 */
function deleteUser(backup: InstallationBackup): RestoreProgress {
  const { username } = backup.sandboxUser;

  // Delete the user and home directory
  const result = deleteSandboxUser(username, { removeHomeDir: true });

  if (!result.success) {
    return {
      step: 'delete-user',
      success: false,
      message: 'Failed to delete sandbox user',
      error: result.error,
    };
  }

  return {
    step: 'delete-user',
    success: true,
    message: `Sandbox user "${username}" and home directory removed`,
  };
}

/**
 * Remove the guarded shell
 */
function removeGuardedShell(): RestoreProgress {
  if (!fs.existsSync(GUARDED_SHELL_PATH)) {
    return {
      step: 'remove-shell',
      success: true,
      message: 'Guarded shell not found (already removed)',
    };
  }

  // Remove from /etc/shells first
  sudoExec(`sed -i '' '\\|${GUARDED_SHELL_PATH}|d' /etc/shells`);

  // Remove the shell script
  const result = sudoExec(`rm -f "${GUARDED_SHELL_PATH}"`);
  if (!result.success) {
    return {
      step: 'remove-shell',
      success: false,
      message: 'Failed to remove guarded shell',
      error: result.error,
    };
  }

  return {
    step: 'remove-shell',
    success: true,
    message: 'Guarded shell removed',
  };
}

/**
 * Clean up AgenShield directories and files
 */
function cleanup(): RestoreProgress {
  const cleanupPaths = [
    BACKUP_CONFIG.configDir, // /etc/agenshield
    '/var/log/agenshield',
    '/var/run/agenshield',
    '/var/run/agenshield/agenshield.sock', // Socket file (legacy location)
    '/opt/agenshield', // Installation directory
    '/Applications/AgenShieldES.app', // ES extension app bundle
  ];

  const errors: string[] = [];

  for (const p of cleanupPaths) {
    if (fs.existsSync(p)) {
      const result = sudoExec(`rm -rf "${p}"`);
      if (!result.success) {
        errors.push(`Failed to remove ${p}: ${result.error}`);
      }
    }
  }

  if (errors.length > 0) {
    return {
      step: 'cleanup',
      success: false,
      message: 'Some cleanup failed',
      error: errors.join('; '),
    };
  }

  return {
    step: 'cleanup',
    success: true,
    message: 'AgenShield directories cleaned up',
  };
}

/**
 * Verify OpenClaw works after restore
 */
function verify(backup: InstallationBackup): RestoreProgress {
  const { binaryPath, method } = backup.originalInstallation;

  // Try to run openclaw --version
  let cmd: string;
  if (binaryPath && fs.existsSync(binaryPath)) {
    cmd = `"${binaryPath}" --version`;
  } else if (method === 'npm') {
    // Try to find via npm
    cmd = 'openclaw --version';
  } else {
    return {
      step: 'verify',
      success: true,
      message: 'Could not verify (binary path not found), but uninstall complete',
    };
  }

  try {
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000 }).trim();
    return {
      step: 'verify',
      success: true,
      message: `OpenClaw verified: ${output}`,
    };
  } catch {
    return {
      step: 'verify',
      success: true,
      message: 'Could not verify OpenClaw (may need to fix PATH)',
    };
  }
}

/**
 * Perform full restore/uninstall process
 */
export function restoreInstallation(
  backup: InstallationBackup,
  onProgress?: (progress: RestoreProgress) => void
): RestoreResult {
  const steps: RestoreProgress[] = [];

  // Helper to run a step and track results
  const runStep = (fn: () => RestoreProgress): boolean => {
    const result = fn();
    steps.push(result);
    onProgress?.(result);
    return result.success;
  };

  // Stop main daemon
  runStep(() => stopDaemon());

  // Stop broker daemon
  runStep(() => stopBrokerDaemon());

  // Kill agent user processes (ensures home directory can be removed)
  if (backup.sandboxUser?.username) {
    runStep(() => killUserProcesses(backup.sandboxUser.username));
  }

  // Kill broker user processes
  // The broker username follows pattern: {prefix}_broker instead of {prefix}_agent
  const agentUsername = backup.sandboxUser?.username;
  if (agentUsername && agentUsername.endsWith('_agent')) {
    const brokerUsername = agentUsername.replace(/_agent$/, '_broker');
    runStep(() => killUserProcesses(brokerUsername));
  }

  // Restore config (not critical)
  runStep(() => restoreConfig(backup));

  // Restore package (not critical for npm)
  runStep(() => restorePackage(backup));

  // Delete sandbox user (important)
  if (!runStep(() => deleteUser(backup))) {
    return {
      success: false,
      steps,
      error: steps[steps.length - 1].error,
    };
  }

  // Delete broker user (if exists)
  if (agentUsername && agentUsername.endsWith('_agent')) {
    const brokerUsername = agentUsername.replace(/_agent$/, '_broker');
    runStep(() => {
      const result = deleteSandboxUser(brokerUsername, { removeHomeDir: true });
      if (!result.success) {
        return {
          step: 'delete-user' as RestoreStep,
          success: false,
          message: `Failed to delete broker user ${brokerUsername}`,
          error: result.error,
        };
      }
      return {
        step: 'delete-user' as RestoreStep,
        success: true,
        message: `Broker user "${brokerUsername}" removed`,
      };
    });
  }

  // Remove guarded shell
  runStep(() => removeGuardedShell());

  // Cleanup directories
  runStep(() => cleanup());

  // Verify
  runStep(() => verify(backup));

  return {
    success: true,
    steps,
  };
}

/**
 * Check if uninstall is possible
 */
export function canUninstall(): {
  canUninstall: boolean;
  isRoot: boolean;
  hasBackup: boolean;
  backup: InstallationBackup | null;
  error?: string;
} {
  const isRoot = process.getuid?.() === 0;
  const backup = loadBackup();
  const hasBackup = backup !== null;

  if (!isRoot) {
    return {
      canUninstall: false,
      isRoot: false,
      hasBackup,
      backup,
      error: 'Uninstall requires root privileges',
    };
  }

  if (!hasBackup) {
    return {
      canUninstall: false,
      isRoot: true,
      hasBackup: false,
      backup: null,
      error: 'No backup found - cannot safely uninstall',
    };
  }

  return {
    canUninstall: true,
    isRoot: true,
    hasBackup: true,
    backup,
  };
}

/**
 * Discover sandbox users by looking for users with ash_ prefix
 */
function discoverSandboxUsers(): string[] {
  try {
    const output = execSync('dscl . -list /Users', { encoding: 'utf-8' });
    return output.split('\n').filter((u) => u.startsWith('ash_'));
  } catch {
    return [];
  }
}

/**
 * Discover workspace groups by looking for groups with ash_ prefix
 */
function discoverWorkspaceGroups(): string[] {
  try {
    const output = execSync('dscl . -list /Groups', { encoding: 'utf-8' });
    return output.split('\n').filter((g) => g.startsWith('ash_') && g.endsWith('_workspace'));
  } catch {
    return [];
  }
}

/**
 * Discover socket groups by looking for groups with ash_ prefix (excluding workspace groups)
 */
function discoverSocketGroups(): string[] {
  try {
    const output = execSync('dscl . -list /Groups', { encoding: 'utf-8' });
    return output.split('\n').filter((g) => g.startsWith('ash_') && !g.endsWith('_workspace'));
  } catch {
    return [];
  }
}

/**
 * Force uninstall without a backup
 * Used when no backup exists but user wants to clean up AgenShield artifacts
 */
/**
 * Check if daemon or broker are still present (plist exists or process on port)
 */
function isDaemonPresent(): boolean {
  if (fs.existsSync('/Library/LaunchDaemons/com.agenshield.daemon.plist')) return true;
  if (findDaemonPidByPort(DEFAULT_PORT)) return true;
  return false;
}

function isBrokerPresent(): boolean {
  return fs.existsSync('/Library/LaunchDaemons/com.agenshield.broker.plist');
}

export function forceUninstall(
  onProgress?: (progress: RestoreProgress) => void
): RestoreResult {
  const steps: RestoreProgress[] = [];

  const runStep = (fn: () => RestoreProgress): boolean => {
    const result = fn();
    steps.push(result);
    onProgress?.(result);
    return result.success;
  };

  // Loop stop daemon + broker until both are fully gone (launchd may respawn)
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const daemonUp = isDaemonPresent();
    const brokerUp = isBrokerPresent();
    if (!daemonUp && !brokerUp) break;

    if (daemonUp) runStep(() => stopDaemon());
    if (brokerUp) runStep(() => stopBrokerDaemon());

    // Brief pause for launchd to settle
    try { execSync('sleep 1', { encoding: 'utf-8' }); } catch { /* ignore */ }
  }

  // Discover sandbox users
  const sandboxUsers = discoverSandboxUsers();

  // Kill processes for all sandbox users before deletion
  for (const username of sandboxUsers) {
    runStep(() => killUserProcesses(username));
  }

  // Delete sandbox users
  for (const username of sandboxUsers) {
    runStep(() => {
      const result = deleteSandboxUser(username, { removeHomeDir: true });
      if (!result.success) {
        return {
          step: 'delete-user',
          success: false,
          message: `Failed to delete user ${username}`,
          error: result.error,
        };
      }
      return {
        step: 'delete-user',
        success: true,
        message: `Deleted sandbox user "${username}"`,
      };
    });
  }

  if (sandboxUsers.length === 0) {
    runStep(() => ({
      step: 'delete-user',
      success: true,
      message: 'No sandbox users found to delete',
    }));
  }

  // Discover and delete workspace groups
  const workspaceGroups = discoverWorkspaceGroups();
  for (const groupName of workspaceGroups) {
    runStep(() => {
      const result = sudoExec(`dscl . -delete /Groups/${groupName}`);
      if (!result.success) {
        return {
          step: 'cleanup',
          success: true, // Non-critical
          message: `Could not delete group ${groupName}`,
          error: result.error,
        };
      }
      return {
        step: 'cleanup',
        success: true,
        message: `Deleted workspace group "${groupName}"`,
      };
    });
  }

  // Discover and delete socket groups (non-workspace groups)
  const socketGroups = discoverSocketGroups();
  for (const groupName of socketGroups) {
    runStep(() => {
      const result = sudoExec(`dscl . -delete /Groups/${groupName}`);
      if (!result.success) {
        return {
          step: 'cleanup',
          success: true, // Non-critical
          message: `Could not delete group ${groupName}`,
          error: result.error,
        };
      }
      return {
        step: 'cleanup',
        success: true,
        message: `Deleted socket group "${groupName}"`,
      };
    });
  }

  // Remove guarded shell
  runStep(() => removeGuardedShell());

  // Cleanup directories
  runStep(() => cleanup());

  // Verify - skip since we don't have original binary info
  runStep(() => ({
    step: 'verify',
    success: true,
    message: 'Force uninstall complete (no backup to verify against)',
  }));

  return {
    success: true,
    steps,
  };
}
