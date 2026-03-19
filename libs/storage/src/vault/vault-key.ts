/**
 * Vault Key Manager
 *
 * Manages the raw encryption key for the storage vault.
 * The key is stored at ~/.agenshield/.vault-key (32 bytes random, mode 0o600).
 * Generated on first access if missing, used to unlock vault immediately.
 *
 * Shared between CLI (install command) and daemon (startup).
 * Both use the same key file so they can access the same encrypted DB.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Default key file location — under ~/.agenshield/ */
function getDefaultKeyDir(): string {
  const home = process.env['AGENSHIELD_USER_HOME'] || process.env['HOME'] || os.homedir();
  return path.join(home, '.agenshield');
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
 * Verify that the vault key file has correct permissions (0o600).
 * Fixes permissions if they are too open.
 */
function verifyKeyFilePermissions(filePath: string): void {
  try {
    const stat = fs.statSync(filePath);
    const mode = stat.mode & 0o777;
    if (mode !== 0o600) {
      fs.chmodSync(filePath, 0o600);
    }
  } catch {
    // File may not exist yet
  }
}

/**
 * Load or generate the vault encryption key.
 *
 * Priority:
 * 1. Cached in memory → return immediately
 * 2. File (~/.agenshield/.vault-key) → load from file, verify permissions
 * 3. Generate new key → write to file
 */
export function loadOrCreateVaultKey(
  keyDir = getDefaultKeyDir(),
  keyFilename = DEFAULT_KEY_FILENAME,
): Buffer {
  if (cachedKey) {
    return cachedKey;
  }

  const filePath = getVaultKeyPath(keyDir, keyFilename);

  // Try file
  if (fs.existsSync(filePath)) {
    try {
      const key = fs.readFileSync(filePath);
      if (key.length === KEY_SIZE) {
        verifyKeyFilePermissions(filePath);
        cachedKey = key;
        return cachedKey;
      }
    } catch {
      // Fall through to generate
    }
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
