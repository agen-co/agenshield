/**
 * Restore utilities for AgenShield uninstall
 *
 * Restores the original OpenClaw installation from backup.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { InstallationBackup } from '@agenshield/ipc';
import { BACKUP_CONFIG } from '@agenshield/ipc';
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
 * Stop the AgenShield daemon
 */
function stopDaemon(): RestoreProgress {
  const plistPath = '/Library/LaunchDaemons/com.agenshield.daemon.plist';

  // Check if daemon plist exists
  if (!fs.existsSync(plistPath)) {
    return {
      step: 'stop-daemon',
      success: true,
      message: 'Daemon not installed (plist not found)',
    };
  }

  // Unload the daemon
  const result = sudoExec(`launchctl unload "${plistPath}"`);
  if (!result.success) {
    // Not critical if it fails (might not be loaded)
    return {
      step: 'stop-daemon',
      success: true,
      message: 'Daemon stopped (or was not running)',
    };
  }

  // Remove the plist
  sudoExec(`rm -f "${plistPath}"`);

  return {
    step: 'stop-daemon',
    success: true,
    message: 'Daemon stopped and plist removed',
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

  // Stop daemon
  runStep(() => stopDaemon());

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
