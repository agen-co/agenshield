/**
 * Encryption utilities for AgenShield storage
 *
 * - Column-level AES-256-GCM encryption for vault data
 * - scrypt key derivation from passcode
 * - PBKDF2-SHA512 for passcode verification hash
 */

import * as crypto from 'node:crypto';

const SCRYPT_KEY_LEN = 32;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const AES_ALGORITHM = 'aes-256-gcm' as const;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LEN = 64;
const PBKDF2_DIGEST = 'sha512';

/**
 * Derive a 32-byte AES encryption key from a passcode + salt using scrypt.
 */
export function deriveKey(passcode: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passcode, salt, SCRYPT_KEY_LEN, SCRYPT_PARAMS);
}

/**
 * Generate a random 32-byte salt.
 */
export function generateSalt(): Buffer {
  return crypto.randomBytes(32);
}

/**
 * Create a PBKDF2-SHA512 hash of the passcode for verification.
 * Stored in the meta table — NOT used for encryption.
 */
export function hashPasscode(passcode: string, salt: Buffer): string {
  const hash = crypto.pbkdf2Sync(passcode, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LEN, PBKDF2_DIGEST);
  return hash.toString('hex');
}

/**
 * Verify a passcode against a stored PBKDF2 hash.
 */
export function verifyPasscode(passcode: string, salt: Buffer, storedHash: string): boolean {
  const hash = hashPasscode(passcode, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns base64-encoded string: iv + authTag + ciphertext
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: iv (12) + authTag (16) + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypt a base64-encoded AES-256-GCM ciphertext.
 */
export function decrypt(ciphertext: string, key: Buffer): string {
  const packed = Buffer.from(ciphertext, 'base64');

  if (packed.length < IV_LEN + AUTH_TAG_LEN) {
    throw new Error('Invalid ciphertext: too short');
  }

  const iv = packed.subarray(0, IV_LEN);
  const authTag = packed.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const encrypted = packed.subarray(IV_LEN + AUTH_TAG_LEN);

  const decipher = crypto.createDecipheriv(AES_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Derive a machine-specific encryption key (legacy fallback for migration).
 * Uses hostname + username as a deterministic seed.
 */
export function deriveMachineKey(): Buffer {
  const hostname = require('node:os').hostname();
  const username = require('node:os').userInfo().username;
  const seed = `agenshield:${hostname}:${username}`;
  return crypto.createHash('sha256').update(seed).digest();
}
