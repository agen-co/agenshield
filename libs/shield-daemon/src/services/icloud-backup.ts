/**
 * iCloud Backup Service
 *
 * Manages backup and restore of AgenShield data via iCloud Drive.
 * Delegates to the Swift KeychainHelper binary for actual iCloud operations.
 * macOS only — noop on other platforms.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ICloudBackupConfig } from '@agenshield/ipc';

/** Default backup config */
export const DEFAULT_ICLOUD_CONFIG: ICloudBackupConfig = {
  enabled: false,
  intervalHours: 24,
};

interface ICloudHelperResponse {
  success: boolean;
  error?: string;
  backupFound?: boolean;
  backupPath?: string;
  backupDate?: string;
  files?: string[];
}

/** Known locations for the helper binary */
function findHelperBinary(): string | null {
  const searchPaths = [
    path.join(os.homedir(), '.agenshield', 'bin', 'agenshield-keychain'),
    path.join(path.dirname(process.execPath), '..', 'libexec', 'agenshield-keychain'),
    path.join(path.dirname(process.execPath), 'agenshield-keychain'),
  ];

  for (const p of searchPaths) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      continue;
    }
  }
  return null;
}

function callHelper(request: Record<string, unknown>): ICloudHelperResponse {
  const helperPath = findHelperBinary();
  if (!helperPath) {
    return { success: false, error: 'KeychainHelper binary not found' };
  }

  try {
    const input = JSON.stringify(request);
    const output = execFileSync(helperPath, [], {
      input,
      encoding: 'utf-8',
      timeout: 60_000, // iCloud operations may take longer
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(output.trim()) as ICloudHelperResponse;
  } catch (err) {
    return { success: false, error: `Helper failed: ${(err as Error).message}` };
  }
}

/**
 * Detect if an iCloud backup exists.
 * Returns backup info if found, or { backupFound: false } if not.
 */
export function detectICloudBackup(): ICloudHelperResponse {
  if (process.platform !== 'darwin') {
    return { success: true, backupFound: false };
  }
  return callHelper({ command: 'icloud-detect' });
}

/**
 * Perform an iCloud backup of the AgenShield data directory.
 */
export function performICloudBackup(excludePatterns?: string[]): ICloudHelperResponse {
  if (process.platform !== 'darwin') {
    return { success: false, error: 'iCloud backup is only available on macOS' };
  }

  const dataDir = path.join(os.homedir(), '.agenshield');
  return callHelper({
    command: 'icloud-backup',
    sourcePath: dataDir,
    excludePatterns: excludePatterns ?? [],
  });
}

/**
 * Restore AgenShield data from iCloud backup.
 */
export function restoreFromICloud(): ICloudHelperResponse {
  if (process.platform !== 'darwin') {
    return { success: false, error: 'iCloud restore is only available on macOS' };
  }

  const dataDir = path.join(os.homedir(), '.agenshield');
  return callHelper({
    command: 'icloud-restore',
    destPath: dataDir,
  });
}

// ─── Periodic backup scheduler ──────────────────────────────────────────────

let backupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic iCloud backup if enabled.
 */
export function startICloudBackupScheduler(config: ICloudBackupConfig): void {
  stopICloudBackupScheduler();

  if (!config.enabled || process.platform !== 'darwin') return;

  const intervalMs = (config.intervalHours || 24) * 60 * 60 * 1000;

  backupTimer = setInterval(() => {
    try {
      performICloudBackup();
    } catch (err) {
      console.warn(`[icloud] Periodic backup failed: ${(err as Error).message}`);
    }
  }, intervalMs);

  // Don't prevent process exit
  backupTimer.unref();
}

/**
 * Stop the periodic backup scheduler.
 */
export function stopICloudBackupScheduler(): void {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}
