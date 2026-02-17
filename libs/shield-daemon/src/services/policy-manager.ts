/**
 * PolicyManager singleton for the daemon.
 *
 * Initialized during startDaemonServices(), provides centralized
 * policy evaluation, matching, and secret sync.
 */

import type { Storage } from '@agenshield/storage';
import { PolicyManager } from '@agenshield/policies';
import type { PolicyManagerOptions } from '@agenshield/policies';

let manager: PolicyManager | null = null;

/**
 * Initialize the global PolicyManager singleton.
 */
export function initPolicyManager(storage: Storage, options?: PolicyManagerOptions): PolicyManager {
  manager = new PolicyManager(storage, options);
  return manager;
}

/**
 * Get the global PolicyManager singleton. Throws if not initialized.
 */
export function getPolicyManager(): PolicyManager {
  if (!manager) {
    throw new Error('PolicyManager not initialized. Call initPolicyManager() first.');
  }
  return manager;
}

/**
 * Check if PolicyManager has been initialized.
 */
export function hasPolicyManager(): boolean {
  return manager !== null;
}
