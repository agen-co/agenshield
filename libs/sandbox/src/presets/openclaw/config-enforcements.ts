/**
 * OpenClaw Config Enforcements
 *
 * Declarative registry of config overrides that AgenShield forces in openclaw.json.
 * Each enforcement has a human-readable title and bundles version-specific rules
 * so consumers are version-agnostic — they just enable enforcements by title.
 *
 * Rules are matched by semver range against the detected OpenClaw version.
 * Use '*' to match all versions.
 */

// ── Types ───────────────────────────────────────────────────────

/** A single JSON patch — sets a value at a dot-notation path */
export interface ConfigPatch {
  /** Dot-notation path in openclaw.json (e.g., 'skills.load.watch') */
  path: string;
  /** Value to set */
  value: unknown;
}

/** A version-specific rule within an enforcement */
export interface ConfigEnforcementRule {
  /**
   * Semver range this rule applies to.
   * - '*' matches all versions (including unknown/dev)
   * - '>=X.Y.Z', '<X.Y.Z' for version-specific rules
   * Rules are evaluated in order; the FIRST matching rule wins.
   */
  versionRange: string;
  /** Patches to apply when this rule matches */
  patches: ConfigPatch[];
}

/** A named config enforcement — the unit of override */
export interface ConfigEnforcement {
  /** Machine-readable ID (e.g., 'skills-load-watch') */
  id: string;
  /** Human-readable title (e.g., 'Load skills watch') */
  title: string;
  /** Why this enforcement exists */
  description: string;
  /** Version-specific rules — first match wins */
  rules: ConfigEnforcementRule[];
}

// ── Registry ────────────────────────────────────────────────────

/**
 * All config enforcements applied when shielding an OpenClaw target.
 * Add new entries here as AgenShield's managed policies expand.
 */
export const OPENCLAW_CONFIG_ENFORCEMENTS: ConfigEnforcement[] = [
  {
    id: 'skills-load-watch',
    title: 'Load skills watch',
    description: 'Enable file-watching for skill hot-reload managed by AgenShield',
    rules: [
      {
        versionRange: '*',
        patches: [
          { path: 'skills.load.watch', value: true },
        ],
      },
    ],
  },
  {
    id: 'skills-install-node-manager',
    title: 'Skills install node manager',
    description: 'Use npm as the default node package manager for skill installation',
    rules: [
      {
        versionRange: '*',
        patches: [
          { path: 'skills.install.nodeManager', value: 'npm' },
        ],
      },
    ],
  },
  {
    id: 'gateway-mode-local',
    title: 'Gateway mode local',
    description: 'Force local gateway mode — AgenShield manages the gateway lifecycle',
    rules: [
      {
        versionRange: '*',
        patches: [
          { path: 'gateway.mode', value: 'local' },
        ],
      },
    ],
  },
  {
    id: 'gateway-bind-loopback',
    title: 'Gateway bind loopback',
    description: 'Bind gateway to loopback only — prevents network exposure from the sandbox',
    rules: [
      {
        versionRange: '*',
        patches: [
          { path: 'gateway.bind', value: 'loopback' },
        ],
      },
    ],
  },
];

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Simple semver range check. Matches the logic in runner.ts.
 * Supports '*' (always true), '>=X.Y.Z', '>X.Y.Z', '<=X.Y.Z', '<X.Y.Z'.
 * Returns true for unknown versions (e.g., 'dev') so enforcements always apply.
 */
export function matchesVersion(version: string | undefined, range: string): boolean {
  if (range === '*') return true;
  if (!version) return true; // unknown version → apply enforcement

  const parseVersion = (v: string): number[] | null => {
    const parts = v.replace(/^v/, '').split('.').map(Number);
    if (parts.some(isNaN)) return null; // non-numeric (e.g. 'dev') → can't compare
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };

  const compare = (a: number[], b: number[]): number => {
    for (let i = 0; i < 3; i++) {
      if (a[i]! !== b[i]!) return a[i]! - b[i]!;
    }
    return 0;
  };

  const match = range.match(/^([<>]=?)(.+)$/);
  if (!match) return true;

  const [, op, rangeVer] = match;
  const v = parseVersion(version);
  const r = parseVersion(rangeVer!);
  if (!v || !r) return true; // can't parse → apply enforcement (safe default)

  const cmp = compare(v, r);
  switch (op) {
    case '>=': return cmp >= 0;
    case '>':  return cmp > 0;
    case '<=': return cmp <= 0;
    case '<':  return cmp < 0;
    default:   return true;
  }
}

/**
 * Resolve all patches for a given OpenClaw version.
 * For each enforcement, finds the first matching rule and collects its patches.
 */
export function resolveEnforcements(version: string | undefined): ConfigPatch[] {
  const patches: ConfigPatch[] = [];

  for (const enforcement of OPENCLAW_CONFIG_ENFORCEMENTS) {
    for (const rule of enforcement.rules) {
      if (matchesVersion(version, rule.versionRange)) {
        patches.push(...rule.patches);
        break; // first match wins per enforcement
      }
    }
  }

  return patches;
}

/**
 * Set a value at a dot-notation path in an object, creating intermediate objects as needed.
 */
export function setDeep(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]!] = value;
}
