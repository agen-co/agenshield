/**
 * Target status watcher
 *
 * Periodically checks target lifecycle status and emits SSE events on change.
 * Follows the same pattern as watchers/security.ts.
 *
 * All system commands are offloaded to the worker thread via
 * SystemCommandExecutor to avoid blocking the event loop.
 */

import { createHash } from 'node:crypto';
import { emitTargetStatus, registerProfilePreset } from '../events/emitter';
import type { AgentProcessInfo, TargetStatusInfo } from '@agenshield/ipc';
import { getLogger } from '../logger';
import type { ProcessManager } from '../services/process-manager';
import { getSystemExecutor } from '../workers/system-command';

let watcherInterval: NodeJS.Timeout | null = null;
let lastTargetsHash: string | null = null;
let pendingImmediate = false;
let lastTargets: TargetStatusInfo[] = [];

/** Cached reference to the ProcessManager singleton. */
let _processManager: ProcessManager | null = null;

/**
 * Wire the ProcessManager so the watcher can check managed process status.
 */
export function setProcessManager(pm: ProcessManager): void {
  _processManager = pm;
}

// macOS system daemons that always exist for every user — never treat as target processes.
const SYSTEM_PROCESS_RE = /\b(cfprefsd|lsd|trustd|diskarbitrationd|secinitd|tccd|nsurlsessiond|mdworker|distnoted|smd|pboard)\b/i;

/**
 * Check if an agent user has any running processes.
 * Uses `ps -U <agentUsername>` as the primary signal for target running status.
 * @deprecated Use type-specific helpers (checkOpenClawRunning / listClaudeProcesses) instead.
 */
export async function checkProcessesRunning(agentUsername: string): Promise<boolean> {
  try {
    const executor = getSystemExecutor();
    const output = await executor.exec(
      `ps -U ${agentUsername} -ax -o pid= 2>/dev/null`,
      { timeout: 5_000 },
    );
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Check whether an OpenClaw target is actually running.
 *
 * Priority 1: ProcessManager status (in-memory managed processes)
 * Priority 2: launchctl broker plist
 * Priority 3: Filtered ps for openclaw/node processes (excludes macOS system daemons)
 */
export async function checkOpenClawRunning(
  agentUsername: string,
  runBaseName: string,
  processManager?: ProcessManager | null,
  targetId?: string,
): Promise<boolean> {
  // Priority 1: ProcessManager
  if (processManager && targetId) {
    const managed = processManager.getStatus(targetId);
    if (managed?.status === 'running') return true;
  }

  const executor = getSystemExecutor();

  // Priority 2: launchctl broker
  try {
    const brokerOutput = await executor.exec(
      `launchctl list | grep com.agenshield.broker.${runBaseName} 2>/dev/null || true`,
      { timeout: 5_000 },
    );
    if (brokerOutput.trim().length > 0) return true;
  } catch {
    // launchctl check failed
  }

  // Priority 3: Filtered process list — look for openclaw or node gateway processes
  try {
    const output = await executor.exec(
      `ps -U ${agentUsername} -ax -o pid,comm= 2>/dev/null`,
      { timeout: 5_000 },
    );
    for (const line of output.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (SYSTEM_PROCESS_RE.test(trimmed)) continue;
      // Match openclaw binary or node running gateway commands
      if (/openclaw|node/i.test(trimmed)) return true;
    }
  } catch {
    // ps failed
  }

  return false;
}

/**
 * List active `claude` CLI sessions running under the agent user.
 * Returns process info for each matching session.
 */
export async function listClaudeProcesses(agentUsername: string): Promise<AgentProcessInfo[]> {
  const results: AgentProcessInfo[] = [];
  try {
    const executor = getSystemExecutor();
    const output = await executor.exec(
      `ps -U ${agentUsername} -ax -o pid,etime,command= 2>/dev/null`,
      { timeout: 5_000 },
    );
    for (const line of output.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (SYSTEM_PROCESS_RE.test(trimmed)) continue;
      if (!/claude/i.test(trimmed)) continue;

      // Parse: PID ELAPSED COMMAND...
      const match = trimmed.match(/^\s*(\d+)\s+([\d:.-]+)\s+(.+)$/);
      if (match) {
        results.push({
          pid: parseInt(match[1], 10),
          elapsed: match[2],
          command: match[3],
        });
      }
    }
  } catch {
    // ps failed — return empty
  }
  return results;
}

/**
 * List active OpenClaw gateway processes running under the agent user.
 * Follows the same pattern as `listClaudeProcesses()` but filters for
 * openclaw/node processes, excluding guarded-shell wrappers and system daemons.
 */
export async function listOpenClawProcesses(agentUsername: string): Promise<AgentProcessInfo[]> {
  const results: AgentProcessInfo[] = [];
  try {
    const executor = getSystemExecutor();
    const output = await executor.exec(
      `ps -U ${agentUsername} -ax -o pid,etime,command= 2>/dev/null`,
      { timeout: 5_000 },
    );
    for (const line of output.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (SYSTEM_PROCESS_RE.test(trimmed)) continue;
      // Skip guarded-shell wrappers — we want actual openclaw/node processes
      if (/guarded-shell/i.test(trimmed)) continue;
      // Match openclaw binary or node running gateway/openclaw commands
      if (!/openclaw|node/i.test(trimmed)) continue;

      const match = trimmed.match(/^\s*(\d+)\s+([\d:.-]+)\s+(.+)$/);
      if (match) {
        results.push({
          pid: parseInt(match[1], 10),
          elapsed: match[2],
          command: match[3],
        });
      }
    }
  } catch {
    // ps failed — return empty
  }
  return results;
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

    // Register profile → preset mappings for event source attribution
    for (const p of profiles) {
      if ((p as { presetId?: string }).presetId) {
        registerProfilePreset(p.id, (p as { presetId?: string }).presetId as string);
      }
    }

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

    // Check running status using type-specific detection.
    for (const target of results) {
      if (!target.shielded) continue;

      try {
        const matchedProfile = profiles.find((p: { id: string }) => p.id === target.id);
        const agentUsername = matchedProfile?.agentUsername;
        if (!agentUsername) continue;

        const runBaseName = agentUsername.replace(/^ash_/, '').replace(/_agent$/, '');

        if (target.type === 'openclaw') {
          target.running = await checkOpenClawRunning(
            agentUsername,
            runBaseName,
            _processManager,
            target.id,
          );
          target.processes = await listOpenClawProcesses(agentUsername);
        } else if (target.type === 'claude-code') {
          const procs = await listClaudeProcesses(agentUsername);
          target.running = procs.length > 0;
          target.processes = procs;
        } else {
          // Fallback: launchctl broker check only
          try {
            const executor = getSystemExecutor();
            const brokerOutput = await executor.exec(
              `launchctl list | grep com.agenshield.broker.${runBaseName} 2>/dev/null || true`,
              { timeout: 5_000 },
            );
            target.running = brokerOutput.trim().length > 0;
          } catch {
            // leave as false
          }
        }
      } catch {
        // Can't check — leave as false
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
 * Includes process PIDs (not elapsed time) to avoid hash thrashing.
 */
function hashTargets(targets: TargetStatusInfo[]): string {
  const json = JSON.stringify(targets.map((t) => ({
    id: t.id, name: t.name, type: t.type, shielded: t.shielded, running: t.running,
    gatewayPort: t.gatewayPort, pid: t.pid,
    processPids: t.processes?.map((p) => p.pid).sort(),
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
