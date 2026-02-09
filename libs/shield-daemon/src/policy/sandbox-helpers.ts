/**
 * Sandbox Helper Functions
 *
 * Extracts concrete filesystem deny paths from policy configurations
 * that can be expressed as SBPL (Seatbelt Profile Language) rules.
 *
 * SBPL only supports `(subpath "/path")` and `(literal "/path")` — NOT
 * glob patterns. So only absolute, concrete paths (no wildcards after
 * stripping trailing /* or /**) can be wired into sandbox-exec profiles.
 */

import type { PolicyConfig } from '@agenshield/ipc';
import { commandScopeMatches } from './url-matcher';

/**
 * Filter patterns to only those expressible as SBPL rules.
 *
 * - Skip patterns starting with `**​/` or `*​/` (relative globs)
 * - Must start with `/` (absolute)
 * - Strip trailing `/*` or `/**` (e.g. `/etc/ssh/*` → `/etc/ssh`)
 * - Skip if wildcards remain after stripping
 * - Skip empty or root-only paths
 * - Deduplicate
 */
export function extractConcreteDenyPaths(patterns: string[]): string[] {
  const result = new Set<string>();

  for (const raw of patterns) {
    const pattern = raw.trim();
    if (!pattern) continue;

    // Skip relative glob patterns (start with **/ or */)
    if (pattern.startsWith('**/') || pattern.startsWith('*/')) continue;

    // Must be absolute
    if (!pattern.startsWith('/')) continue;

    // Strip trailing /** or /*
    let cleaned = pattern;
    if (cleaned.endsWith('/**')) {
      cleaned = cleaned.slice(0, -3);
    } else if (cleaned.endsWith('/*')) {
      cleaned = cleaned.slice(0, -2);
    }

    // Skip if wildcards remain (e.g. /etc/*/config)
    if (cleaned.includes('*') || cleaned.includes('?')) continue;

    // Skip empty or root-only paths
    if (!cleaned || cleaned === '/') continue;

    result.add(cleaned);
  }

  return [...result];
}

/**
 * Check if a policy contributes filesystem-relevant patterns.
 */
function isFilesystemRelevant(policy: PolicyConfig): boolean {
  if (policy.target === 'filesystem') return true;
  if (policy.target === 'command') {
    const ops = policy.operations || [];
    return ops.some(op => op === 'file_read' || op === 'file_write' || op === 'file_list');
  }
  return false;
}

/**
 * Scan all enabled deny policies and collect concrete paths suitable for SBPL.
 *
 * Includes:
 * - `target: 'filesystem'` deny policies
 * - `target: 'command'` deny policies whose `operations` include file_read/file_write/file_list
 *
 * When `commandBasename` is provided, command-scoped policies are filtered by
 * that command. Global (unscoped) policies always apply. Ordering: global first,
 * then command-scoped.
 *
 * Backwards compatible: without `commandBasename`, only global (non-command-scoped) policies run.
 */
export function collectDenyPathsFromPolicies(
  policies: PolicyConfig[],
  commandBasename?: string
): string[] {
  const allPatterns: string[] = [];

  // Pass 1: global (no command: scope) policies
  for (const policy of policies) {
    if (!policy.enabled || policy.action !== 'deny') continue;
    if (policy.scope?.startsWith('command:')) continue;
    if (!isFilesystemRelevant(policy)) continue;
    allPatterns.push(...policy.patterns);
  }

  // Pass 2: command-scoped policies (only if commandBasename provided)
  if (commandBasename !== undefined) {
    for (const policy of policies) {
      if (!policy.enabled || policy.action !== 'deny') continue;
      if (!policy.scope?.startsWith('command:')) continue;
      if (!commandScopeMatches(policy, commandBasename)) continue;
      if (!isFilesystemRelevant(policy)) continue;
      allPatterns.push(...policy.patterns);
    }
  }

  return extractConcreteDenyPaths(allPatterns);
}

/**
 * Collect per-command filesystem allow paths from enabled allow policies.
 *
 * Returns separate read and write paths. Ordering: global first, then command-scoped.
 *
 * For `target: 'filesystem'`:
 *  - If operations is empty or includes file_read/file_list → readPaths
 *  - If operations includes file_write → writePaths
 *
 * For `target: 'command'` with file_read/file_write/file_list operations:
 *  - Same logic based on specific operations present
 */
export function collectAllowPathsForCommand(
  policies: PolicyConfig[],
  commandBasename: string
): { readPaths: string[]; writePaths: string[] } {
  const readPatterns: string[] = [];
  const writePatterns: string[] = [];

  const pushPatterns = (policy: PolicyConfig) => {
    if (policy.target === 'filesystem') {
      const ops = policy.operations || [];
      const hasRead = ops.length === 0 || ops.includes('file_read') || ops.includes('file_list');
      const hasWrite = ops.includes('file_write');
      if (hasRead) readPatterns.push(...policy.patterns);
      if (hasWrite) writePatterns.push(...policy.patterns);
    } else if (policy.target === 'command') {
      const ops = policy.operations || [];
      if (!ops.some(op => op === 'file_read' || op === 'file_write' || op === 'file_list')) return;
      if (ops.includes('file_read') || ops.includes('file_list')) readPatterns.push(...policy.patterns);
      if (ops.includes('file_write')) writePatterns.push(...policy.patterns);
    }
  };

  // Pass 1: global (no command: scope) allow policies
  for (const policy of policies) {
    if (!policy.enabled || policy.action !== 'allow') continue;
    if (policy.scope?.startsWith('command:')) continue;
    pushPatterns(policy);
  }

  // Pass 2: matching command-scoped allow policies
  for (const policy of policies) {
    if (!policy.enabled || policy.action !== 'allow') continue;
    if (!policy.scope?.startsWith('command:')) continue;
    if (!commandScopeMatches(policy, commandBasename)) continue;
    pushPatterns(policy);
  }

  return {
    readPaths: extractConcreteDenyPaths(readPatterns),
    writePaths: extractConcreteDenyPaths(writePatterns),
  };
}
