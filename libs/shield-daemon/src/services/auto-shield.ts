/**
 * Auto-shield service
 *
 * Automatically shields detected unshielded targets after enrollment completes.
 * Triggered by CLI --auto-shield flag (writes intent file) or cloud autoShield policy flag.
 *
 * Singleton pattern — same as EnrollmentService.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { DetectedTarget } from '@agenshield/ipc';
import { getLogger } from '../logger';
import { emitEvent } from '../events/emitter';
import { getConfigDir } from '../config/paths';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutoShieldState =
  | { state: 'idle' }
  | { state: 'pending' }
  | { state: 'in_progress'; progress: { current: number; total: number; currentTarget?: string } }
  | { state: 'complete'; result: { shielded: number; failed: number; skipped: number } }
  | { state: 'failed'; error: string; result?: { shielded: number; failed: number; skipped: number } };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_SHIELD_FILE = 'auto-shield.json';

// ---------------------------------------------------------------------------
// AutoShieldService
// ---------------------------------------------------------------------------

export class AutoShieldService {
  private currentState: AutoShieldState = { state: 'idle' };
  private app: FastifyInstance | null = null;

  /**
   * Bind the Fastify app instance (needed for app.inject()).
   */
  setApp(app: FastifyInstance): void {
    this.app = app;
  }

  /**
   * Get the current auto-shield state.
   */
  getState(): AutoShieldState {
    return this.currentState;
  }

  /**
   * Check if auto-shield is enabled via local file or cloud flag.
   */
  isEnabled(): boolean {
    // Check cloud flag
    try {
      // Dynamic import to avoid circular deps at module load
       
      const { getCloudConnector } = require('./cloud-connector') as { getCloudConnector: () => { getAutoShieldFlag(): boolean | undefined } };
      const cloudFlag = getCloudConnector().getAutoShieldFlag();
      if (cloudFlag === true) return true;
    } catch { /* cloud connector not available */ }

    // Check local intent file
    return this.readLocalConfig()?.enabled === true;
  }

  /**
   * Check if auto-shield has already completed.
   */
  isCompleted(): boolean {
    return this.readLocalConfig()?.completed === true;
  }

  /**
   * Main entry point — run auto-shield if enabled and not yet completed.
   * Idempotent: no-ops if already in progress or completed.
   */
  async run(): Promise<void> {
    // Guard: already running or completed
    if (this.currentState.state === 'in_progress') return;
    if (this.isCompleted()) return;
    if (!this.isEnabled()) return;

    const log = getLogger();

    if (!this.app) {
      log.warn('[auto-shield] No app instance bound — skipping');
      return;
    }

    this.currentState = { state: 'pending' };

    try {
      // Detect targets
      const { invalidateDetectionCache, detectTargets } = await import('../routes/target-lifecycle');
      invalidateDetectionCache();
      const allTargets = await detectTargets();
      const unshielded = allTargets.filter((t: DetectedTarget) => !t.shielded);

      if (unshielded.length === 0) {
        log.info('[auto-shield] No unshielded targets found');
        const result = { shielded: 0, failed: 0, skipped: 0 };
        this.currentState = { state: 'complete', result };
        this.writeCompletion(result);
        emitEvent('auto-shield:complete', result);
        return;
      }

      log.info(`[auto-shield] Starting auto-shield for ${unshielded.length} target(s)`);

      emitEvent('auto-shield:started', {
        total: unshielded.length,
        targetIds: unshielded.map((t: DetectedTarget) => t.id),
      });

      let shielded = 0;
      let failed = 0;

      // Shield each target sequentially
      for (let i = 0; i < unshielded.length; i++) {
        const target = unshielded[i];
        const current = i + 1;

        this.currentState = {
          state: 'in_progress',
          progress: { current, total: unshielded.length, currentTarget: target.name },
        };

        emitEvent('auto-shield:target_started', {
          targetId: target.id,
          targetName: target.name,
          current,
          total: unshielded.length,
        });

        try {
          const res = await this.app.inject({
            method: 'POST',
            url: `/targets/lifecycle/${target.id}/shield`,
            payload: { enforcementMode: 'both' },
          });

          if (res.statusCode >= 200 && res.statusCode < 300) {
            shielded++;
            log.info(`[auto-shield] Shielded ${target.name} (${current}/${unshielded.length})`);
            emitEvent('auto-shield:target_complete', {
              targetId: target.id,
              targetName: target.name,
              current,
              total: unshielded.length,
            });
          } else {
            const body = JSON.parse(res.payload) as { error?: { message?: string } };
            const errMsg = body.error?.message ?? `HTTP ${res.statusCode}`;
            throw new Error(errMsg);
          }
        } catch (err) {
          failed++;
          const errorMessage = (err as Error).message;
          log.warn(`[auto-shield] Failed to shield ${target.name}: ${errorMessage}`);
          emitEvent('auto-shield:target_failed', {
            targetId: target.id,
            targetName: target.name,
            error: errorMessage,
            current,
            total: unshielded.length,
          });
        }
      }

      const result = { shielded, failed, skipped: 0 };

      if (failed > 0 && shielded === 0) {
        this.currentState = { state: 'failed', error: `All ${failed} target(s) failed`, result };
      } else {
        this.currentState = { state: 'complete', result };
      }

      this.writeCompletion(result);

      emitEvent('auto-shield:complete', result);

      log.info(`[auto-shield] Complete — shielded: ${shielded}, failed: ${failed}`);

    } catch (err) {
      const errorMessage = (err as Error).message;
      log.error({ err }, '[auto-shield] Auto-shield failed');
      this.currentState = { state: 'failed', error: errorMessage };
    }
  }

  // ─── Internal ─────────────────────────────────────────────

  private getFilePath(): string {
    return path.join(getConfigDir(), AUTO_SHIELD_FILE);
  }

  private readLocalConfig(): { enabled?: boolean; completed?: boolean; completedAt?: string } | null {
    try {
      const raw = fs.readFileSync(this.getFilePath(), 'utf-8');
      return JSON.parse(raw) as { enabled?: boolean; completed?: boolean; completedAt?: string };
    } catch {
      return null;
    }
  }

  private writeCompletion(result: { shielded: number; failed: number; skipped: number }): void {
    try {
      const existing = this.readLocalConfig() ?? {};
      const data = {
        ...existing,
        completed: true,
        completedAt: new Date().toISOString(),
        result,
      };
      fs.writeFileSync(this.getFilePath(), JSON.stringify(data, null, 2) + '\n', { mode: 0o644 });
    } catch {
      // Best effort — don't fail the service
    }
  }
}

// Singleton
let autoShieldService: AutoShieldService | null = null;

export function getAutoShieldService(): AutoShieldService {
  if (!autoShieldService) {
    autoShieldService = new AutoShieldService();
  }
  return autoShieldService;
}
