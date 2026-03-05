/**
 * Host user detection for root/sudo execution contexts.
 *
 * When the CLI runs as root (via sudo or MDM), os.homedir() returns /var/root.
 * This module resolves the actual human user's home directory so that all
 * installation artifacts land in the correct location.
 *
 * Resolution order (only when running as UID 0):
 *   1. AGENSHIELD_USER_HOME env var (explicit override)
 *   2. SUDO_USER env var (set by sudo)
 *   3. macOS console user via stat -f "%Su" /dev/console
 *   4. Fallback: os.homedir()
 *
 * When NOT running as root, returns os.homedir() unchanged.
 */

import { execSync } from 'node:child_process';
import * as os from 'node:os';

interface HostUser {
  username: string;
  home: string;
}

let cached: HostUser | undefined;

/**
 * Resolve the actual human user, even when running as root.
 */
export function resolveHostUser(): HostUser {
  if (cached) return cached;

  // Not root — return current user (no detection needed)
  if (process.getuid?.() !== 0) {
    cached = { username: os.userInfo().username, home: os.homedir() };
    return cached;
  }

  // 1. Explicit override via env var
  const envHome = process.env['AGENSHIELD_USER_HOME'];
  if (envHome) {
    const match = envHome.match(/\/Users\/([^/]+)/);
    const username = match ? match[1] : os.userInfo().username;
    cached = { username, home: envHome };
    return cached;
  }

  // 2. SUDO_USER env var (set by sudo)
  const sudoUser = process.env['SUDO_USER'];
  if (sudoUser) {
    try {
      const home = execSync(`eval echo ~${sudoUser}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3_000,
      }).trim();
      if (home && home !== '~' + sudoUser) {
        cached = { username: sudoUser, home };
        return cached;
      }
    } catch { /* fall through */ }
    // Fallback: assume /Users/<sudoUser> on macOS
    if (os.platform() === 'darwin') {
      cached = { username: sudoUser, home: `/Users/${sudoUser}` };
      return cached;
    }
  }

  // 3. macOS console user (active GUI login session)
  if (os.platform() === 'darwin') {
    try {
      const consoleUser = execSync('stat -f "%Su" /dev/console', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3_000,
      }).trim();
      if (consoleUser && consoleUser !== 'root') {
        cached = { username: consoleUser, home: `/Users/${consoleUser}` };
        return cached;
      }
    } catch { /* fall through */ }
  }

  // 4. Fallback
  cached = { username: os.userInfo().username, home: os.homedir() };
  return cached;
}

/**
 * Shorthand: resolve the host user's home directory.
 */
export function resolveHostHome(): string {
  return resolveHostUser().home;
}
