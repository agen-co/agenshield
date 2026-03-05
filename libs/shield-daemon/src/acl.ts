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
import type { PolicyConfig, WorkspaceSkill } from '@agenshield/ipc';
import { isDevMode } from './config/paths';

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
 * Resolve a cross-cutting glob pattern against concrete workspace directories
 * by walking them up to maxDepth levels deep.
 *
 * Returns absolute paths to files matching the glob's filename component.
 */
export function resolveGlobInWorkspaces(
  pattern: string,
  workspacePaths: string[],
  maxDepth = 5,
): string[] {
  // Extract the filename component from the glob (e.g. '.env' from '**/.env')
  const segments = pattern.split('/').filter(Boolean);
  const filenameSegment = segments[segments.length - 1];
  if (!filenameSegment || /[*?[]/.test(filenameSegment)) {
    // If the filename itself is a glob (e.g. `**/*`), skip — too broad
    return [];
  }

  const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', '.hg', '__pycache__']);
  const results: string[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(fullPath, depth + 1);
        }
      } else if (entry.name === filenameSegment) {
        results.push(fullPath);
      }
    }
  }

  for (const ws of workspacePaths) {
    walk(ws, 0);
  }

  return results;
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
 * Check whether an ACL entry already exists for a user+action on a path
 * whose permissions are a superset of the requested permissions.
 *
 * Fails open (returns `false`) on any error so that `addUserAcl` proceeds.
 */
function hasUserAcl(
  targetPath: string,
  userName: string,
  permissions: string,
  action: 'allow' | 'deny',
): boolean {
  try {
    const output = execSync(`ls -led "${targetPath}" 2>/dev/null || true`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const requestedPerms = new Set(permissions.split(',').filter(Boolean));

    for (const line of output.split('\n')) {
      const match = line.match(/^\s*\d+:\s+user:(\S+)\s+(allow|deny)\s+(.+)$/);
      if (match && match[1] === userName && match[2] === action) {
        const existingPerms = new Set(match[3].split(',').map(s => s.trim()).filter(Boolean));
        // Superset check: every requested perm already exists
        let covered = true;
        for (const p of requestedPerms) {
          if (!existingPerms.has(p)) {
            covered = false;
            break;
          }
        }
        if (covered) return true;
      }
    }
  } catch {
    // Fail open — let addUserAcl proceed
  }
  return false;
}

/**
 * Add a user ACL entry to a path.
 * Idempotent: skips if a matching entry with sufficient permissions already exists.
 *
 * @returns `true` if the ACL was already present or successfully added; `false` on failure.
 */
export function addUserAcl(
  targetPath: string,
  userName: string,
  permissions: string,
  log: Logger = noop,
  action: 'allow' | 'deny' = 'allow',
): boolean {
  if (isDevMode()) {
    log.warn(`[acl] dev mode — attempting ACL add (may fail): ${targetPath}`);
  }
  try {
    if (!fs.existsSync(targetPath)) {
      log.warn(`[acl] skipping non-existent path: ${targetPath}`);
      return false;
    }
    if (hasUserAcl(targetPath, userName, permissions, action)) return true;
    const cmd = `chmod +a "user:${userName} ${action} ${permissions}" "${targetPath}"`;
    try {
      execSync(cmd, { stdio: 'pipe' });
    } catch {
      // Fall back to sudo (e.g. for system-owned files)
      execSync(`sudo ${cmd}`, { stdio: 'pipe' });
    }
    return true;
  } catch (err) {
    log.warn(`[acl] failed to add ${action} ACL on ${targetPath}: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Verify that an ACL entry actually exists on a path after applying it.
 * Re-checks via `hasUserAcl` and returns `true` if the entry is present.
 */
export function verifyUserAcl(
  targetPath: string,
  userName: string,
  permissions: string,
  action: 'allow' | 'deny' = 'allow',
): boolean {
  return hasUserAcl(targetPath, userName, permissions, action);
}

/**
 * Remove all ACL entries for a user from a path.
 *
 * Reads current ACL entries via `ls -le`, finds entries matching the user
 * (both allow and deny), and removes them by index (highest-first so indices
 * stay valid). This ensures a clean slate before reapplying permissions.
 */
export function removeUserAcl(targetPath: string, userName: string, log: Logger = noop): void {
  if (isDevMode()) {
    log.warn(`[acl] dev mode — attempting ACL remove (may fail): ${targetPath}`);
  }
  try {
    if (!fs.existsSync(targetPath)) {
      log.warn(`[acl] skipping non-existent path: ${targetPath}`);
      return;
    }

    const output = execSync(`ls -led "${targetPath}" 2>/dev/null || true`, {
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
 * Remove orphaned (bare-UUID) ACL entries from a path.
 *
 * When a macOS user is deleted, their `user:username` ACL entries are converted
 * to bare UUID format (e.g., `33C7868A-...-4F2E1A3B`). These stale entries
 * accumulate and can hit the 128-entry-per-file macOS ACL limit, preventing
 * new entries from being added.
 *
 * This function reads the ACL list, matches entries that show a bare UUID
 * instead of `user:username`, and removes them highest-index-first.
 *
 * Safe to call on any path — active users always show as `user:username`.
 */
export function removeOrphanedAcls(targetPath: string, log: Logger = noop): void {
  try {
    if (!fs.existsSync(targetPath)) return;

    const output = execSync(`ls -led "${targetPath}" 2>/dev/null || true`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Match bare UUID entries: " 0: 33C7868A-1234-5678-9ABC-4F2E1A3B allow ..."
    const UUID_RE = /^\s*(\d+):\s+[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\s+(?:allow|deny)\s+/;
    const indices: number[] = [];
    for (const line of output.split('\n')) {
      const match = line.match(UUID_RE);
      if (match) {
        indices.push(Number(match[1]));
      }
    }

    if (indices.length === 0) return;

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
        log.warn(`[acl] failed to remove orphaned ACL entry ${idx} on ${targetPath}: ${(err as Error).message}`);
      }
    }

    log.warn(`[acl] removed ${indices.length} orphaned UUID-based ACL entr${indices.length === 1 ? 'y' : 'ies'} from ${targetPath}`);
  } catch (err) {
    log.warn(`[acl] failed to read ACLs on ${targetPath}: ${(err as Error).message}`);
  }
}

/**
 * Remove ALL ACL entries for a user across workspace paths, their traversal
 * ancestors, and filesystem policy paths.
 *
 * Must be called **before** deleting the macOS user so that `removeUserAcl`
 * can match by username rather than leaving orphaned UUID entries.
 */
export function removeAllUserAcls(
  userName: string,
  workspacePaths: string[],
  policies: PolicyConfig[],
  log: Logger = noop,
): void {
  const cleaned = new Set<string>();

  // 1. Workspace paths and their traversal ancestors
  for (const ws of workspacePaths) {
    if (!cleaned.has(ws)) {
      removeUserAcl(ws, userName, log);
      cleaned.add(ws);
    }
    for (const ancestor of getAncestorsNeedingTraversal(ws)) {
      if (!cleaned.has(ancestor)) {
        removeUserAcl(ancestor, userName, log);
        cleaned.add(ancestor);
      }
    }
  }

  // 2. Filesystem policy paths (both allow and deny maps)
  const fsPolicies = policies.filter(p => p.enabled !== false && isFilesystemRelevant(p));
  const { allow, deny } = computeAclMap(fsPolicies, workspacePaths);
  for (const targetPath of [...allow.keys(), ...deny.keys()]) {
    if (!cleaned.has(targetPath)) {
      removeUserAcl(targetPath, userName, log);
      cleaned.add(targetPath);
    }
  }
}

/**
 * Walk up from `targetPath` collecting ancestor directories that are NOT
 * world-traversable and therefore need an explicit `search` ACL.
 */
export function getAncestorsNeedingTraversal(targetPath: string): string[] {
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
 *   Pass 2: add "search" for traversal ancestors not already in the map.
 * Deny map:
 *   Pass 3: collect deny targets (no traversal ancestors needed for deny).
 *           Cross-cutting globs that resolve to "/" are expanded against
 *           concrete workspace paths when provided.
 */
export function computeAclMap(
  policies: PolicyConfig[],
  workspacePaths: string[] = [],
): { allow: Map<string, string>; deny: Map<string, string> } {
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
      if (target === '/') {
        // Cross-cutting glob (e.g. **/.env) — resolve against workspace paths
        if (workspacePaths.length > 0) {
          const concreteFiles = resolveGlobInWorkspaces(pattern, workspacePaths);
          for (const filePath of concreteFiles) {
            const existing = denyMap.get(filePath);
            denyMap.set(filePath, existing ? mergePerms(existing, perms) : perms);
          }
        }
        continue;
      }
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
  workspacePaths: string[] = [],
): void {
  const log = logger ?? noop;

  const oldFs = oldPolicies.filter((p) => p.enabled !== false && isFilesystemRelevant(p));
  const newFs = newPolicies.filter((p) => p.enabled !== false && isFilesystemRelevant(p));

  const oldMaps = computeAclMap(oldFs, workspacePaths);
  const newMaps = computeAclMap(newFs, workspacePaths);

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

// ── Workspace skill ACL helpers ──────────────────────────────────

const SKILL_DENY_PERMS = 'read,readattr,readextattr,list,search,execute';

/**
 * Deny agent user from reading a workspace skill directory.
 * macOS deny ACL entries are evaluated before allow entries,
 * so the workspace-level allow is overridden by this deny.
 *
 * @returns `true` if the deny ACL was applied and verified; `false` on failure.
 */
export function denyWorkspaceSkill(
  skillPath: string,
  userName: string,
  log: Logger = noop,
): boolean {
  const applied = addUserAcl(skillPath, userName, SKILL_DENY_PERMS, log, 'deny');
  if (!applied) return false;
  return verifyUserAcl(skillPath, userName, SKILL_DENY_PERMS, 'deny');
}

/**
 * Remove deny ACL when a workspace skill is approved.
 */
export function allowWorkspaceSkill(
  skillPath: string,
  userName: string,
  log: Logger = noop,
): void {
  removeUserAcl(skillPath, userName, log);
}

/**
 * Sync all workspace skill ACLs for a workspace.
 * For each skill: apply deny if pending/denied, remove deny if approved/cloud_forced.
 */
export function syncWorkspaceSkillAcls(
  workspacePath: string,
  skills: WorkspaceSkill[],
  userName: string,
  log: Logger = noop,
): void {
  for (const skill of skills) {
    const skillPath = path.join(workspacePath, '.claude', 'skills', skill.skillName);
    if (!fs.existsSync(skillPath)) continue;

    if (skill.status === 'pending' || skill.status === 'denied') {
      denyWorkspaceSkill(skillPath, userName, log);
    } else if (skill.status === 'approved' || skill.status === 'cloud_forced') {
      allowWorkspaceSkill(skillPath, userName, log);
    }
  }
}
