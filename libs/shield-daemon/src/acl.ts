/**
 * macOS ACL utilities for filesystem policies.
 *
 * Uses `chmod +a / -a` to grant/revoke user-level ACLs on paths
 * derived from policy patterns. Failures are logged but never thrown.
 */

import { execSync } from 'node:child_process';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PolicyConfig } from '@agenshield/ipc';

interface Logger {
  warn(msg: string, ...args: unknown[]): void;
}

const noop: Logger = { warn() { /* no-op */ } };

const TRAVERSAL_PERMS = 'search';

const WORLD_TRAVERSABLE_PATHS = new Set([
  '/', '/Users', '/tmp', '/private', '/private/tmp', '/private/var',
  '/var', '/opt', '/usr', '/usr/local', '/Applications', '/Library',
  '/System', '/Volumes',
]);

/**
 * Remove trailing slashes from a path (preserves root `/`).
 */
function normalizePath(p: string): string {
  if (p === '/') return p;
  return p.replace(/\/+$/, '') || '/';
}

/**
 * Strip glob wildcards from a path, returning the deepest concrete directory.
 *
 *   /Users/me/projects/**  → /Users/me/projects
 *   /tmp/*                 → /tmp
 *   ~/docs/**              → /Users/<user>/docs
 */
export function stripGlobToBasePath(pattern: string): string {
  let p = pattern;
  if (p.startsWith('~')) {
    p = os.homedir() + p.slice(1);
  }

  const segments = p.split('/');
  const base: string[] = [];
  for (const seg of segments) {
    if (/[*?[]/.test(seg)) break;
    base.push(seg);
  }

  // If we consumed every segment (no wildcards), return the original path
  return normalizePath(base.length === 0 ? '/' : base.join('/') || '/');
}

/**
 * Map AgenShield operation names to macOS ACL permission keywords.
 */
export function operationsToAclPerms(operations: string[]): string {
  const perms: string[] = [];
  if (operations.includes('file_read')) {
    perms.push('read', 'readattr', 'readextattr', 'list', 'search', 'execute');
  }
  if (operations.includes('file_write')) {
    perms.push('write', 'append', 'writeattr', 'writeextattr');
  }
  return perms.join(',');
}

/**
 * Add a user ACL entry to a path.
 */
export function addUserAcl(
  targetPath: string,
  userName: string,
  permissions: string,
  log: Logger = noop,
  action: 'allow' | 'deny' = 'allow',
): void {
  try {
    if (!fs.existsSync(targetPath)) {
      log.warn(`[acl] skipping non-existent path: ${targetPath}`);
      return;
    }
    const cmd = `chmod +a "user:${userName} ${action} ${permissions}" "${targetPath}"`;
    try {
      execSync(cmd, { stdio: 'pipe' });
    } catch {
      // Fall back to sudo (e.g. for system-owned files)
      execSync(`sudo ${cmd}`, { stdio: 'pipe' });
    }
  } catch (err) {
    log.warn(`[acl] failed to add ${action} ACL on ${targetPath}: ${(err as Error).message}`);
  }
}

/**
 * Remove all ACL entries for a user from a path.
 *
 * Reads current ACL entries via `ls -le`, finds entries matching the user
 * (both allow and deny), and removes them by index (highest-first so indices
 * stay valid). This ensures a clean slate before reapplying permissions.
 */
export function removeUserAcl(targetPath: string, userName: string, log: Logger = noop): void {
  try {
    if (!fs.existsSync(targetPath)) {
      log.warn(`[acl] skipping non-existent path: ${targetPath}`);
      return;
    }

    const output = execSync(`ls -le "${targetPath}" 2>/dev/null || true`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Parse ACL entries — lines like " 0: user:ash_default_agent allow read,write"
    // Match both allow and deny entries to get a clean slate
    const indices: number[] = [];
    for (const line of output.split('\n')) {
      const match = line.match(/^\s*(\d+):\s+user:(\S+)\s+/);
      if (match && match[2] === userName) {
        indices.push(Number(match[1]));
      }
    }

    // Remove highest index first so lower indices stay valid
    indices.sort((a, b) => b - a);
    for (const idx of indices) {
      try {
        const cmd = `chmod -a# ${idx} "${targetPath}"`;
        try {
          execSync(cmd, { stdio: 'pipe' });
        } catch {
          execSync(`sudo ${cmd}`, { stdio: 'pipe' });
        }
      } catch (err) {
        log.warn(`[acl] failed to remove ACL entry ${idx} on ${targetPath}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    log.warn(`[acl] failed to read ACLs on ${targetPath}: ${(err as Error).message}`);
  }
}

/**
 * Walk up from `targetPath` collecting ancestor directories that are NOT
 * world-traversable and therefore need an explicit `search` ACL.
 */
function getAncestorsNeedingTraversal(targetPath: string): string[] {
  const ancestors: string[] = [];
  let dir = path.dirname(targetPath);
  while (dir !== targetPath && dir !== '/') {
    if (!WORLD_TRAVERSABLE_PATHS.has(dir)) {
      ancestors.push(dir);
    }
    targetPath = dir;
    dir = path.dirname(dir);
  }
  return ancestors;
}

/**
 * Merge two comma-separated permission strings, deduplicating.
 */
function mergePerms(a: string, b: string): string {
  const set = new Set([
    ...a.split(',').filter(Boolean),
    ...b.split(',').filter(Boolean),
  ]);
  return [...set].join(',');
}

/**
 * Check whether a policy is relevant to filesystem ACL enforcement.
 * Matches `target: 'filesystem'` and `target: 'command'` policies that
 * have file-related operations (file_read, file_write, file_list).
 */
export function isFilesystemRelevant(p: PolicyConfig): boolean {
  if (p.target === 'filesystem') return true;
  if (p.target === 'command') {
    const ops = p.operations ?? [];
    return ops.some(op => op === 'file_read' || op === 'file_write' || op === 'file_list');
  }
  return false;
}

/**
 * Build allow and deny ACL maps from a set of filesystem-relevant policies.
 *
 * Allow map:
 *   Pass 1: collect direct targets with merged permissions.
 *   Pass 2: add `search` for traversal ancestors not already in the map.
 * Deny map:
 *   Pass 3: collect deny targets (no traversal ancestors needed for deny).
 */
export function computeAclMap(policies: PolicyConfig[]): { allow: Map<string, string>; deny: Map<string, string> } {
  const allowMap = new Map<string, string>();
  const denyMap = new Map<string, string>();

  // Pass 1 — allow direct targets
  for (const policy of policies.filter(p => p.action === 'allow')) {
    const perms = operationsToAclPerms(policy.operations ?? []);
    if (!perms) continue;
    for (const pattern of policy.patterns) {
      const target = stripGlobToBasePath(pattern);
      const existing = allowMap.get(target);
      allowMap.set(target, existing ? mergePerms(existing, perms) : perms);
    }
  }

  // Pass 2 — traversal ancestors (only ALLOW policies)
  for (const policy of policies.filter(p => p.action === 'allow')) {
    const perms = operationsToAclPerms(policy.operations ?? []);
    if (!perms) continue;
    for (const pattern of policy.patterns) {
      const target = stripGlobToBasePath(pattern);
      for (const ancestor of getAncestorsNeedingTraversal(target)) {
        if (!allowMap.has(ancestor)) {
          allowMap.set(ancestor, TRAVERSAL_PERMS);
        }
      }
    }
  }

  // Pass 3 — deny targets (no traversal ancestors needed for deny)
  for (const policy of policies.filter(p => p.action === 'deny')) {
    const perms = operationsToAclPerms(policy.operations ?? []);
    if (!perms) continue;
    for (const pattern of policy.patterns) {
      const target = stripGlobToBasePath(pattern);
      const existing = denyMap.get(target);
      denyMap.set(target, existing ? mergePerms(existing, perms) : perms);
    }
  }

  return { allow: allowMap, deny: denyMap };
}

/**
 * Synchronise filesystem policy ACLs after a config change.
 *
 * For every path in the union of old and new ACL maps:
 *   1. Remove all existing user ACLs (clean slate)
 *   2. Reapply deny ACLs first (macOS evaluates ACLs top-to-bottom)
 *   3. Reapply allow ACLs second
 *
 * This "wipe then reapply" strategy avoids stale permission accumulation
 * and the deny+allow conflict where layering ACLs produces wrong results.
 */
export function syncFilesystemPolicyAcls(
  oldPolicies: PolicyConfig[],
  newPolicies: PolicyConfig[],
  userName: string,
  logger?: Logger,
): void {
  const log = logger ?? noop;

  const oldFs = oldPolicies.filter((p) => p.enabled !== false && isFilesystemRelevant(p));
  const newFs = newPolicies.filter((p) => p.enabled !== false && isFilesystemRelevant(p));

  const oldMaps = computeAclMap(oldFs);
  const newMaps = computeAclMap(newFs);

  // Collect ALL paths that had or will have ACLs (from both allow + deny maps)
  const allPaths = new Set([
    ...oldMaps.allow.keys(), ...oldMaps.deny.keys(),
    ...newMaps.allow.keys(), ...newMaps.deny.keys(),
  ]);

  for (const targetPath of allPaths) {
    // Step 1: Remove all existing ACLs for this user on this path
    removeUserAcl(targetPath, userName, log);

    // Step 2: Apply deny ACLs first (macOS evaluates top-to-bottom; deny before allow)
    const denyPerms = newMaps.deny.get(targetPath);
    if (denyPerms) {
      addUserAcl(targetPath, userName, denyPerms, log, 'deny');
    }

    // Step 3: Apply allow ACLs
    const allowPerms = newMaps.allow.get(targetPath);
    if (allowPerms) {
      addUserAcl(targetPath, userName, allowPerms, log, 'allow');
    }
  }
}
