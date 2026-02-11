/**
 * Scope resolution for multi-tenant storage
 *
 * Config:   base -> target -> target+user  (merge, NULL = inherit)
 * Policies: UNION all matching scopes (additive, priority for conflicts)
 * Secrets:  most specific wins per name (target+user > target > base)
 */

import type { ScopeFilter } from '@agenshield/ipc';

/**
 * Build WHERE clause fragments for scope filtering.
 * Returns { clause, params } to be used in SQL queries.
 */
export function buildScopeWhere(scope?: ScopeFilter): { clause: string; params: Record<string, unknown> } {
  if (!scope || (scope.targetId === undefined && scope.userUsername === undefined)) {
    return { clause: '1=1', params: {} };
  }

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (scope.targetId === null) {
    conditions.push('target_id IS NULL');
  } else if (scope.targetId !== undefined) {
    conditions.push('target_id = @targetId');
    params.targetId = scope.targetId;
  }

  if (scope.userUsername === null) {
    conditions.push('user_username IS NULL');
  } else if (scope.userUsername !== undefined) {
    conditions.push('user_username = @userUsername');
    params.userUsername = scope.userUsername;
  }

  return {
    clause: conditions.length > 0 ? conditions.join(' AND ') : '1=1',
    params,
  };
}

/**
 * Build scope clauses for config resolution (cascading merge).
 * Returns scope levels from least specific to most specific.
 */
export function getConfigScopeLevels(scope?: ScopeFilter): ScopeFilter[] {
  const levels: ScopeFilter[] = [
    { targetId: null, userUsername: null }, // base
  ];

  if (scope?.targetId) {
    levels.push({ targetId: scope.targetId, userUsername: null }); // target-level
  }

  if (scope?.targetId && scope?.userUsername) {
    levels.push({ targetId: scope.targetId, userUsername: scope.userUsername }); // target+user
  }

  return levels;
}

/**
 * Build WHERE clause for querying all matching policy scopes (UNION).
 * Returns policies from base + target + target+user scopes.
 */
export function buildPolicyScopeWhere(scope?: ScopeFilter): { clause: string; params: Record<string, unknown> } {
  if (!scope || (scope.targetId === undefined && scope.userUsername === undefined)) {
    return { clause: '1=1', params: {} };
  }

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  // Always include base (global) policies
  conditions.push('(target_id IS NULL AND user_username IS NULL)');

  if (scope.targetId) {
    // Include target-level policies
    conditions.push('(target_id = @targetId AND user_username IS NULL)');
    params.targetId = scope.targetId;
  }

  if (scope.targetId && scope.userUsername) {
    // Include target+user policies
    conditions.push('(target_id = @targetId AND user_username = @userUsername)');
    params.userUsername = scope.userUsername;
  }

  return {
    clause: conditions.join(' OR '),
    params,
  };
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
 * target+user > target > base
 */
export function resolveSecretScope<T extends { target_id: string | null; user_username: string | null; name: string }>(
  rows: T[],
): T[] {
  const byName = new Map<string, T>();

  // Process from least to most specific — later overwrites earlier
  const sorted = [...rows].sort((a, b) => {
    const scoreA = (a.target_id ? 1 : 0) + (a.user_username ? 1 : 0);
    const scoreB = (b.target_id ? 1 : 0) + (b.user_username ? 1 : 0);
    return scoreA - scoreB;
  });

  for (const row of sorted) {
    byName.set(row.name, row);
  }

  return Array.from(byName.values());
}
