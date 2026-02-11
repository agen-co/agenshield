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
export declare function parseVersion(version: string): number[];
/**
 * Compare two version strings.
 * Supports formats: "2026.2.3", "2026.2.3-3"
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export declare function compareVersions(a: string, b: string): -1 | 0 | 1;
/**
 * Check if `version` is greater than or equal to `minimum`.
 * Returns false when version is null/undefined (safe backward-compat default).
 */
export declare function versionGte(version: string | null | undefined, minimum: string): boolean;
/**
 * Feature flag registry — add new entries as OpenClaw evolves.
 */
export declare const OPENCLAW_FEATURES: {
    readonly hashTokenAuth: {
        readonly since: "2026.2.3";
        readonly description: "Use #token= instead of ?token= for dashboard auth";
    };
};
export type OpenClawFeatureName = keyof typeof OPENCLAW_FEATURES;
/**
 * Check whether a given OpenClaw version supports a named feature.
 * Returns false when version is null/undefined.
 */
export declare function hasOpenClawFeature(version: string | null | undefined, feature: OpenClawFeatureName): boolean;
//# sourceMappingURL=version-features.d.ts.map