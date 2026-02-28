/**
 * Vault Key Manager
 *
 * Manages the raw encryption key for the storage vault.
 * The key is stored at ~/.agenshield/.vault-key (32 bytes random, mode 0o600).
 * Generated at daemon startup if missing, used to unlock vault immediately.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Default key file location — under ~/.agenshield/ */
function getDefaultKeyDir(): string {
  return path.join(os.homedir(), '.agenshield');
}
const DEFAULT_KEY_FILENAME = '.vault-key';

/** Key size in bytes (256-bit for AES-256) */
const KEY_SIZE = 32;

/** Cached key instance */
let cachedKey: Buffer | null = null;

/**
 * Get the path to the vault key file
 */
export function getVaultKeyPath(
  keyDir = getDefaultKeyDir(),
  keyFilename = DEFAULT_KEY_FILENAME,
): string {
  return path.join(keyDir, keyFilename);
}

/**
 * Load or generate the vault encryption key.
 *
 * - If the key file exists, reads and caches it.
 * - If not, generates a new 32-byte random key, writes to disk (mode 0o600), and caches it.
 */
export function loadOrCreateVaultKey(
  keyDir = getDefaultKeyDir(),
  keyFilename = DEFAULT_KEY_FILENAME,
): Buffer {
  if (cachedKey) {
    return cachedKey;
  }

  const filePath = getVaultKeyPath(keyDir, keyFilename);

  if (fs.existsSync(filePath)) {
    cachedKey = fs.readFileSync(filePath);
    return cachedKey;
  }

  // Generate new key
  const key = crypto.randomBytes(KEY_SIZE);

  // Ensure directory exists
  if (!fs.existsSync(keyDir)) {
    fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  }

  // Write key file (owner-only)
  fs.writeFileSync(filePath, key, { mode: 0o600 });

  cachedKey = key;
  return cachedKey;
}

/**
 * Get the cached vault key. Throws if not yet loaded.
 */
export function getVaultKey(): Buffer {
  if (!cachedKey) {
    throw new Error('Vault key not initialized. Call loadOrCreateVaultKey() first.');
  }
  return cachedKey;
}

/**
 * Clear the cached vault key (for testing or shutdown)
 */
export function clearVaultKeyCache(): void {
  if (cachedKey) {
    cachedKey.fill(0);
  }
  cachedKey = null;
}
