/**
 * Passcode hashing and verification
 *
 * Uses PBKDF2 with SHA-512 for secure password hashing.
 * This is a secure alternative to bcrypt using native Node.js crypto.
 */

import * as crypto from 'node:crypto';
import type { PasscodeData } from '@agenshield/ipc';
import { getVault } from '../vault';

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
 * Check if running as root (bypass passcode)
 */
export function isRunningAsRoot(): boolean {
  return process.getuid?.() === 0;
}
