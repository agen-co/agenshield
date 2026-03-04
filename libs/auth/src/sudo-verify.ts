/**
 * Sudo password verification (macOS)
 *
 * Verifies a user's password using the macOS `dscl` command.
 * Rate-limited to prevent brute-force attacks.
 */

import { execFile, execSync } from 'node:child_process';
import { RateLimitError } from './errors';
import type { SudoVerifyResult } from './types';

/** Maximum attempts before rate limiting */
const MAX_ATTEMPTS = 5;

/** Rate limit window in milliseconds (15 minutes) */
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Track login attempts: timestamp of each attempt */
const attempts: number[] = [];

/**
 * Check rate limit state. Throws RateLimitError if too many attempts.
 */
function checkRateLimit(): void {
  const now = Date.now();
  // Remove attempts outside the window
  while (attempts.length > 0 && attempts[0] < now - RATE_LIMIT_WINDOW_MS) {
    attempts.shift();
  }

  if (attempts.length >= MAX_ATTEMPTS) {
    const oldestInWindow = attempts[0];
    const retryAfterMs = oldestInWindow + RATE_LIMIT_WINDOW_MS - now;
    throw new RateLimitError(retryAfterMs);
  }
}

/**
 * Record an attempt for rate limiting
 */
function recordAttempt(): void {
  attempts.push(Date.now());
}

/**
 * Verify a user's password using macOS dscl.
 *
 * @param username The macOS username
 * @param password The password to verify
 * @returns SudoVerifyResult with validity and username
 * @throws RateLimitError if too many attempts in the window
 */
export async function verifySudoPassword(
  username: string,
  password: string,
): Promise<SudoVerifyResult> {
  checkRateLimit();
  recordAttempt();

  return new Promise<SudoVerifyResult>((resolve) => {
    execFile(
      '/usr/bin/dscl',
      ['.', '-authonly', username, password],
      { timeout: 10000 },
      (error) => {
        if (error) {
          resolve({ valid: false, username });
        } else {
          // Clear attempts on success
          attempts.length = 0;
          resolve({ valid: true, username });
        }
      },
    );
  });
}

/**
 * Get the current macOS username.
 * When running as root (e.g. via LaunchDaemon), detects the console user
 * so that sudo-login verifies against the correct account.
 */
export function getCurrentUsername(): string {
  if (process.env.SUDO_USER) return process.env.SUDO_USER;
  if (process.platform === 'darwin') {
    try {
      const consoleUser = execSync('stat -f "%Su" /dev/console', { encoding: 'utf-8', timeout: 3_000 }).trim();
      if (consoleUser && consoleUser !== 'root') return consoleUser;
    } catch { /* fall through */ }
  }
  return process.env.USER || 'unknown';
}

/**
 * Reset rate limit state (for testing)
 */
export function resetRateLimit(): void {
  attempts.length = 0;
}
