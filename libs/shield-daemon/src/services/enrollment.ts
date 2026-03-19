/**
 * Enrollment service
 *
 * Thin wrapper around EnrollmentProtocol from @agenshield/cloud.
 * Provides daemon-specific callbacks: event emission, setup finalization,
 * activation, cloud connect, and auto-shield.
 *
 * Singleton pattern — same as CloudConnector.
 */

import { EnrollmentProtocol } from '@agenshield/cloud';
import type { EnrollmentState, EnrollmentCallbacks } from '@agenshield/cloud';
import { getLogger } from '../logger';
import { emitEvent } from '../events/emitter';
import { getCloudConnector } from './cloud-connector';
import { VERSION } from '../config/defaults';

export type { EnrollmentState };

export class EnrollmentService {
  private protocol: EnrollmentProtocol;

  constructor() {
    const log = getLogger();

    const callbacks: EnrollmentCallbacks = {
      onPending(info) {
        emitEvent('enrollment:pending', info);
      },

      onComplete(info) {
        emitEvent('enrollment:complete', info);
      },

      onFailed(info) {
        emitEvent('enrollment:failed', info);
      },

      getAgentVersion() {
        return VERSION;
      },

      async onEnrolled(info) {
        // Finalize setup state (best effort)
        try {
          const { getSetupService } = await import('./setup');
          getSetupService().finalizeCloudSetup(info.cloudUrl);
        } catch { /* best effort */ }

        // Activate monitoring services if daemon was in standby
        try {
          const { getActivationService } = await import('./activation');
          await getActivationService().activate();
        } catch (activationErr) {
          log.warn({ err: activationErr }, '[enrollment] Failed to activate monitoring services');
        }

        // Connect to cloud and pull managed policies
        try {
          await getCloudConnector().connect();
          await getCloudConnector().pullPoliciesWithRetry();
        } catch (err) {
          log.warn({ err }, '[enrollment] Post-enrollment cloud connect/policy-pull failed');
        }

        // Trigger auto-shield after enrollment (force=true bypasses isEnabled + isCompleted
        // checks, matching the behavior of POST /enrollment/register and launch-gate routes)
        try {
          const { getAutoShieldService } = await import('./auto-shield');
          getAutoShieldService().run({ force: true }).catch((autoShieldErr) => {
            log.warn({ err: autoShieldErr }, '[enrollment] Auto-shield failed');
          });
        } catch { /* module not available */ }
      },
    };

    this.protocol = new EnrollmentProtocol(callbacks, log);
  }

  /**
   * Get the current enrollment state.
   */
  getState(): EnrollmentState {
    return this.protocol.getState();
  }

  /**
   * Check conditions and start enrollment if needed.
   * Called at daemon boot — runs asynchronously.
   */
  async checkAndEnroll(): Promise<void> {
    return this.protocol.checkAndEnroll();
  }

  /**
   * Start cloud enrollment from an HTTP request (setup API).
   */
  async startCloudEnrollment(cloudUrl: string): Promise<void> {
    return this.protocol.startCloudEnrollment(cloudUrl);
  }

  /**
   * Stop the enrollment service and clean up timers.
   */
  stop(): void {
    this.protocol.stop();
  }
}

// Singleton
let enrollmentService: EnrollmentService | null = null;

export function getEnrollmentService(): EnrollmentService {
  if (!enrollmentService) {
    enrollmentService = new EnrollmentService();
  }
  return enrollmentService;
}
