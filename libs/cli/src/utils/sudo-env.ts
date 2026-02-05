/**
 * Utilities for capturing the calling user's environment when running under sudo.
 *
 * When the CLI is invoked via `sudo`, process.env reflects root's sanitized
 * environment. This module re-captures the *original* user's login environment
 * so that security scanning can detect secrets like OPENAI_API_KEY that exist
 * in the calling user's shell but are stripped by sudo.
 */

import { execSync } from 'node:child_process';

/** Cached result (undefined = not yet computed) */
let cachedUserEnv: Record<string, string> | null | undefined;

/**
 * Capture the calling user's login environment via `sudo -iu $SUDO_USER env`.
 *
 * Returns a parsed KEY=VALUE map of the user's environment, or `null` if:
 * - Not running under sudo (SUDO_USER is unset)
 * - The capture command fails or times out
 *
 * The result is cached after the first call since spawning a shell costs ~200-500ms.
 */
export function captureCallingUserEnv(): Record<string, string> | null {
  if (cachedUserEnv !== undefined) {
    return cachedUserEnv;
  }

  const sudoUser = process.env['SUDO_USER'];
  if (!sudoUser) {
    cachedUserEnv = null;
    return null;
  }

  try {
    const output = execSync(`sudo -iu ${sudoUser} env`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });

    const env: Record<string, string> = {};
    for (const line of output.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const key = line.slice(0, idx);
        const value = line.slice(idx + 1);
        env[key] = value;
      }
    }

    cachedUserEnv = env;
    return env;
  } catch {
    cachedUserEnv = null;
    return null;
  }
}

/**
 * Return the most representative environment for security scanning.
 *
 * Under sudo, returns the calling user's captured environment so secret
 * detection works against the real user's shell variables. Otherwise
 * falls back to `process.env`.
 */
export function getEffectiveEnvForScanning(): Record<string, string | undefined> {
  return captureCallingUserEnv() ?? process.env;
}
