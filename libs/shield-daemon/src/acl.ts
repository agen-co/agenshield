/**
 * macOS ACL utilities for filesystem policies.
 *
 * Uses `chmod +a / -a` to grant/revoke group-level ACLs on paths
 * derived from policy patterns. Failures are logged but never thrown.
 */

import { execSync } from 'node:child_process';
import * as os from 'node:os';
import * as fs from 'node:fs';
import type { PolicyConfig } from '@agenshield/ipc';

interface Logger {
  warn(msg: string, ...args: unknown[]): void;
}

const noop: Logger = { warn() { /* no-op */ } };

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
  return base.length === 0 ? '/' : base.join('/') || '/';
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
 * Add a group ACL entry to a path.
 */
export function addGroupAcl(targetPath: string, groupName: string, permissions: string, log: Logger = noop): void {
  try {
    if (!fs.existsSync(targetPath)) {
      log.warn(`[acl] skipping non-existent path: ${targetPath}`);
      return;
    }
    execSync(
      `sudo chmod +a "group:${groupName} allow ${permissions}" "${targetPath}"`,
      { stdio: 'pipe' },
    );
  } catch (err) {
    log.warn(`[acl] failed to add ACL on ${targetPath}: ${(err as Error).message}`);
  }
}

/**
 * Remove all ACL entries for a group from a path.
 *
 * Reads current ACL entries via `ls -le`, finds entries matching the group,
 * and removes them by index (highest-first so indices stay valid).
 */
export function removeGroupAcl(targetPath: string, groupName: string, log: Logger = noop): void {
  try {
    if (!fs.existsSync(targetPath)) {
      log.warn(`[acl] skipping non-existent path: ${targetPath}`);
      return;
    }

    const output = execSync(`ls -le "${targetPath}" 2>/dev/null || true`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Parse ACL entries — lines like " 0: group:mygroup allow read,write"
    const indices: number[] = [];
    for (const line of output.split('\n')) {
      const match = line.match(/^\s*(\d+):\s+group:(\S+)\s+allow/);
      if (match && match[2] === groupName) {
        indices.push(Number(match[1]));
      }
    }

    // Remove highest index first so lower indices stay valid
    indices.sort((a, b) => b - a);
    for (const idx of indices) {
      try {
        execSync(
          `sudo chmod -a# ${idx} "${targetPath}"`,
          { stdio: 'pipe' },
        );
      } catch (err) {
        log.warn(`[acl] failed to remove ACL entry ${idx} on ${targetPath}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    log.warn(`[acl] failed to read ACLs on ${targetPath}: ${(err as Error).message}`);
  }
}

/**
 * Synchronise filesystem policy ACLs after a config change.
 *
 * Compares old and new policy arrays, and for filesystem-target policies:
 *   - Removed policies → revoke ACLs for each pattern
 *   - Added policies   → apply ACLs for each pattern
 *   - Changed policies → revoke old patterns, apply new ones
 */
export function syncFilesystemPolicyAcls(
  oldPolicies: PolicyConfig[],
  newPolicies: PolicyConfig[],
  groupName: string,
  logger?: Logger,
): void {
  const log = logger ?? noop;

  const oldFs = oldPolicies.filter((p) => p.target === 'filesystem');
  const newFs = newPolicies.filter((p) => p.target === 'filesystem');

  const oldMap = new Map(oldFs.map((p) => [p.id, p]));
  const newMap = new Map(newFs.map((p) => [p.id, p]));

  // Removed policies — revoke ACLs
  for (const [id, oldP] of oldMap) {
    if (!newMap.has(id)) {
      for (const pattern of oldP.patterns) {
        removeGroupAcl(stripGlobToBasePath(pattern), groupName, log);
      }
    }
  }

  // Added policies — apply ACLs
  for (const [id, newP] of newMap) {
    if (!oldMap.has(id)) {
      const perms = operationsToAclPerms(newP.operations ?? []);
      if (!perms) continue;
      for (const pattern of newP.patterns) {
        addGroupAcl(stripGlobToBasePath(pattern), groupName, perms, log);
      }
    }
  }

  // Changed policies — revoke old, apply new
  for (const [id, newP] of newMap) {
    const oldP = oldMap.get(id);
    if (!oldP) continue;

    const patternsChanged = JSON.stringify(oldP.patterns) !== JSON.stringify(newP.patterns);
    const opsChanged = JSON.stringify(oldP.operations ?? []) !== JSON.stringify(newP.operations ?? []);

    if (patternsChanged || opsChanged) {
      // Revoke old
      for (const pattern of oldP.patterns) {
        removeGroupAcl(stripGlobToBasePath(pattern), groupName, log);
      }
      // Apply new
      const perms = operationsToAclPerms(newP.operations ?? []);
      if (!perms) continue;
      for (const pattern of newP.patterns) {
        addGroupAcl(stripGlobToBasePath(pattern), groupName, perms, log);
      }
    }
  }
}
