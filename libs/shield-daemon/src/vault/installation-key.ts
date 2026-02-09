/**
 * Installation Key Manager
 *
 * Generates and manages a unique per-installation key used to tag skills
 * installed by this AgenShield instance. The key is stored encrypted in the vault
 * and embedded as a tag (agenshield-{key}) in SKILL.md frontmatter during installation.
 * The skills watcher uses this tag to verify provenance before quarantining.
 */

import * as crypto from 'node:crypto';
import { getVault } from './index';

const INSTALLATION_KEY_PREFIX = 'agenshield-';

/** In-memory cache to avoid repeated vault reads and enable sync access from watcher */
let cachedKey: string | null = null;

/**
 * Get or generate the installation key.
 * Generates a random 32-byte hex key on first call, stores in vault.
 * Subsequent calls return the cached/stored value.
 */
export async function getInstallationKey(): Promise<string> {
  if (cachedKey) return cachedKey;

  const vault = getVault();
  const contents = await vault.load();

  if (contents.installationKey) {
    cachedKey = contents.installationKey;
    return cachedKey;
  }

  // Generate a new random key (32 bytes = 64 hex chars)
  const key = crypto.randomBytes(32).toString('hex');
  await vault.set('installationKey', key);
  cachedKey = key;

  console.log('[InstallationKey] Generated new installation key');
  return key;
}

/**
 * Build the full tag string for embedding in skill.md frontmatter.
 * Format: "agenshield-{key}"
 */
export async function getInstallationTag(): Promise<string> {
  const key = await getInstallationKey();
  return `${INSTALLATION_KEY_PREFIX}${key}`;
}

/**
 * Synchronous check if a tags array contains a valid installation tag.
 * Uses the in-memory cached key — returns false if key hasn't been loaded yet.
 * Must call getInstallationKey() at startup to populate the cache.
 */
export function hasValidInstallationTagSync(tags: string[]): boolean {
  if (!cachedKey) return false;
  const fullTag = `${INSTALLATION_KEY_PREFIX}${cachedKey}`;
  return tags.some((tag) => tag === fullTag);
}

/**
 * Clear the in-memory cache (for testing).
 */
export function clearInstallationKeyCache(): void {
  cachedKey = null;
}
