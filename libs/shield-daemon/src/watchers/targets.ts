/**
 * Target status watcher
 *
 * Periodically checks target lifecycle status and emits SSE events on change.
 * Follows the same pattern as watchers/security.ts.
 */

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { emitTargetStatus } from '../events/emitter';
import type { TargetStatusInfo } from '@agenshield/ipc';
import { getLogger } from '../logger';

let watcherInterval: NodeJS.Timeout | null = null;
let lastTargetsHash: string | null = null;
let pendingImmediate = false;
let lastTargets: TargetStatusInfo[] = [];

/**
 * Check if an agent user has any running processes.
 * Uses `ps -u <agentUsername>` as the primary signal for target running status.
 * Exported so target-lifecycle.ts can reuse without duplicating.
 */
export function checkProcessesRunning(agentUsername: string): boolean {
  try {
    const output = execSync(
      `ps -u ${agentUsername} -o pid= 2>/dev/null`,
      { encoding: 'utf-8', timeout: 5_000 },
    );
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Get the most recent target statuses from the watcher cache.
 * Used by the metrics collector to avoid re-detecting targets every 2s.
 */
export function getLastTargetStatuses(): TargetStatusInfo[] {
  return lastTargets;
}

/**
 * Build the list of targets with their current status.
 * Reuses the same logic as the GET /targets/lifecycle route.
 */
async function getTargetStatuses(): Promise<TargetStatusInfo[]> {
  try {
    const { detectTargets } = await import('../routes/target-lifecycle.js');
    const { getStorage } = await import('@agenshield/storage');
    const detected = await detectTargets();
    const storage = getStorage();
    const profiles = storage.profiles.getAll();

    const results: TargetStatusInfo[] = detected.map((target) => {
      const matchedProfile = profiles.find((p: { id: string }) => p.id === target.id);
      return {
        id: target.id,
        name: target.name,
        type: target.type,
        shielded: target.shielded,
        running: false,
        version: target.version,
        binaryPath: target.binaryPath,
        gatewayPort: matchedProfile?.gatewayPort,
      };
    });

    // Check running status: primary signal is ps -u <agentUsername>,
    // secondary is launchctl for broker status.
    for (const target of results) {
      if (target.shielded) {
        try {
          const matchedProfile = profiles.find((p: { id: string }) =>
            p.id === target.id,
          );
          const agentUsername = matchedProfile?.agentUsername;

          // Primary check: agent user has running processes
          const processesRunning = agentUsername
            ? checkProcessesRunning(agentUsername)
            : false;

          // Secondary check: launchctl broker status
          const runBaseName = agentUsername?.replace(/^ash_/, '').replace(/_agent$/, '') ?? target.id;
          let brokerRunning = false;
          try {
            const brokerOutput = execSync(
              `launchctl list | grep com.agenshield.broker.${runBaseName} 2>/dev/null || true`,
              { encoding: 'utf-8', timeout: 5_000 },
            );
            brokerRunning = brokerOutput.trim().length > 0;
          } catch {
            // launchctl check failed — rely on process check
          }

          // Target is running if agent user has processes OR broker is registered in launchctl
          target.running = processesRunning || brokerRunning;
        } catch {
          // Can't check — leave as false
        }
      }
    }

    return results;
  } catch (err) {
    getLogger().debug({ err }, 'Target status check failed');
    return [];
  }
}

/**
 * Hash target list for change detection.
 */
function hashTargets(targets: TargetStatusInfo[]): string {
  const json = JSON.stringify(targets.map((t) => ({
    id: t.id, name: t.name, type: t.type, shielded: t.shielded, running: t.running,
    gatewayPort: t.gatewayPort, pid: t.pid,
  })));
  return createHash('md5').update(json).digest('hex');
}

/**
 * Check target status and emit event if changed.
 */
async function checkAndEmit(): Promise<void> {
  try {
    const targets = await getTargetStatuses();
    // Always cache for metrics collector access
    lastTargets = targets;
    const hash = hashTargets(targets);

    if (hash !== lastTargetsHash) {
      emitTargetStatus(targets);
      lastTargetsHash = hash;
    }
  } catch (err) {
    getLogger().debug({ err }, 'Target watcher check failed');
  }
}

/**
 * Start the target status watcher.
 *
 * @param intervalMs - Check interval in milliseconds (default: 10 seconds)
 */
export function startTargetWatcher(intervalMs = 10000): void {
  if (watcherInterval) return; // Already running

  // Initial check
  checkAndEmit();

  watcherInterval = setInterval(checkAndEmit, intervalMs);
  getLogger().info(`Target watcher started (interval: ${intervalMs}ms)`);
}

/**
 * Stop the target watcher.
 */
export function stopTargetWatcher(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
    lastTargetsHash = null;
    getLogger().info('Target watcher stopped');
  }
}

/**
 * Trigger an immediate target status check.
 * Call after shield/unshield/start/stop mutations for instant SSE push.
 */
export function triggerTargetCheck(): void {
  // Debounce rapid fire (e.g. shield + start in quick succession)
  if (pendingImmediate) return;
  pendingImmediate = true;
  // Reset hash so next check always emits
  lastTargetsHash = null;
  setTimeout(() => {
    pendingImmediate = false;
    checkAndEmit();
  }, 500);
}
