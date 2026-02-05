/**
 * Security status watcher
 *
 * Periodically checks security status and emits events when it changes.
 */

import { checkSecurityStatus, type SecurityStatus } from '@agenshield/sandbox';
import { emitSecurityStatus, emitSecurityWarning, emitSecurityCritical } from '../events/emitter';

let lastStatus: SecurityStatus | null = null;
let watcherInterval: NodeJS.Timeout | null = null;

/**
 * Compare two security statuses for changes
 */
function hasStatusChanged(prev: SecurityStatus | null, current: SecurityStatus): boolean {
  if (!prev) return true;

  return (
    prev.level !== current.level ||
    prev.sandboxUserExists !== current.sandboxUserExists ||
    prev.isIsolated !== current.isIsolated ||
    prev.runningAsRoot !== current.runningAsRoot ||
    prev.exposedSecrets.length !== current.exposedSecrets.length ||
    prev.warnings.length !== current.warnings.length ||
    prev.critical.length !== current.critical.length
  );
}

/**
 * Check security status and emit events if changed
 */
function checkAndEmit(): void {
  try {
    const status = checkSecurityStatus();

    // Merge secret names detected in the calling user's environment
    const userSecrets = process.env['AGENSHIELD_USER_SECRETS'];
    if (userSecrets) {
      for (const name of userSecrets.split(',').filter(Boolean)) {
        if (!status.exposedSecrets.includes(name)) {
          status.exposedSecrets.push(name);
        }
      }
    }

    if (hasStatusChanged(lastStatus, status)) {
      // Emit full status update
      emitSecurityStatus(status);

      // Emit individual critical issues
      for (const issue of status.critical) {
        if (!lastStatus?.critical.includes(issue)) {
          emitSecurityCritical(issue);
        }
      }

      // Emit individual warnings
      for (const warning of status.warnings) {
        if (!lastStatus?.warnings.includes(warning)) {
          emitSecurityWarning(warning);
        }
      }

      lastStatus = status;
    }
  } catch (error) {
    console.error('Error checking security status:', error);
  }
}

/**
 * Start the security watcher
 *
 * @param intervalMs - Check interval in milliseconds (default: 10 seconds)
 */
export function startSecurityWatcher(intervalMs = 10000): void {
  if (watcherInterval) {
    return; // Already running
  }

  // Initial check
  checkAndEmit();

  // Start periodic checks
  watcherInterval = setInterval(checkAndEmit, intervalMs);

  console.log(`Security watcher started (interval: ${intervalMs}ms)`);
}

/**
 * Stop the security watcher
 */
export function stopSecurityWatcher(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
    console.log('Security watcher stopped');
  }
}

/**
 * Force an immediate security check
 */
export function triggerSecurityCheck(): void {
  checkAndEmit();
}
