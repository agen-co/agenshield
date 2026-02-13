/**
 * Source-prefixed slugs
 *
 * External skill sources (synced via SyncService) get a short prefix in their
 * slug to prevent namespace collisions between registries.
 *
 * Prefix mapping:
 *   ag = AgentFront (MCP/AgenCo integrations, source adapter ID "mcp")
 *   cb = ClawHub    (marketplace, source adapter ID "registry")
 *
 * Manual uploads (source='manual') and watcher-detected skills stay unprefixed.
 */

/** Map from source adapter ID → slug prefix. */
export const SOURCE_SLUG_PREFIX: Record<string, string> = {
  mcp: 'ag',
  registry: 'cb',
};

/**
 * Prepend the source prefix to a raw slug.
 * Idempotent: if the slug already has the correct prefix, returns as-is.
 */
export function prefixSlug(sourceId: string, rawSlug: string): string {
  const prefix = SOURCE_SLUG_PREFIX[sourceId];
  if (!prefix) return rawSlug;
  const full = `${prefix}-${rawSlug}`;
  if (rawSlug === full || rawSlug.startsWith(`${prefix}-`)) return rawSlug;
  return full;
}

/**
 * Strip a known source prefix from a slug.
 * Returns the prefix and raw slug, or null if no known prefix was found.
 */
export function stripSlugPrefix(slug: string): { prefix: string; rawSlug: string } | null {
  for (const [, prefix] of Object.entries(SOURCE_SLUG_PREFIX)) {
    const token = `${prefix}-`;
    if (slug.startsWith(token)) {
      return { prefix, rawSlug: slug.slice(token.length) };
    }
  }
  return null;
}

/**
 * Whether a source adapter ID has a registered slug prefix.
 */
export function sourceHasPrefix(sourceId: string): boolean {
  return sourceId in SOURCE_SLUG_PREFIX;
}
