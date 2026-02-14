/**
 * Profile Token File Service
 *
 * Manages broker token files on disk and provides O(1) token→profileId lookup.
 * Each target profile writes its broker token to {brokerHomeDir}/.agenshield-token
 * so the broker can read it on startup without network access.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Storage } from '@agenshield/storage';

const TOKEN_FILENAME = '.agenshield-token';

/** In-memory cache: token → profileId */
let tokenCache: Map<string, string> | null = null;

/**
 * Write the broker token file into the profile's broker home directory.
 * Creates the directory if it doesn't exist. File is mode 0o600 (owner-only).
 */
export function writeTokenFile(brokerHomeDir: string, token: string): void {
  if (!fs.existsSync(brokerHomeDir)) {
    fs.mkdirSync(brokerHomeDir, { recursive: true });
  }
  const filePath = path.join(brokerHomeDir, TOKEN_FILENAME);
  fs.writeFileSync(filePath, token + '\n', { mode: 0o600 });
}

/**
 * Remove the broker token file from a profile's broker home directory.
 */
export function removeTokenFile(brokerHomeDir: string): void {
  const filePath = path.join(brokerHomeDir, TOKEN_FILENAME);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may not exist — non-fatal
  }
}

/**
 * Read the broker token from a profile's broker home directory.
 */
export function readTokenFile(brokerHomeDir: string): string | null {
  const filePath = path.join(brokerHomeDir, TOKEN_FILENAME);
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return null;
  }
}

/**
 * Reconcile token files at startup — re-write missing files for target profiles.
 */
export function reconcileTokenFiles(storage: Storage): void {
  const profiles = storage.profiles.getByType('target');
  for (const profile of profiles) {
    if (!profile.brokerToken || !profile.brokerHomeDir) continue;
    const existing = readTokenFile(profile.brokerHomeDir);
    if (existing !== profile.brokerToken) {
      writeTokenFile(profile.brokerHomeDir, profile.brokerToken);
      console.log(`[ProfileToken] Reconciled token file for profile: ${profile.id}`);
    }
  }
}

/**
 * Build the in-memory token→profileId cache from storage.
 */
function buildCache(storage: Storage): Map<string, string> {
  const cache = new Map<string, string>();
  const profiles = storage.profiles.getByType('target');
  for (const profile of profiles) {
    if (profile.brokerToken) {
      cache.set(profile.brokerToken, profile.id);
    }
  }
  return cache;
}

/**
 * Resolve a broker token to a profileId using O(1) in-memory cache.
 * Returns null if token is not found.
 */
export function resolveProfileByToken(token: string, storage: Storage): string | null {
  if (!tokenCache) {
    tokenCache = buildCache(storage);
  }
  return tokenCache.get(token) ?? null;
}

/**
 * Invalidate the token cache (call on profile create/update/delete).
 */
export function invalidateTokenCache(): void {
  tokenCache = null;
}
