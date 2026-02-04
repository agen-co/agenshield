/**
 * Backup utilities for AgenShield installation
 *
 * Saves installation state before migration to enable safe uninstall.
 * Backup is stored in /etc/agenshield/backup.json (root-owned, mode 600).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import type {
  InstallationBackup,
  OriginalInstallation,
  SandboxUserInfo,
  MigratedPaths,
} from '@agenshield/ipc';
import { BACKUP_CONFIG } from '@agenshield/ipc';

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
 * Ensure the backup directory exists with proper permissions
 */
function ensureBackupDir(): { success: boolean; error?: string } {
  // Create directory if it doesn't exist
  let result = sudoExec(`mkdir -p "${BACKUP_CONFIG.configDir}"`);
  if (!result.success) {
    return { success: false, error: `Failed to create config dir: ${result.error}` };
  }

  // Set permissions (root only)
  result = sudoExec(`chmod ${BACKUP_CONFIG.dirMode.toString(8)} "${BACKUP_CONFIG.configDir}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set dir permissions: ${result.error}` };
  }

  // Set ownership to root
  result = sudoExec(`chown root:wheel "${BACKUP_CONFIG.configDir}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set dir ownership: ${result.error}` };
  }

  return { success: true };
}

export interface SaveBackupParams {
  originalInstallation: OriginalInstallation;
  sandboxUser: SandboxUserInfo;
  migratedPaths: MigratedPaths;
}

/**
 * Save installation backup before migration
 */
export function saveBackup(params: SaveBackupParams): { success: boolean; error?: string } {
  const { originalInstallation, sandboxUser, migratedPaths } = params;

  // Ensure backup directory exists
  const dirResult = ensureBackupDir();
  if (!dirResult.success) {
    return dirResult;
  }

  // Create backup data
  const backup: InstallationBackup = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    originalUser: os.userInfo().username,
    originalUserHome: os.homedir(),
    originalInstallation,
    sandboxUser,
    migratedPaths,
  };

  // Write to temp file first
  const tempPath = '/tmp/agenshield-backup.json';
  try {
    fs.writeFileSync(tempPath, JSON.stringify(backup, null, 2), { mode: 0o600 });
  } catch (err) {
    return { success: false, error: `Failed to write temp backup: ${err}` };
  }

  // Move to final location with sudo
  let result = sudoExec(`mv "${tempPath}" "${BACKUP_CONFIG.backupPath}"`);
  if (!result.success) {
    // Clean up temp file
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    return { success: false, error: `Failed to install backup: ${result.error}` };
  }

  // Set permissions (root only)
  result = sudoExec(`chmod ${BACKUP_CONFIG.fileMode.toString(8)} "${BACKUP_CONFIG.backupPath}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set backup permissions: ${result.error}` };
  }

  // Set ownership to root
  result = sudoExec(`chown root:wheel "${BACKUP_CONFIG.backupPath}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set backup ownership: ${result.error}` };
  }

  return { success: true };
}

/**
 * Load installation backup
 * Returns null if no backup exists or if read fails
 */
export function loadBackup(): InstallationBackup | null {
  // Use sudo to read the root-owned file
  const result = sudoExec(`cat "${BACKUP_CONFIG.backupPath}"`);
  if (!result.success || !result.output) {
    return null;
  }

  try {
    const backup = JSON.parse(result.output) as InstallationBackup;

    // Validate backup version
    if (backup.version !== '1.0') {
      console.error(`Unknown backup version: ${backup.version}`);
      return null;
    }

    return backup;
  } catch {
    return null;
  }
}

/**
 * Check if a backup exists
 */
export function backupExists(): boolean {
  const result = sudoExec(`test -f "${BACKUP_CONFIG.backupPath}" && echo "exists"`);
  return result.success && result.output === 'exists';
}

/**
 * Delete the backup file (called after successful uninstall)
 */
export function deleteBackup(): { success: boolean; error?: string } {
  const result = sudoExec(`rm -f "${BACKUP_CONFIG.backupPath}"`);
  return result;
}

/**
 * Rename the original config directory to a backup path
 * Used during setup to preserve the original config
 */
export function backupOriginalConfig(configPath: string): {
  success: boolean;
  backupPath?: string;
  error?: string;
} {
  if (!fs.existsSync(configPath)) {
    return { success: true }; // Nothing to backup
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${configPath}.backup-${timestamp}`;

  try {
    fs.renameSync(configPath, backupPath);
    return { success: true, backupPath };
  } catch (err) {
    return { success: false, error: `Failed to backup config: ${err}` };
  }
}

/**
 * Restore the original config from backup
 * Used during uninstall to restore the original config
 */
export function restoreOriginalConfig(backupPath: string, targetPath: string): {
  success: boolean;
  error?: string;
} {
  if (!fs.existsSync(backupPath)) {
    return { success: false, error: `Backup path does not exist: ${backupPath}` };
  }

  // If target already exists, remove it first
  if (fs.existsSync(targetPath)) {
    try {
      fs.rmSync(targetPath, { recursive: true });
    } catch (err) {
      return { success: false, error: `Failed to remove existing config: ${err}` };
    }
  }

  try {
    fs.renameSync(backupPath, targetPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to restore config: ${err}` };
  }
}
