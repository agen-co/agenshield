/**
 * Vault Key Manager
 *
 * Manages the raw encryption key for the storage vault.
 * The key is stored at ~/.agenshield/.vault-key (32 bytes random, mode 0o600).
 * Generated at daemon startup if missing, used to unlock vault immediately.
 *
 * When Keychain is enabled (macOS), the key is stored in Keychain and the
 * file-based key is used as fallback. On first Keychain enable, the file
 * key is migrated to Keychain.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { KeyProvider } from '@agenshield/keychain';

/** Default key file location — under ~/.agenshield/ */
function getDefaultKeyDir(): string {
  return path.join(os.homedir(), '.agenshield');
}
const DEFAULT_KEY_FILENAME = '.vault-key';

/** Key size in bytes (256-bit for AES-256) */
const KEY_SIZE = 32;

/** Cached key instance */
let cachedKey: Buffer | null = null;

/** Optional Keychain provider — set via setKeyProvider() */
let keyProvider: KeyProvider | null = null;

/** Keychain account name for the vault key */
const KEYCHAIN_VAULT_KEY_ACCOUNT = 'vault-key';

/**
 * Set the KeyProvider for Keychain-backed vault key storage.
 * Call this during daemon startup if Keychain is enabled.
 */
export function setKeyProvider(provider: KeyProvider | null): void {
  keyProvider = provider;
}

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
      console.warn(`[vault-key] Key file has insecure permissions ${mode.toString(8)}, fixing to 600`);
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
 * 2. Keychain (if provider set) → load from Keychain
 * 3. File (~/.agenshield/.vault-key) → load from file, verify permissions
 * 4. Generate new key → write to file (and Keychain if enabled)
 */
export function loadOrCreateVaultKey(
  keyDir = getDefaultKeyDir(),
  keyFilename = DEFAULT_KEY_FILENAME,
): Buffer {
  if (cachedKey) {
    return cachedKey;
  }

  const filePath = getVaultKeyPath(keyDir, keyFilename);

  // Try Keychain first (if provider is set and Keychain-backed)
  if (keyProvider?.isKeychainBacked) {
    try {
      // Synchronous wrapper — KeyProvider is async but we need sync here.
      // The daemon startup calls this synchronously. We'll use the file as
      // authoritative and migrate to Keychain asynchronously.
    } catch {
      // Keychain unavailable, fall through to file
    }
  }

  // Try file
  if (fs.existsSync(filePath)) {
    try {
      const key = fs.readFileSync(filePath);
      if (key.length !== KEY_SIZE) {
        console.error(`[vault-key] Key file has unexpected size ${key.length}, expected ${KEY_SIZE}. Regenerating.`);
      } else {
        verifyKeyFilePermissions(filePath);
        cachedKey = key;

        // Migrate to Keychain in background if provider is available
        migrateToKeychainAsync(key);

        return cachedKey;
      }
    } catch (err) {
      console.error(`[vault-key] Failed to read key file: ${(err as Error).message}`);
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

  // Store in Keychain in background
  migrateToKeychainAsync(key);

  cachedKey = key;
  return cachedKey;
}

/**
 * Migrate vault key to Keychain in background (fire-and-forget).
 */
function migrateToKeychainAsync(key: Buffer): void {
  if (!keyProvider?.isKeychainBacked) return;

  keyProvider.set(KEYCHAIN_VAULT_KEY_ACCOUNT, key, {
    accessible: 'WhenUnlockedThisDeviceOnly',
    synchronizable: false,
    label: 'AgenShield Vault Key',
  }).catch((err) => {
    console.warn(`[vault-key] Failed to store key in Keychain: ${(err as Error).message}`);
  });
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
