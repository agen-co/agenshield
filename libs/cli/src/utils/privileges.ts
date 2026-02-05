/**
 * Privilege detection utilities
 *
 * Detects user privileges and provides utilities for privilege-related operations.
 */

import { execSync } from 'node:child_process';
import * as os from 'node:os';

/**
 * Information about the current user's privileges
 */
export interface PrivilegeInfo {
  /** Whether running as root (UID 0) */
  isRoot: boolean;
  /** Current user ID */
  uid: number;
  /** Current group ID */
  gid: number;
  /** Current username */
  username: string;
  /** Whether the user can use sudo */
  canSudo: boolean;
  /** Whether sudo can be used without a password */
  sudoNoPassword: boolean;
}

/**
 * Detect the current user's privileges
 */
export function detectPrivileges(): PrivilegeInfo {
  const uid = process.getuid?.() ?? -1;
  const gid = process.getgid?.() ?? -1;
  const username = os.userInfo().username;
  const isRoot = uid === 0;

  // Check if user can use sudo
  let canSudo = false;
  let sudoNoPassword = false;

  if (!isRoot) {
    try {
      // Check if user is in admin/sudo group
      const groups = execSync('groups', { encoding: 'utf8' });
      canSudo = groups.includes('admin') || groups.includes('wheel') || groups.includes('sudo');

      // Check if SUDO_ASKPASS is set
      if (process.env['SUDO_ASKPASS']) {
        sudoNoPassword = true;
      }
    } catch {
      // Ignore errors
    }
  }

  return {
    isRoot,
    uid,
    gid,
    username,
    canSudo,
    sudoNoPassword,
  };
}

/**
 * Ensure sudo credentials are cached so subsequent `sudo` child-process
 * calls succeed without a TTY prompt.
 * Call this once before a batch of privileged operations.
 */
export function ensureSudoAccess(): void {
  const priv = detectPrivileges();
  if (priv.isRoot) return; // Already root, no need

  // Check if sudo credentials are already cached (non-interactive check)
  try {
    execSync('sudo -n true', { stdio: 'pipe', timeout: 5_000 });
    return; // Credentials already cached, no prompt needed
  } catch {
    // Credentials not cached — need to prompt
  }

  console.log('\nThis operation requires administrator privileges.\n');
  try {
    execSync('sudo -v', { stdio: 'inherit', timeout: 60_000 });
  } catch {
    console.error('Failed to obtain sudo access.');
    process.exit(1);
  }
}

/**
 * Start a keepalive interval that refreshes sudo credentials every 2 minutes
 * so the 5-minute sudo cache doesn't expire during long-running setup phases.
 */
export function startSudoKeepalive(): NodeJS.Timeout {
  return setInterval(() => {
    try { execSync('sudo -v', { stdio: 'pipe', timeout: 2000 }); } catch { /* ignore */ }
  }, 120_000);
}

/**
 * Commands that require root privileges
 * (Empty — no command requires root upfront anymore; sudo is requested on demand)
 */
const ROOT_COMMANDS: string[] = [];

/**
 * Check if a command requires root privileges
 */
export function requiresRoot(command: string): boolean {
  return ROOT_COMMANDS.some((c) => command.startsWith(c));
}

/**
 * Print a warning about missing privileges
 */
export function printPrivilegeWarning(command: string, priv?: PrivilegeInfo): void {
  const p = priv ?? detectPrivileges();

  console.log('\x1b[33m⚠ Warning: This command requires elevated privileges.\x1b[0m');
  console.log('');
  console.log('You are currently running as:');
  console.log(`  User: ${p.username} (UID: ${p.uid})`);
  console.log('');

  if (p.canSudo) {
    console.log('Run with sudo:');
    console.log(`  \x1b[36msudo agenshield ${command}\x1b[0m`);
  } else {
    console.log('You need administrator privileges. Either:');
    console.log('  1. Run as root user');
    console.log('  2. Add your user to the admin group');
    console.log('');
    console.log(`  \x1b[36msudo agenshield ${command}\x1b[0m`);
  }
  console.log('');
}

/**
 * Ensure the command is running with root privileges
 * Exits the process if not running as root
 */
export function ensureRoot(command: string): void {
  const priv = detectPrivileges();
  if (!priv.isRoot) {
    printPrivilegeWarning(command, priv);
    process.exit(1);
  }
}
