/**
 * Activation service
 *
 * Tracks whether the daemon's monitoring services are active.
 * When the daemon boots without a completed setup, it enters "standby" mode
 * and defers heavy watchers/enforcers until setup completes.
 */

import { getLogger } from '../logger';

export type ActivationState = 'standby' | 'active';

export class ActivationService {
  private state: ActivationState = 'standby';
  private activateCallback: (() => Promise<void>) | null = null;

  getState(): ActivationState {
    return this.state;
  }

  isActive(): boolean {
    return this.state === 'active';
  }

  /**
   * Mark as active without running the callback (used when services
   * were started immediately at boot).
   */
  markActive(): void {
    this.state = 'active';
  }

  /**
   * Register a callback to run when activate() is called.
   * The callback should start monitoring services.
   */
  setActivateCallback(cb: () => Promise<void>): void {
    this.activateCallback = cb;
  }

  /**
   * Transition from standby to active, running the deferred callback.
   * Idempotent — calling activate() when already active is a no-op.
   */
  async activate(): Promise<void> {
    if (this.state === 'active') return;

    const log = getLogger();
    log.info('[activation] Activating monitoring services...');

    this.state = 'active';

    if (this.activateCallback) {
      await this.activateCallback();
      this.activateCallback = null;
    }

    log.info('[activation] Monitoring services active');
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let activationService: ActivationService | null = null;

export function getActivationService(): ActivationService {
  if (!activationService) {
    activationService = new ActivationService();
  }
  return activationService;
}
