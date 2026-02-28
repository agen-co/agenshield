/**
 * Source-prefixed slugs (DEPRECATED)
 *
 * Slug prefixes have been removed. Skills now use raw names everywhere
 * and track their source via the `sourceOrigin` field in the DB.
 *
 * These functions are kept as no-ops for backward compatibility during
 * the transition period. All callers should stop using them.
 */

import type { SourceOrigin } from './skills.types';

/** @deprecated Slug prefixes are no longer used. Kept for reference. */
export const SOURCE_SLUG_PREFIX: Record<string, string> = {
  mcp: 'ag',
  registry: 'cb',
};

/**
 * @deprecated No-op. Returns rawSlug unchanged. Slug prefixes are no longer applied.
 */
export function prefixSlug(_sourceId: string, rawSlug: string): string {
  return rawSlug;
}

/**
 * @deprecated Always returns null. Slug prefixes are no longer used.
 */
export function stripSlugPrefix(_slug: string): { prefix: string; rawSlug: string } | null {
  return null;
}

/**
 * @deprecated Always returns false. Slug prefixes are no longer used.
 */
export function sourceHasPrefix(_sourceId: string): boolean {
  return false;
}

/**
 * Map a source adapter ID to a SourceOrigin value.
 * Use this instead of slug prefixes to track where a skill came from.
 */
export function resolveSourceOrigin(sourceId: string): SourceOrigin {
  const mapping: Record<string, SourceOrigin> = {
    mcp: 'mcp',
    registry: 'registry',
    openclaw: 'openclaw',
    clawhub: 'clawhub',
    local: 'local',
    manual: 'manual',
  };
  return mapping[sourceId] ?? 'unknown';
}
