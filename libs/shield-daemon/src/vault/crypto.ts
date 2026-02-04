/**
 * Cryptographic utilities for vault encryption
 */

import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import * as os from 'node:os';

/**
 * Get machine-specific identifier for key derivation
 * Uses hardware UUID, hostname, and user info to create a unique identifier
 */
export function getMachineId(): string {
  const hostname = os.hostname();
  const platform = process.platform;
  const arch = process.arch;
  const userInfo = os.userInfo();

  // On macOS, also include hardware UUID for stronger binding
  let hardwareUUID = '';
  if (platform === 'darwin') {
    try {
      const output = execSync(
        'ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      // Extract the UUID from the output
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (match) {
        hardwareUUID = match[1];
      }
    } catch {
      // Fallback if command fails - will still work but less secure
    }
  }

  const data = `${hostname}-${platform}-${arch}-${userInfo.username}-${hardwareUUID}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Derive encryption key from machine ID using scrypt
 */
export function deriveKey(machineId: string): Buffer {
  // Use a fixed salt for deterministic key derivation
  // The salt doesn't need to be secret - it just needs to be consistent
  const salt = 'agenshield-vault-v1';
  return crypto.scryptSync(machineId, salt, 32);
}

/**
 * Encrypt data using AES-256-GCM
 * @param data - Plaintext data to encrypt
 * @param key - 32-byte encryption key
 * @returns Encrypted data in format: iv:authTag:ciphertext (base64 encoded)
 */
export function encrypt(data: string, key: Buffer): string {
  // Generate random IV for each encryption
  const iv = crypto.randomBytes(16);

  // Create cipher
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  // Encrypt data
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  // Get authentication tag
  const authTag = cipher.getAuthTag();

  // Return format: iv:authTag:encrypted
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt data using AES-256-GCM
 * @param encryptedData - Encrypted data in format: iv:authTag:ciphertext
 * @param key - 32-byte encryption key
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export function decrypt(encryptedData: string, key: Buffer): string {
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const [ivB64, authTagB64, encrypted] = parts;

  // Decode base64 values
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');

  // Create decipher
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  // Decrypt data
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
