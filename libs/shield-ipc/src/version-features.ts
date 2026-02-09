/**
 * OpenClaw version-based feature flags.
 *
 * Pure TypeScript utility (no Node.js deps) so it can be used
 * in both daemon and UI contexts.
 */

/**
 * Parse "2026.2.3" or "2026.2.3-3" into numeric segments.
 * Missing build number is treated as 0.
 */
export function parseVersion(version: string): number[] {
  // Split on '.' and '-' to get all numeric segments
  const parts = version.split(/[.\-]/).map(Number);
  // Pad to at least 4 segments (major.minor.patch.build)
  while (parts.length < 4) {
    parts.push(0);
  }
  return parts;
}

/**
 * Compare two version strings.
 * Supports formats: "2026.2.3", "2026.2.3-3"
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/**
 * Check if `version` is greater than or equal to `minimum`.
 * Returns false when version is null/undefined (safe backward-compat default).
 */
export function versionGte(version: string | null | undefined, minimum: string): boolean {
  if (!version) return false;
  return compareVersions(version, minimum) >= 0;
}

/**
 * Feature flag registry — add new entries as OpenClaw evolves.
 */
export const OPENCLAW_FEATURES = {
  hashTokenAuth: {
    since: '2026.2.3',
    description: 'Use #token= instead of ?token= for dashboard auth',
  },
} as const;

export type OpenClawFeatureName = keyof typeof OPENCLAW_FEATURES;

/**
 * Check whether a given OpenClaw version supports a named feature.
 * Returns false when version is null/undefined.
 */
export function hasOpenClawFeature(
  version: string | null | undefined,
  feature: OpenClawFeatureName,
): boolean {
  return versionGte(version, OPENCLAW_FEATURES[feature].since);
}
