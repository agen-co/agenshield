/**
 * Backup utilities for AgenShield installation
 *
 * Saves installation state before migration to enable safe uninstall.
 * Backup is stored in ~/.agenshield/backup.json (root-owned, mode 600).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type {
  InstallationBackup,
  OriginalInstallation,
  SandboxUserInfo,
  MigratedPaths,
} from '@agenshield/ipc';
import { BACKUP_CONFIG, backupConfigPath } from '@agenshield/ipc';
import { sudoExec } from '../exec/sudo.js';

/**
 * Ensure the backup directory exists with proper permissions
 */
function ensureBackupDir(): { success: boolean; error?: string } {
  const backupPath = backupConfigPath();
  const dir = path.dirname(backupPath);

  // Create directory if it doesn't exist
  let result = sudoExec(`mkdir -p "${dir}"`);
  if (!result.success) {
    return { success: false, error: `Failed to create backup dir: ${result.error}` };
  }

  // Set permissions (readable by all, writable by root)
  result = sudoExec(`chmod ${BACKUP_CONFIG.dirMode.toString(8)} "${dir}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set dir permissions: ${result.error}` };
  }

  // Set ownership to root
  result = sudoExec(`chown root:wheel "${dir}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set dir ownership: ${result.error}` };
  }

  return { success: true };
}

/** @deprecated Profile-based uninstall replaces backup.json. Use storage profiles instead. */
export interface SaveBackupParams {
  originalInstallation: OriginalInstallation;
  sandboxUser: SandboxUserInfo;
  migratedPaths: MigratedPaths;
}

/**
 * Save installation backup before migration
 * @deprecated Profile-based uninstall replaces backup.json. Use storage profiles instead.
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
  const resolvedBackupPath = backupConfigPath();
  let result = sudoExec(`mv "${tempPath}" "${resolvedBackupPath}"`);
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
  result = sudoExec(`chmod ${BACKUP_CONFIG.fileMode.toString(8)} "${resolvedBackupPath}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set backup permissions: ${result.error}` };
  }

  // Set ownership to root
  result = sudoExec(`chown root:wheel "${resolvedBackupPath}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set backup ownership: ${result.error}` };
  }

  return { success: true };
}

/**
 * Load installation backup
 * Returns null if no backup exists or if read fails
 * @deprecated Profile-based uninstall replaces backup.json. Use storage profiles instead.
 */
export function loadBackup(): InstallationBackup | null {
  // Try new path first, then legacy path for backward compat
  const newPath = backupConfigPath();
  let result = sudoExec(`cat "${newPath}"`);
  if (!result.success || !result.output) {
    // Fallback to legacy path
    result = sudoExec(`cat "${BACKUP_CONFIG.backupPath}"`);
  }
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
 * @deprecated Profile-based uninstall replaces backup.json. Use storage profiles instead.
 */
export function backupExists(): boolean {
  const newPath = backupConfigPath();
  const result = sudoExec(`test -f "${newPath}" && echo "exists"`);
  if (result.success && result.output === 'exists') return true;
  // Fallback to legacy path
  const legacy = sudoExec(`test -f "${BACKUP_CONFIG.backupPath}" && echo "exists"`);
  return legacy.success && legacy.output === 'exists';
}

/**
 * Delete the backup file (called after successful uninstall)
 * @deprecated Profile-based uninstall replaces backup.json. Use storage profiles instead.
 */
export function deleteBackup(): { success: boolean; error?: string } {
  // Remove from both new and legacy paths
  const newPath = backupConfigPath();
  sudoExec(`rm -f "${newPath}"`);
  sudoExec(`rm -f "${BACKUP_CONFIG.backupPath}"`);
  return { success: true };
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
