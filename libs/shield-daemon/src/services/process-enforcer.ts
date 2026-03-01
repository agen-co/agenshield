/**
 * Process Enforcer Service
 *
 * Scans running host-user processes and enforces process-target policies.
 * When a deny-policy matches a running process, the enforcer either alerts
 * (emits an event) or kills the process tree, depending on the policy's
 * enforcement mode.
 *
 * System commands are offloaded to the worker thread via SystemCommandExecutor
 * to avoid blocking the event loop.
 *
 * Performance optimisations:
 * - Delta scanning: only evaluates newly-appeared PIDs each cycle
 * - Non-blocking kill: SIGTERM is fire-and-forget; SIGKILL scheduled via unref'd timer
 * - Cached daemon descendants: pgrep result cached with 10s TTL
 */

import os from 'node:os';
import { getLogger } from '../logger';
import { getPolicyManager } from './policy-manager';
import { emitProcessViolation, emitProcessKilled } from '../events/emitter';
import { getSystemExecutor } from '../workers/system-command';
import { getActiveShieldOperations } from './shield-registry';
import { getStorage } from '@agenshield/storage';
import { isShieldedProcess } from '@agenshield/policies';
import { fingerprintProcess } from './process-fingerprint';
import type { ProcessFingerprint } from './process-fingerprint';

// macOS system daemons — never enforce against these
const SYSTEM_PROCESS_RE = /\b(cfprefsd|lsd|trustd|diskarbitrationd|secinitd|tccd|nsurlsessiond|mdworker|distnoted|smd|pboard|launchd|kernel_task|WindowServer|loginwindow)\b/i;

const GRACE_PERIOD_MS = 5_000;

export interface HostProcess {
  pid: number;
  user: string;
  command: string;
}

// ─── State ───────────────────────────────────────────────────

let scanTimer: NodeJS.Timeout | null = null;
let currentIntervalMs = 0;
/** PIDs recently killed — tracked to avoid re-scanning dead processes */
const recentlyKilledPids = new Set<number>();
let recentlyKilledCleanupTimer: NodeJS.Timeout | null = null;

/** Delta scanning: tracks previously-evaluated PIDs and their verdict */
const knownPids = new Map<number, 'allowed' | 'denied'>();

/** Cached daemon descendants (pgrep is expensive at 1s intervals) */
let cachedDaemonDescendants: Set<number> = new Set();
let cachedDaemonDescendantsAt = 0;
const DAEMON_DESCENDANTS_TTL_MS = 10_000;

// ─── Public API ─────────────────────────────────────────────

export interface ProcessEnforcerOptions {
  intervalMs?: number;
}

/**
 * Start the process enforcer interval. Runs an immediate scan, then repeats.
 */
export function startProcessEnforcer(options?: ProcessEnforcerOptions): void {
  const intervalMs = options?.intervalMs ?? 10_000;
  currentIntervalMs = intervalMs;
  const log = getLogger();
  log.info(`[enforcer] Starting process enforcer (interval: ${intervalMs}ms)`);

  // Immediate scan
  runEnforcementScan().catch(() => { /* logged internally */ });

  // Periodic scan
  scanTimer = setInterval(() => {
    runEnforcementScan().catch(() => { /* logged internally */ });
  }, intervalMs);

  // Periodic cleanup of recentlyKilledPids (every 60s)
  recentlyKilledCleanupTimer = setInterval(() => {
    recentlyKilledPids.clear();
  }, 60_000);
}

/**
 * Stop the process enforcer.
 */
export function stopProcessEnforcer(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  if (recentlyKilledCleanupTimer) {
    clearInterval(recentlyKilledCleanupTimer);
    recentlyKilledCleanupTimer = null;
  }
  recentlyKilledPids.clear();
  knownPids.clear();
  cachedDaemonDescendants = new Set();
  cachedDaemonDescendantsAt = 0;
  currentIntervalMs = 0;
}

/**
 * Restart the process enforcer with new options.
 * No-op if the interval hasn't changed.
 */
export function restartProcessEnforcer(options?: ProcessEnforcerOptions): void {
  const newInterval = options?.intervalMs ?? 10_000;
  if (newInterval === currentIntervalMs && scanTimer) return;

  stopProcessEnforcer();
  startProcessEnforcer(options);
}

/**
 * Trigger a one-shot enforcement scan (e.g., after policy push).
 * Also invalidates the known-PID cache so all running processes are re-evaluated.
 */
export async function triggerProcessEnforcement(): Promise<void> {
  invalidateKnownPids();
  await runEnforcementScan();
}

/**
 * Invalidate the delta cache so the next scan re-evaluates every PID.
 * Called when policies change.
 */
export function invalidateKnownPids(): void {
  knownPids.clear();
}

// ─── Internal ────────────────────────────────────────────────

async function runEnforcementScan(): Promise<void> {
  const log = getLogger();

  // Skip enforcement while any shield operation is in progress — installation
  // spawns brew/ruby/node processes that would match managed deny policies
  const activeOps = getActiveShieldOperations();
  if (activeOps.length > 0) {
    log.debug(`[enforcer] Skipping scan — ${activeOps.length} shield operation(s) in progress`);
    return;
  }

  let policyManager;
  try {
    policyManager = getPolicyManager();
  } catch {
    // PolicyManager not initialized yet — skip scan
    return;
  }

  let processes: HostProcess[];
  try {
    processes = await scanHostProcesses();
  } catch (err) {
    log.warn({ err }, '[enforcer] Failed to scan host processes');
    return;
  }

  if (processes.length === 0) return;

  // Collect daemon's own process tree — never kill our own children
  // (e.g., installation scripts running openclaw onboarding)
  // Cached with 10s TTL to avoid calling pgrep every 1s scan.
  const daemonDescendants = await getDaemonDescendantsCached();

  // Build a set of current PIDs for pruning departed ones from knownPids
  const currentPidSet = new Set(processes.map((p) => p.pid));

  // Prune departed PIDs from knownPids
  for (const pid of knownPids.keys()) {
    if (!currentPidSet.has(pid)) {
      knownPids.delete(pid);
    }
  }

  // Per-scan fingerprint cache and hash lookup (created once, discarded after scan)
  const fpCache = new Map<string, ProcessFingerprint>();
  const hashLookup = (sha256: string): string | null => {
    try {
      const sig = getStorage().binarySignatures.lookupBySha256(sha256, process.platform);
      return sig?.packageName ?? null;
    } catch { return null; }
  };

  let newPidsEvaluated = 0;

  for (const proc of processes) {
    // Skip recently killed PIDs
    if (recentlyKilledPids.has(proc.pid)) continue;

    // Skip daemon's own descendant processes
    if (daemonDescendants.has(proc.pid)) continue;

    // Delta scanning: skip PIDs we already evaluated
    if (knownPids.has(proc.pid)) continue;

    newPidsEvaluated++;

    let result = policyManager.evaluateProcess(proc.command);

    // Fingerprint-based detection: if standard matching missed,
    // resolve the binary's true identity and re-evaluate
    if (!result) {
      const fp = fingerprintProcess(proc.command, { cache: fpCache, hashLookup });
      for (const candidate of fp.candidateNames) {
        result = policyManager.evaluateProcess(candidate);
        if (result) {
          log.warn(
            `[enforcer] PID ${proc.pid} identified as "${candidate}" via ${fp.resolvedVia} ` +
            `(command: ${proc.command.slice(0, 80)})`,
          );
          break;
        }
      }
    }

    if (!result) {
      // Process allowed — remember it
      knownPids.set(proc.pid, 'allowed');
      continue;
    }

    // Process denied — remember and enforce
    knownPids.set(proc.pid, 'denied');

    const payload = {
      pid: proc.pid,
      user: proc.user,
      command: proc.command,
      policyId: result.policyId ?? 'unknown',
      policyName: result.policyName,
      enforcement: result.enforcement,
      reason: result.reason ?? 'Denied by process policy',
    };

    if (result.enforcement === 'kill') {
      log.warn(
        `[enforcer] Killing denied process PID ${proc.pid}: ${proc.command.slice(0, 120)} (policy: ${result.policyId})`,
      );
      emitProcessViolation(payload);
      recentlyKilledPids.add(proc.pid);
      killProcessTree(proc.pid);
      emitProcessKilled(payload);
    } else {
      // alert mode (default)
      log.info(
        `[enforcer] Process violation (alert): PID ${proc.pid}: ${proc.command.slice(0, 120)} (policy: ${result.policyId})`,
      );
      emitProcessViolation(payload);
    }
  }

  if (newPidsEvaluated > 0) {
    log.debug(`[enforcer] Evaluated ${newPidsEvaluated} new PID(s) this scan`);
  }
}

/**
 * Get daemon descendants with caching (10s TTL).
 */
async function getDaemonDescendantsCached(): Promise<Set<number>> {
  const now = Date.now();
  if (now - cachedDaemonDescendantsAt < DAEMON_DESCENDANTS_TTL_MS) {
    return cachedDaemonDescendants;
  }

  try {
    const descendants = await collectDescendants(process.pid);
    cachedDaemonDescendants = new Set(descendants);
  } catch {
    cachedDaemonDescendants = new Set();
  }
  cachedDaemonDescendantsAt = now;
  return cachedDaemonDescendants;
}

/**
 * Scan running processes belonging to the current host user.
 * Excludes system processes and the daemon's own process tree.
 */
export async function scanHostProcesses(): Promise<HostProcess[]> {
  const currentUser = os.userInfo().username;
  const daemonPid = process.pid;
  const parentPid = process.ppid;

  const executor = getSystemExecutor();
  const raw = await executor.exec(
    `ps -U ${currentUser} -ax -o pid=,command= 2>/dev/null`,
    { timeout: 10_000 },
  );

  // Load agent usernames from storage to exclude sudo delegations
  let agentUsernames = new Set<string>();
  try {
    const profiles = getStorage().profiles.getAll();
    for (const p of profiles) {
      if (p.agentUsername) agentUsernames.add(p.agentUsername);
    }
  } catch { /* storage not ready */ }

  const processes: HostProcess[] = [];

  for (const line of raw.trim().split('\n')) {
    if (!line.trim()) continue;

    // Parse: leading whitespace, PID, then command
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;

    const pid = parseInt(match[1], 10);
    const command = match[2].trim();

    // Self-protection: skip daemon's own PID and parent
    if (pid === daemonPid || pid === parentPid) continue;

    // Skip system processes
    if (SYSTEM_PROCESS_RE.test(command)) continue;

    // Skip ps itself
    if (command.startsWith('ps ')) continue;

    // Skip sudo delegations to known AgenShield agent users
    if (agentUsernames.size > 0 && isShieldedProcess(command, agentUsernames)) continue;

    processes.push({ pid, user: currentUser, command });
  }

  return processes;
}

/**
 * Kill a process tree: SIGTERM immediately, SIGKILL after grace period (non-blocking).
 * The SIGKILL timer is unref'd so it doesn't keep the event loop alive.
 */
export function killProcessTree(pid: number): void {
  // Collect descendants synchronously via cached data isn't possible here;
  // fire SIGTERM to the root immediately, then collect + kill async.
  try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }

  // Async: collect descendants and kill them too
  collectDescendants(pid)
    .then((descendants) => {
      // SIGTERM to descendants (leaves first)
      for (const childPid of descendants.reverse()) {
        try { process.kill(childPid, 'SIGTERM'); } catch { /* already dead */ }
      }

      // Schedule SIGKILL after grace period (non-blocking)
      const timer = setTimeout(() => {
        for (const childPid of descendants) {
          try { process.kill(childPid, 'SIGKILL'); } catch { /* already dead */ }
        }
        try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
      }, GRACE_PERIOD_MS);
      timer.unref();
    })
    .catch(() => {
      // Failed to collect descendants — still schedule SIGKILL for root
      const timer = setTimeout(() => {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
      }, GRACE_PERIOD_MS);
      timer.unref();
    });
}

/**
 * Recursively collect all descendant PIDs via `pgrep -P`.
 */
async function collectDescendants(pid: number): Promise<number[]> {
  const descendants: number[] = [];
  try {
    const executor = getSystemExecutor();
    const output = await executor.exec(`pgrep -P ${pid} 2>/dev/null`, { timeout: 5_000 });
    for (const line of output.trim().split('\n')) {
      const childPid = parseInt(line.trim(), 10);
      if (!isNaN(childPid) && childPid > 0) {
        descendants.push(childPid);
        descendants.push(...await collectDescendants(childPid));
      }
    }
  } catch {
    // pgrep returns exit code 1 when no children found — expected
  }
  return descendants;
}
