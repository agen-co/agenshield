/**
 * Process Enforcer Service
 *
 * Scans running host-user processes and enforces process-target policies.
 * When a deny-policy matches a running process, the enforcer either alerts
 * (emits an event) or kills the process tree, depending on the policy's
 * enforcement mode.
 *
 * Follows the watcher pattern from watchers/security.ts and watchers/targets.ts.
 */

import { execSync } from 'node:child_process';
import os from 'node:os';
import { getLogger } from '../logger';
import { getPolicyManager } from './policy-manager';
import { emitProcessViolation, emitProcessKilled } from '../events/emitter';

// macOS system daemons — never enforce against these
const SYSTEM_PROCESS_RE = /\b(cfprefsd|lsd|trustd|diskarbitrationd|secinitd|tccd|nsurlsessiond|mdworker|distnoted|smd|pboard|launchd|kernel_task|WindowServer|loginwindow)\b/i;

const GRACE_PERIOD_MS = 5_000;

interface HostProcess {
  pid: number;
  user: string;
  command: string;
}

// ─── State ───────────────────────────────────────────────────

let scanTimer: NodeJS.Timeout | null = null;
/** PIDs recently killed — tracked to avoid re-scanning dead processes */
const recentlyKilledPids = new Set<number>();
let recentlyKilledCleanupTimer: NodeJS.Timeout | null = null;

// ─── Public API ─────────────────────────────────────────────

export interface ProcessEnforcerOptions {
  intervalMs?: number;
}

/**
 * Start the process enforcer interval. Runs an immediate scan, then repeats.
 */
export function startProcessEnforcer(options?: ProcessEnforcerOptions): void {
  const intervalMs = options?.intervalMs ?? 10_000;
  const log = getLogger();
  log.info(`[enforcer] Starting process enforcer (interval: ${intervalMs}ms)`);

  // Immediate scan
  runEnforcementScan();

  // Periodic scan
  scanTimer = setInterval(() => {
    runEnforcementScan();
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
}

/**
 * Trigger a one-shot enforcement scan (e.g., after policy push).
 */
export function triggerProcessEnforcement(): void {
  runEnforcementScan();
}

// ─── Internal ────────────────────────────────────────────────

function runEnforcementScan(): void {
  const log = getLogger();

  let policyManager;
  try {
    policyManager = getPolicyManager();
  } catch {
    // PolicyManager not initialized yet — skip scan
    return;
  }

  let processes: HostProcess[];
  try {
    processes = scanHostProcesses();
  } catch (err) {
    log.debug({ err }, '[enforcer] Failed to scan host processes');
    return;
  }

  if (processes.length === 0) return;

  for (const proc of processes) {
    // Skip recently killed PIDs
    if (recentlyKilledPids.has(proc.pid)) continue;

    const result = policyManager.evaluateProcess(proc.command);
    if (!result) continue; // Process allowed

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
      killProcessTree(proc.pid);
      emitProcessKilled(payload);
      recentlyKilledPids.add(proc.pid);
    } else {
      // alert mode (default)
      log.info(
        `[enforcer] Process violation (alert): PID ${proc.pid}: ${proc.command.slice(0, 120)} (policy: ${result.policyId})`,
      );
      emitProcessViolation(payload);
    }
  }
}

/**
 * Scan running processes belonging to the current host user.
 * Excludes system processes and the daemon's own process tree.
 */
function scanHostProcesses(): HostProcess[] {
  const currentUser = os.userInfo().username;
  const daemonPid = process.pid;
  const parentPid = process.ppid;

  // ps -eo pid,user,command — get all processes with user info
  const raw = execSync(
    `ps -u ${currentUser} -o pid=,command= 2>/dev/null`,
    { encoding: 'utf-8', timeout: 10_000 },
  );

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

    processes.push({ pid, user: currentUser, command });
  }

  return processes;
}

/**
 * Kill a process tree: SIGTERM → grace period → SIGKILL.
 * Follows the pattern from services/process-manager.ts.
 */
function killProcessTree(pid: number): void {
  const descendants = collectDescendants(pid);

  // SIGTERM to the whole tree (leaves first)
  for (const childPid of descendants.reverse()) {
    try { process.kill(childPid, 'SIGTERM'); } catch { /* already dead */ }
  }
  try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }

  // Grace period then SIGKILL
  setTimeout(() => {
    for (const childPid of descendants) {
      try { process.kill(childPid, 'SIGKILL'); } catch { /* already dead */ }
    }
    try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
  }, GRACE_PERIOD_MS);
}

/**
 * Recursively collect all descendant PIDs via `pgrep -P`.
 */
function collectDescendants(pid: number): number[] {
  const descendants: number[] = [];
  try {
    const output = execSync(`pgrep -P ${pid} 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    for (const line of output.trim().split('\n')) {
      const childPid = parseInt(line.trim(), 10);
      if (!isNaN(childPid) && childPid > 0) {
        descendants.push(childPid);
        descendants.push(...collectDescendants(childPid));
      }
    }
  } catch {
    // pgrep returns exit code 1 when no children found — expected
  }
  return descendants;
}
