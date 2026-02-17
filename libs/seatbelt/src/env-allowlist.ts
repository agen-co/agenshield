/**
 * Base environment variable allowlist for sandboxed child processes.
 *
 * When seatbelt wrapping is active, only variables matching this list
 * (plus per-policy envAllow extensions) are copied from process.env
 * into the child's environment. Everything else is stripped.
 *
 * Entries ending with '*' are treated as prefix patterns:
 *   'LC_*' matches LC_ALL, LC_CTYPE, LC_MESSAGES, etc.
 *
 * Variables added via envInjection (proxy vars, secrets) bypass this
 * list entirely since they are explicitly injected after filtering.
 */
export const BASE_ENV_ALLOWLIST: readonly string[] = [
  // Identity & paths
  'HOME',
  'USER',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TMPDIR',

  // Terminal & locale
  'TERM',
  'COLORTERM',
  'LANG',
  'LC_*',

  // macOS system
  'XPC_FLAGS',
  'XPC_SERVICE_NAME',
  '__CF_USER_TEXT_ENCODING',

  // Shell
  'SHLVL',

  // Toolchain
  'NVM_DIR',
  'HOMEBREW_PREFIX',
  'HOMEBREW_CELLAR',
  'HOMEBREW_REPOSITORY',

  // SSH (auth socket only — NOT SSH_ASKPASS)
  'SSH_AUTH_SOCK',

  // AgenShield variables
  'AGENSHIELD_*',

  'NODE_OPTIONS',
] as const;

/**
 * Filter an environment through the base allowlist + per-policy extensions.
 *
 * @param sourceEnv   The source environment (typically process.env)
 * @param policyAllow Additional variable names/patterns from per-policy envAllow
 * @returns A new object containing only allowed variables
 */
export function filterEnvByAllowlist(
  sourceEnv: Record<string, string | undefined>,
  policyAllow: string[] = [],
): Record<string, string> {
  const patterns = [...BASE_ENV_ALLOWLIST, ...policyAllow];
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(sourceEnv)) {
    if (value === undefined) continue;
    if (matchesAllowlist(key, patterns)) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Check if a variable name matches any pattern in the allowlist.
 * Patterns ending with '*' are prefix matches; others are exact.
 */
function matchesAllowlist(key: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (key.startsWith(prefix)) return true;
    } else {
      if (key === pattern) return true;
    }
  }
  return false;
}
