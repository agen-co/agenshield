/**
 * Profile Token File Service
 *
 * Manages broker JWT token files on disk and provides O(1) token→profileId lookup.
 * Each target profile writes its broker JWT to {brokerHomeDir}/.agenshield-token
 * so the broker can read it on startup without network access.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Storage } from '@agenshield/storage';
import { signBrokerToken, verifyToken } from '@agenshield/auth';

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
 * Reconcile token files at startup — regenerate broker JWTs for all profiles.
 */
export async function reconcileTokenFiles(storage: Storage): Promise<void> {
  const profiles = storage.profiles.getByType('target');
  for (const profile of profiles) {
    if (!profile.brokerHomeDir) continue;

    // Generate a new broker JWT for each profile
    const brokerJwt = await signBrokerToken(profile.id, profile.id);

    // Update the stored broker token
    storage.profiles.update(profile.id, { brokerToken: brokerJwt });

    // Write the JWT to the token file
    writeTokenFile(profile.brokerHomeDir, brokerJwt);
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
 * Resolve a broker token to a profileId.
 * First tries O(1) cache lookup, then falls back to JWT verification.
 * Returns null if token is not found or invalid.
 */
export async function resolveProfileByToken(token: string, storage: Storage): Promise<string | null> {
  // Try cache first
  if (!tokenCache) {
    tokenCache = buildCache(storage);
  }
  const cached = tokenCache.get(token);
  if (cached) return cached;

  // Fall back to JWT verification
  const result = await verifyToken(token);
  if (result.valid && result.payload?.role === 'broker') {
    const profileId = result.payload.sub;
    // Warm the cache
    tokenCache.set(token, profileId);
    return profileId;
  }

  return null;
}

/**
 * Invalidate the token cache (call on profile create/update/delete).
 */
export function invalidateTokenCache(): void {
  tokenCache = null;
}
