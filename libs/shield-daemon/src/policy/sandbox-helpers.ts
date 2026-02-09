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
 * Scan all enabled deny policies and collect concrete paths suitable for SBPL.
 *
 * Includes:
 * - `target: 'filesystem'` deny policies
 * - `target: 'command'` deny policies whose `operations` include file_read/file_write/file_list
 */
export function collectDenyPathsFromPolicies(policies: PolicyConfig[]): string[] {
  const allPatterns: string[] = [];

  for (const policy of policies) {
    // Only enabled deny policies
    if (!policy.enabled || policy.action !== 'deny') continue;

    if (policy.target === 'filesystem') {
      allPatterns.push(...policy.patterns);
    } else if (policy.target === 'command') {
      // Only include if operations contain filesystem operations
      const ops = policy.operations || [];
      const hasFileOps = ops.some(op =>
        op === 'file_read' || op === 'file_write' || op === 'file_list'
      );
      if (hasFileOps) {
        allPatterns.push(...policy.patterns);
      }
    }
  }

  return extractConcreteDenyPaths(allPatterns);
}
