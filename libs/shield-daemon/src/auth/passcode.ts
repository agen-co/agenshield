/**
 * Passcode hashing and verification
 *
 * Uses PBKDF2 with SHA-512 for secure password hashing.
 * This is a secure alternative to bcrypt using native Node.js crypto.
 */

import * as crypto from 'node:crypto';
import type { PasscodeData } from '@agenshield/ipc';
import { getVault } from '../vault';
import { loadState, updatePasscodeProtectionState } from '../state';
import { DEFAULT_AUTH_CONFIG } from '@agenshield/ipc';

// PBKDF2 configuration
const ITERATIONS = 100000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';
const SALT_LENGTH = 16;

/**
 * Hash a passcode using PBKDF2
 */
export function hashPasscode(passcode: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_LENGTH);
    crypto.pbkdf2(passcode, salt, ITERATIONS, KEY_LENGTH, DIGEST, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      // Store as: iterations:salt:hash (all base64)
      const hash = `${ITERATIONS}:${salt.toString('base64')}:${derivedKey.toString('base64')}`;
      resolve(hash);
    });
  });
}

/**
 * Verify a passcode against a hash
 */
export function verifyPasscode(passcode: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const parts = storedHash.split(':');
    if (parts.length !== 3) {
      resolve(false);
      return;
    }

    const iterations = parseInt(parts[0], 10);
    const salt = Buffer.from(parts[1], 'base64');
    const hash = Buffer.from(parts[2], 'base64');

    crypto.pbkdf2(passcode, salt, iterations, hash.length, DIGEST, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(crypto.timingSafeEqual(hash, derivedKey));
    });
  });
}

/**
 * Check if a passcode has been set
 */
export async function isPasscodeSet(): Promise<boolean> {
  const vault = getVault();
  const passcodeData = await vault.get('passcode');
  return passcodeData !== undefined && passcodeData.hash !== undefined;
}

/**
 * Get passcode data from vault
 */
export async function getPasscodeData(): Promise<PasscodeData | undefined> {
  const vault = getVault();
  return vault.get('passcode');
}

/**
 * Set a new passcode
 */
export async function setPasscode(passcode: string): Promise<void> {
  const vault = getVault();
  const existingData = await vault.get('passcode');
  const hash = await hashPasscode(passcode);
  const now = new Date().toISOString();

  const passcodeData: PasscodeData = {
    hash,
    setAt: existingData?.setAt || now,
    changedAt: existingData?.setAt ? now : undefined,
  };

  await vault.set('passcode', passcodeData);
}

/**
 * Verify the provided passcode
 * Returns true if passcode is correct
 */
export async function checkPasscode(passcode: string): Promise<boolean> {
  const passcodeData = await getPasscodeData();
  if (!passcodeData) {
    return false;
  }

  return verifyPasscode(passcode, passcodeData.hash);
}

/**
 * Check if protection is enabled
 */
export function isProtectionEnabled(): boolean {
  const state = loadState();
  return state.passcodeProtection?.enabled ?? false;
}

/**
 * Enable or disable passcode protection
 */
export function setProtectionEnabled(enabled: boolean): void {
  updatePasscodeProtectionState({ enabled });
}

/**
 * Check if anonymous read-only access is allowed
 * Returns true by default if not explicitly set
 */
export function isAnonymousReadOnlyAllowed(): boolean {
  const state = loadState();
  return state.passcodeProtection?.allowAnonymousReadOnly ?? true;
}

/**
 * Set anonymous read-only access
 */
export function setAnonymousReadOnly(allowed: boolean): void {
  updatePasscodeProtectionState({ allowAnonymousReadOnly: allowed });
}

/**
 * Check if authentication is locked out
 */
export function isLockedOut(): { locked: boolean; lockedUntil?: string } {
  const state = loadState();
  const protection = state.passcodeProtection;

  if (!protection?.lockedUntil) {
    return { locked: false };
  }

  const lockoutEnd = new Date(protection.lockedUntil).getTime();
  if (Date.now() >= lockoutEnd) {
    // Lockout has expired, clear it
    updatePasscodeProtectionState({ lockedUntil: undefined, failedAttempts: 0 });
    return { locked: false };
  }

  return { locked: true, lockedUntil: protection.lockedUntil };
}

/**
 * Record a failed authentication attempt
 * Returns the number of remaining attempts before lockout
 */
export function recordFailedAttempt(): number {
  const state = loadState();
  const protection = state.passcodeProtection || { enabled: true };
  const currentAttempts = (protection.failedAttempts || 0) + 1;

  if (currentAttempts >= DEFAULT_AUTH_CONFIG.maxFailedAttempts) {
    // Lock out the account
    const lockedUntil = new Date(Date.now() + DEFAULT_AUTH_CONFIG.lockoutDurationMs).toISOString();
    updatePasscodeProtectionState({
      failedAttempts: currentAttempts,
      lockedUntil,
    });
    return 0;
  }

  updatePasscodeProtectionState({ failedAttempts: currentAttempts });
  return DEFAULT_AUTH_CONFIG.maxFailedAttempts - currentAttempts;
}

/**
 * Clear failed attempts on successful authentication
 */
export function clearFailedAttempts(): void {
  updatePasscodeProtectionState({ failedAttempts: 0, lockedUntil: undefined });
}

/**
 * Check if running as root (bypass passcode)
 */
export function isRunningAsRoot(): boolean {
  return process.getuid?.() === 0;
}
