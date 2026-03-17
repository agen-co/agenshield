/**
 * Setup service
 *
 * Singleton that manages the daemon's setup state (local / cloud).
 * Reads/writes ~/.agenshield/setup.json — the same file the CLI writes.
 * Provides HTTP-friendly methods so both CLI and macOS app can drive setup
 * through daemon endpoints.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { signAdminToken } from '@agenshield/auth';
import { isCloudEnrolled, loadCloudCredentials } from '@agenshield/cloud';
import type { SetupStatus, SetupFlowState, SetupMode } from '@agenshield/ipc';
import { getConfigDir } from '../config/paths';
import { getLogger } from '../logger';
import { getEnrollmentService } from './enrollment';

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

interface SetupFile {
  mode: SetupMode;
  completedAt: string;
  cloudUrl?: string;
}

function getSetupFilePath(): string {
  return path.join(getConfigDir(), 'setup.json');
}

function readSetupFile(): SetupFile | null {
  try {
    const raw = fs.readFileSync(getSetupFilePath(), 'utf-8');
    const data = JSON.parse(raw) as SetupFile;
    if (typeof data.completedAt !== 'string' || typeof data.mode !== 'string') {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function writeSetupFile(state: SetupFile): void {
  const filePath = getSetupFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', { mode: 0o644 });
  fs.renameSync(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// SetupService
// ---------------------------------------------------------------------------

export class SetupService {
  /**
   * Get the current setup status.
   */
  getStatus(): SetupStatus {
    const file = readSetupFile();
    if (!file) {
      // Check if cloud enrollment exists without setup file (e.g. MDM)
      if (isCloudEnrolled()) {
        const creds = loadCloudCredentials();
        return {
          state: 'complete' as SetupFlowState,
          mode: 'cloud',
          cloudUrl: creds?.cloudUrl,
        };
      }
      return { state: 'not-configured' as SetupFlowState };
    }

    return {
      state: 'complete' as SetupFlowState,
      mode: file.mode,
      cloudUrl: file.cloudUrl,
      completedAt: file.completedAt,
    };
  }

  /**
   * Set up in local mode. Writes setup.json and returns the admin token.
   */
  async setupLocal(): Promise<{ adminToken: string }> {
    const log = getLogger();
    log.info('[setup] Setting up in local mode');

    const adminToken = await signAdminToken();

    writeSetupFile({
      mode: 'local',
      completedAt: new Date().toISOString(),
    });

    log.info('[setup] Local setup complete');

    // Activate monitoring services if daemon was in standby
    try {
      const { getActivationService } = await import('./activation');
      await getActivationService().activate();
    } catch { /* best effort */ }

    return { adminToken };
  }

  /**
   * Start cloud setup. Marks state as pending and delegates to EnrollmentService.
   * The enrollment flow is async — caller should poll GET /setup/status.
   */
  async setupCloud(cloudUrl: string): Promise<void> {
    const log = getLogger();
    log.info(`[setup] Starting cloud setup (url: ${cloudUrl})`);

    const enrollment = getEnrollmentService();
    await enrollment.startCloudEnrollment(cloudUrl);
  }

  /**
   * Called by EnrollmentService when enrollment completes successfully.
   * Writes the final setup.json with cloud mode.
   */
  finalizeCloudSetup(cloudUrl: string): void {
    const log = getLogger();
    log.info('[setup] Finalizing cloud setup');

    writeSetupFile({
      mode: 'cloud',
      cloudUrl,
      completedAt: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let setupService: SetupService | null = null;

export function getSetupService(): SetupService {
  if (!setupService) {
    setupService = new SetupService();
  }
  return setupService;
}
