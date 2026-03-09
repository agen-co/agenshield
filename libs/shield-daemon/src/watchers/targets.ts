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
import type { AgentProcessInfo, TargetStatusInfo, Profile } from '@agenshield/ipc';
import { getStorage } from '@agenshield/storage';
import { getLogger } from '../logger';
import type { ProcessManager } from '../services/process-manager';
import { getSystemExecutor } from '../workers/system-command';
import { checkClaudeBinaryIntegrity, remediateClaudeBinaryDrift } from './binary-integrity';
import { refreshTrustedHashes, invalidateVerifiedBinaryCache } from '../services/process-enforcer';

/** Cache resolved UIDs to avoid repeated `id -u` lookups. */
const uidCache = new Map<string, number>();

/** Negative UID cache — avoid re-running 3s-timeout command for non-existent users. */
const negativeUidCache = new Map<string, number>(); // username → expiry timestamp
const NEGATIVE_CACHE_TTL = 30_000;

/**
 * Resolve the numeric UID for an agent username.
 * Uses `profile.agentUid` when available, otherwise falls back to `id -u`.
 */
export async function resolveAgentUid(agentUsername: string, profileUid?: number): Promise<number | null> {
  if (profileUid != null) return profileUid;
  const cached = uidCache.get(agentUsername);
  if (cached != null) return cached;

  // Check negative cache — avoid re-running 3s-timeout command
  const negExpiry = negativeUidCache.get(agentUsername);
  if (negExpiry != null && Date.now() < negExpiry) return null;

  try {
    const executor = getSystemExecutor();
    const raw = await executor.exec(`id -u ${agentUsername}`, { timeout: 3_000 });
    const uid = parseInt(raw.trim(), 10);
    if (!isNaN(uid)) {
      uidCache.set(agentUsername, uid);
      negativeUidCache.delete(agentUsername);
      return uid;
    }
  } catch {
    negativeUidCache.set(agentUsername, Date.now() + NEGATIVE_CACHE_TTL);
  }
  return null;
}

/**
 * Clear both positive and negative UID caches.
 * Called on mutations (shield/unshield) so fresh lookups run.
 */
export function clearUidCaches(): void {
  uidCache.clear();
  negativeUidCache.clear();
}

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
 * A snapshot of running processes from `ps -A`.
 * Captured once per status-check cycle and passed to all check functions
 * to avoid redundant `ps -A` calls (each ~100-500ms via worker).
 */
export interface ProcessSnapshot {
  /** Raw output of `ps -A -o uid=,pid=,etime=,command=` */
  raw: string;
}

/**
 * Capture a single `ps -A` snapshot for reuse across check functions.
 */
export async function getProcessSnapshot(): Promise<ProcessSnapshot | null> {
  try {
    const executor = getSystemExecutor();
    const raw = await executor.exec(
      `ps -A -o uid=,pid=,etime=,command= 2>/dev/null`,
      { timeout: 5_000 },
    );
    return { raw };
  } catch {
    return null;
  }
}

/**
 * Parse ps `etime` format into milliseconds.
 * Formats: `DD-HH:MM:SS`, `HH:MM:SS`, `MM:SS`, `SS`
 */
export function parseEtime(etime: string): number {
  const trimmed = etime.trim();
  let days = 0;
  let rest = trimmed;

  // Handle DD- prefix
  const dashIdx = rest.indexOf('-');
  if (dashIdx !== -1) {
    days = parseInt(rest.slice(0, dashIdx), 10) || 0;
    rest = rest.slice(dashIdx + 1);
  }

  const parts = rest.split(':').map((p) => parseInt(p, 10) || 0);
  let hours = 0, minutes = 0, seconds = 0;

  if (parts.length === 3) {
    [hours, minutes, seconds] = parts;
  } else if (parts.length === 2) {
    [minutes, seconds] = parts;
  } else if (parts.length === 1) {
    [seconds] = parts;
  }

  return ((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * Check if an agent user has any running processes.
 * Uses generic `ps -A` with in-process UID filtering to avoid exposing agent
 * usernames in the process table.
 * @deprecated Use type-specific helpers (checkOpenClawRunning / listClaudeProcesses) instead.
 */
export async function checkProcessesRunning(agentUid: number): Promise<boolean> {
  try {
    const executor = getSystemExecutor();
    const output = await executor.exec(
      `ps -A -o uid=,pid= 2>/dev/null`,
      { timeout: 5_000 },
    );
    const uidStr = String(agentUid);
    for (const line of output.trim().split('\n')) {
      const cols = line.trim().split(/\s+/);
      if (cols[0] === uidStr) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check whether an OpenClaw target is actually running.
 *
 * Priority 1: ProcessManager status (in-memory managed processes)
 * Priority 2: launchctl broker plist (direct lookup, no grep)
 * Priority 3: Generic ps with in-process UID filtering (no agent username in command line)
 */
export async function checkOpenClawRunning(
  agentUid: number,
  runBaseName: string,
  processManager?: ProcessManager | null,
  targetId?: string,
  snapshot?: ProcessSnapshot | null,
): Promise<boolean> {
  // Priority 1: ProcessManager
  if (processManager && targetId) {
    const managed = processManager.getStatus(targetId);
    if (managed?.status === 'running') return true;
  }

  const executor = getSystemExecutor();

  // Priority 2: launchctl broker — direct lookup instead of grep to avoid exposing names
  try {
    const brokerOutput = await executor.exec(
      `launchctl list com.agenshield.broker.${runBaseName} 2>/dev/null || true`,
      { timeout: 5_000 },
    );
    // Direct lookup returns multi-line output with PID/status when service exists,
    // or an error message when it doesn't. Check for a PID or "PID" header line.
    const trimmed = brokerOutput.trim();
    if (trimmed.length > 0 && !trimmed.includes('Could not find service')) return true;
  } catch {
    // launchctl check failed
  }

  // Priority 3: Generic process list — filter by UID in-process (reuse snapshot if available)
  try {
    const output = snapshot?.raw ?? await executor.exec(
      `ps -A -o uid=,pid=,etime=,command= 2>/dev/null`,
      { timeout: 5_000 },
    );
    const uidStr = String(agentUid);
    for (const line of output.trim().split('\n')) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      // Parse: UID PID ETIME COMMAND (or UID PID COMM when no snapshot)
      const match = trimmedLine.match(/^\s*(\d+)\s+(\d+)\s+\S+\s+(.+)$/) ??
                    trimmedLine.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      if (!match || match[1] !== uidStr) continue;
      const comm = match[3];
      if (SYSTEM_PROCESS_RE.test(comm)) continue;
      const isOpenclaw = /openclaw/i.test(comm);
      const isNodeGateway = /\bnode\b/i.test(comm) && /gateway/i.test(comm);
      if (isOpenclaw || isNodeGateway) return true;
    }
  } catch {
    // ps failed
  }

  return false;
}

/**
 * List active `claude` CLI sessions running under the agent user.
 * Uses generic `ps -A` with in-process UID filtering to avoid exposing
 * agent usernames in the process table.
 */
export async function listClaudeProcesses(agentUid: number, snapshot?: ProcessSnapshot | null): Promise<AgentProcessInfo[]> {
  const results: AgentProcessInfo[] = [];
  try {
    const output = snapshot?.raw ?? await (async () => {
      const executor = getSystemExecutor();
      return executor.exec(
        `ps -A -o uid=,pid=,etime=,command= 2>/dev/null`,
        { timeout: 5_000 },
      );
    })();
    const uidStr = String(agentUid);
    for (const line of output.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Parse: UID PID ELAPSED COMMAND...
      const match = trimmed.match(/^\s*(\d+)\s+(\d+)\s+([\d:.-]+)\s+(.+)$/);
      if (!match || match[1] !== uidStr) continue;

      const command = match[4];
      if (SYSTEM_PROCESS_RE.test(command)) continue;
      if (!/claude/i.test(command)) continue;

      results.push({
        pid: parseInt(match[2], 10),
        elapsed: match[3],
        command,
        startedAtMs: Date.now() - parseEtime(match[3]),
      });
    }
  } catch {
    // ps failed — return empty
  }
  return results;
}

/**
 * List active OpenClaw gateway processes running under the agent user.
 * Uses generic `ps -A` with in-process UID filtering to avoid exposing
 * agent usernames in the process table.
 */
export async function listOpenClawProcesses(agentUid: number, snapshot?: ProcessSnapshot | null): Promise<AgentProcessInfo[]> {
  const results: AgentProcessInfo[] = [];
  try {
    const output = snapshot?.raw ?? await (async () => {
      const executor = getSystemExecutor();
      return executor.exec(
        `ps -A -o uid=,pid=,etime=,command= 2>/dev/null`,
        { timeout: 5_000 },
      );
    })();
    const uidStr = String(agentUid);
    for (const line of output.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Parse: UID PID ELAPSED COMMAND...
      const match = trimmed.match(/^\s*(\d+)\s+(\d+)\s+([\d:.-]+)\s+(.+)$/);
      if (!match || match[1] !== uidStr) continue;

      const command = match[4];
      if (SYSTEM_PROCESS_RE.test(command)) continue;
      if (/guarded-shell/i.test(command)) continue;

      const isOpenclaw = /openclaw/i.test(command);
      const isNodeGateway = /\bnode\b/i.test(command) && /gateway/i.test(command);
      if (!isOpenclaw && !isNodeGateway) continue;

      results.push({
        pid: parseInt(match[2], 10),
        elapsed: match[3],
        command,
        startedAtMs: Date.now() - parseEtime(match[3]),
      });
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
    // Capture a single process snapshot and run all checks in parallel.
    const snapshot = await getProcessSnapshot();
    const shieldedTargets = results.filter(t => t.shielded);

    await Promise.allSettled(shieldedTargets.map(async (target) => {
      try {
        const matchedProfile = profiles.find((p: { id: string }) => p.id === target.id);
        const agentUsername = matchedProfile?.agentUsername;
        if (!agentUsername) return;

        const agentUid = await resolveAgentUid(agentUsername, (matchedProfile as { agentUid?: number }).agentUid);
        if (agentUid == null) return;

        const runBaseName = agentUsername.replace(/^ash_/, '').replace(/_agent$/, '');

        if (target.type === 'openclaw') {
          target.running = await checkOpenClawRunning(
            agentUid,
            runBaseName,
            _processManager,
            target.id,
            snapshot,
          );
          target.processes = await listOpenClawProcesses(agentUid, snapshot);
        } else if (target.type === 'claude-code') {
          const procs = await listClaudeProcesses(agentUid, snapshot);
          target.running = procs.length > 0;
          target.processes = procs;

          // Check binary integrity and auto-remediate drift
          if (matchedProfile) {
            try {
              const integrity = checkClaudeBinaryIntegrity(matchedProfile as Profile);
              if (integrity?.drifted) {
                target.binaryDrifted = true;
                // Fire-and-forget: remediation runs asynchronously
                remediateClaudeBinaryDrift(matchedProfile as Profile, integrity).then((success) => {
                  if (success) {
                    refreshTrustedHashes();
                    invalidateVerifiedBinaryCache();
                  }
                }).catch((err) => {
                  getLogger().debug({ err, targetId: target.id }, 'Binary drift remediation failed');
                });
              }
            } catch (err) {
              getLogger().debug({ err, targetId: target.id }, 'Binary integrity check failed');
            }
          }
        } else {
          // Fallback: launchctl broker check only (direct lookup, no grep)
          try {
            const executor = getSystemExecutor();
            const brokerOutput = await executor.exec(
              `launchctl list com.agenshield.broker.${runBaseName} 2>/dev/null || true`,
              { timeout: 5_000 },
            );
            const trimmed = brokerOutput.trim();
            target.running = trimmed.length > 0 && !trimmed.includes('Could not find service');
          } catch {
            // leave as false
          }
        }
      } catch {
        // Can't check — leave as false
      }
    }));

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
    gatewayPort: t.gatewayPort, pid: t.pid, binaryDrifted: t.binaryDrifted,
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
  // Clear UID caches so mutations get fresh lookups
  clearUidCaches();
  // Reset hash so next check always emits
  lastTargetsHash = null;
  setTimeout(() => {
    pendingImmediate = false;
    checkAndEmit();
  }, 500);
}
