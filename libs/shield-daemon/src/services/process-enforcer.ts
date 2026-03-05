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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getLogger } from '../logger';
import { getPolicyManager } from './policy-manager';
import { emitProcessViolation, emitProcessKilled } from '../events/emitter';
import { getSystemExecutor } from '../workers/system-command';
import { getActiveShieldOperations } from './shield-registry';
import { getStorage } from '@agenshield/storage';
import { isShieldedProcess } from '@agenshield/policies';
import { fingerprintProcess, computeFileHash } from './process-fingerprint';
import type { ProcessFingerprint } from './process-fingerprint';

// macOS system daemons — never enforce against these
const SYSTEM_PROCESS_RE = /\b(cfprefsd|lsd|trustd|diskarbitrationd|secinitd|tccd|nsurlsessiond|mdworker|distnoted|smd|pboard|launchd|kernel_task|WindowServer|loginwindow)\b/i;

/** AgenShield infrastructure binaries in libexec — always exempt */
const AGENSHIELD_INFRA_RE = /[/\\]\.agenshield[/\\]libexec[/\\]/;

/** Broader match for any .agenshield/ path — requires hash verification */
const AGENSHIELD_PATH_RE = /[/\\]\.agenshield[/\\]/;

/**
 * Check whether a process command is running from a known agent user's home directory.
 * Catches child processes of shielded executions that run under root but originate
 * from the agent's home (e.g., /Users/ash_claude_agent/.local/bin/claude).
 */
function isAgentHomeProcess(command: string, agentUsernames: Set<string>): boolean {
  const trimmed = command.trim();
  for (const username of agentUsernames) {
    if (trimmed.startsWith(`/Users/${username}/`) || trimmed.startsWith(`/home/${username}/`)) {
      return true;
    }
  }
  return false;
}

const GRACE_PERIOD_MS = 5_000;

export interface HostProcess {
  pid: number;
  user: string;
  command: string;
}

// ─── State ───────────────────────────────────────────────────

let scanTimer: NodeJS.Timeout | null = null;
let currentIntervalMs = 0;
let deferredEnforcementTimer: NodeJS.Timeout | null = null;
const DEFERRED_ENFORCEMENT_DELAY_MS = 5_000;
/** PIDs recently killed — tracked to avoid re-scanning dead processes */
const recentlyKilledPids = new Set<number>();
let recentlyKilledCleanupTimer: NodeJS.Timeout | null = null;

/** Delta scanning: tracks previously-evaluated PIDs and their verdict */
const knownPids = new Map<number, 'allowed' | 'denied'>();

/** Cached daemon descendants (pgrep is expensive at 1s intervals) */
let cachedDaemonDescendants: Set<number> = new Set();
let cachedDaemonDescendantsAt = 0;
const DAEMON_DESCENDANTS_TTL_MS = 10_000;

/** Trusted SHA256 hashes from profile install manifests */
let trustedManifestHashes = new Set<string>();

/** Cache: binaryPath → { mtimeMs, trusted } to avoid re-hashing every scan */
const verifiedBinaryCache = new Map<string, { mtimeMs: number; trusted: boolean }>();

// ─── Trusted hash verification ──────────────────────────────

/**
 * Refresh trusted binary hashes from profile install manifests.
 * Called on startup and when profiles/manifests change.
 */
export function refreshTrustedHashes(): void {
  const newHashes = new Set<string>();
  const log = getLogger();

  try {
    const profiles = getStorage().profiles.getAll();
    for (const p of profiles) {
      const manifest = p.installManifest;
      if (!manifest) continue;
      for (const entry of manifest.entries) {
        if (entry.status !== 'completed') continue;
        for (const [key, value] of Object.entries(entry.outputs)) {
          if (key.endsWith('Hash') && typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)) {
            newHashes.add(value.toLowerCase());
          }
        }
      }
    }
  } catch { /* storage not ready */ }

  trustedManifestHashes = newHashes;
  if (newHashes.size > 0) {
    log.debug(`[enforcer] Loaded ${newHashes.size} trusted binary hash(es) from install manifests`);
  }
}

/**
 * Invalidate the verified binary cache (e.g. after binary-integrity remediation).
 */
export function invalidateVerifiedBinaryCache(): void {
  verifiedBinaryCache.clear();
}

/**
 * Check whether a process command running from .agenshield/ is a verified
 * trusted binary by comparing its SHA256 against install manifest hashes.
 * Results are cached by (binaryPath, mtime) to avoid re-hashing each scan.
 */
function isVerifiedAgenshieldBinary(command: string): boolean {
  const log = getLogger();

  // Extract the binary path (first whitespace-delimited token)
  const trimmed = command.trim();
  const firstToken = trimmed.split(/\s+/)[0];
  if (!firstToken) return false;

  // Resolve absolute path
  const binPath = path.isAbsolute(firstToken) ? firstToken : null;
  if (!binPath) return false;

  // Check mtime cache to avoid re-hashing on every scan
  try {
    const stat = fs.statSync(binPath);
    const cached = verifiedBinaryCache.get(binPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.trusted;
    }

    const hash = computeFileHash(binPath);
    if (!hash) {
      verifiedBinaryCache.set(binPath, { mtimeMs: stat.mtimeMs, trusted: false });
      return false;
    }

    const trusted = trustedManifestHashes.has(hash.toLowerCase());
    verifiedBinaryCache.set(binPath, { mtimeMs: stat.mtimeMs, trusted });

    if (trusted) {
      log.debug(`[enforcer] Verified .agenshield binary: ${binPath}`);
    } else {
      log.warn(`[enforcer] Unverified binary in .agenshield: ${binPath} (hash: ${hash.slice(0, 16)}...)`);
    }

    return trusted;
  } catch {
    return false;
  }
}

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

  // Load trusted binary hashes from install manifests
  refreshTrustedHashes();

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
  if (deferredEnforcementTimer) {
    clearTimeout(deferredEnforcementTimer);
    deferredEnforcementTimer = null;
  }
  recentlyKilledPids.clear();
  knownPids.clear();
  cachedDaemonDescendants = new Set();
  cachedDaemonDescendantsAt = 0;
  currentIntervalMs = 0;
  verifiedBinaryCache.clear();
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
    if (!deferredEnforcementTimer) {
      deferredEnforcementTimer = setTimeout(() => {
        deferredEnforcementTimer = null;
        runEnforcementScan().catch(() => { /* logged internally */ });
      }, DEFERRED_ENFORCEMENT_DELAY_MS);
    }
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

  // Build policyId→profileId map for enforcement event attribution
  const policyToProfileId = new Map<string, string>();
  try {
    const sections = getStorage().policies.getAllTargetSections();
    if (sections) {
      for (const section of sections) {
        for (const pol of section.policies) {
          policyToProfileId.set(pol.id, section.profileId);
        }
      }
    }
  } catch { /* storage not ready */ }

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

    const MAX_COMMAND_LEN = 200;
    const fullCommand = proc.command;
    const payload = {
      pid: proc.pid,
      user: proc.user,
      command: fullCommand.length > MAX_COMMAND_LEN
        ? fullCommand.slice(0, MAX_COMMAND_LEN)
        : fullCommand,
      commandPreview: fullCommand.length > 80
        ? fullCommand.slice(0, 77) + '...'
        : fullCommand,
      policyId: result.policyId ?? 'unknown',
      policyName: result.policyName,
      enforcement: result.enforcement,
      reason: result.reason ?? 'Denied by process policy',
    };

    // Resolve profileId from policy → profile mapping
    const matchedProfileId = result.policyId ? policyToProfileId.get(result.policyId) : undefined;

    if (result.enforcement === 'kill') {
      log.warn(
        `[enforcer] Killing denied process PID ${proc.pid}: ${proc.command.slice(0, 120)} (policy: ${result.policyId})`,
      );
      recentlyKilledPids.add(proc.pid);
      killProcessTree(proc.pid);
      emitProcessKilled(payload, matchedProfileId);
    } else {
      // alert mode (default)
      log.info(
        `[enforcer] Process violation (alert): PID ${proc.pid}: ${proc.command.slice(0, 120)} (policy: ${result.policyId})`,
      );
      emitProcessViolation(payload, matchedProfileId);
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
    `ps -U ${currentUser} -ax -o user=,pid=,command= 2>/dev/null`,
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

    // Parse: leading whitespace, user, PID, then command
    const match = line.match(/^\s*(\S+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;

    const processUser = match[1].trim();
    const pid = parseInt(match[2], 10);
    const command = match[3].trim();

    // Self-protection: skip daemon's own PID and parent
    if (pid === daemonPid || pid === parentPid) continue;

    // Skip system processes
    if (SYSTEM_PROCESS_RE.test(command)) continue;

    // Skip ps itself
    if (command.startsWith('ps ')) continue;

    // Skip sudo delegations to known AgenShield agent users
    if (agentUsernames.size > 0 && isShieldedProcess(command, agentUsernames)) continue;

    // Skip processes owned by known agent usernames (child processes of shielded execs)
    if (agentUsernames.has(processUser)) continue;

    // Skip processes running from agent home directories
    // (e.g., /Users/ash_claude_agent/.local/bin/claude running as root)
    if (agentUsernames.size > 0 && isAgentHomeProcess(command, agentUsernames)) continue;

    // Skip AgenShield infrastructure binaries in libexec (daemon, broker)
    if (AGENSHIELD_INFRA_RE.test(command)) continue;

    // Skip verified .agenshield/ binaries (hash-checked against install manifests)
    if (AGENSHIELD_PATH_RE.test(command) && isVerifiedAgenshieldBinary(command)) continue;

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
