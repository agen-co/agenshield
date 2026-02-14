/**
 * Scope resolution for multi-tenant storage
 *
 * Config:   global -> profile  (merge, NULL = inherit)
 * Policies: UNION all matching scopes (additive, priority for conflicts)
 * Secrets:  most specific wins per name (profile > global)
 */

import type { ScopeFilter } from '@agenshield/ipc';

/**
 * Build WHERE clause fragments for scope filtering.
 * Returns { clause, params } to be used in SQL queries.
 */
export function buildScopeWhere(scope?: ScopeFilter): { clause: string; params: Record<string, unknown> } {
  if (!scope || scope.profileId === undefined) {
    return { clause: '1=1', params: {} };
  }

  if (scope.profileId === null) {
    return { clause: 'profile_id IS NULL', params: {} };
  }

  return { clause: 'profile_id = @profileId', params: { profileId: scope.profileId } };
}

/**
 * Build scope clauses for config resolution (cascading merge).
 * Returns scope levels from least specific to most specific.
 */
export function getConfigScopeLevels(scope?: ScopeFilter): ScopeFilter[] {
  const levels: ScopeFilter[] = [
    { profileId: null }, // base/global
  ];

  if (scope?.profileId) {
    levels.push({ profileId: scope.profileId }); // profile-level
  }

  return levels;
}

/**
 * Build WHERE clause for querying all matching policy scopes (UNION).
 * Returns policies from global + profile scopes.
 */
export function buildPolicyScopeWhere(scope?: ScopeFilter): { clause: string; params: Record<string, unknown> } {
  if (!scope || scope.profileId === undefined) {
    return { clause: '1=1', params: {} };
  }

  if (scope.profileId) {
    return {
      clause: 'profile_id IS NULL OR profile_id = @profileId',
      params: { profileId: scope.profileId },
    };
  }

  return { clause: 'profile_id IS NULL', params: {} };
}

/**
 * Merge config rows from multiple scope levels.
 * Later (more specific) levels override earlier (less specific) ones.
 * NULL values in a more specific level mean "inherit from parent".
 */
export function mergeConfigRows<T>(rows: T[]): T | null {
  if (rows.length === 0) return null;

  const merged = { ...rows[0] } as Record<string, unknown>;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as Record<string, unknown>;
    for (const key of Object.keys(row)) {
      if (row[key] !== null && row[key] !== undefined) {
        merged[key] = row[key];
      }
    }
  }

  return merged as T;
}

/**
 * For secrets, find the most specific value per name.
 * profile > global
 */
export function resolveSecretScope<T extends { profile_id: string | null; name: string }>(
  rows: T[],
): T[] {
  const byName = new Map<string, T>();

  // Process from least to most specific — later overwrites earlier
  const sorted = [...rows].sort((a, b) => {
    const scoreA = a.profile_id ? 1 : 0;
    const scoreB = b.profile_id ? 1 : 0;
    return scoreA - scoreB;
  });

  for (const row of sorted) {
    byName.set(row.name, row);
  }

  return Array.from(byName.values());
}
