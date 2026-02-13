/**
 * Secret Migration — One-time vault.enc → SQLite migration
 *
 * Moves secrets from the encrypted vault file into SQLite.
 * After migration, secrets are cleared from vault.enc and
 * any legacy synced-secrets.json is deleted (secrets are now
 * pushed to the broker via IPC, never written to disk).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Storage } from '@agenshield/storage';
import { META_KEYS } from '@agenshield/storage';
import type { VaultSecret } from '@agenshield/ipc';
import { getVault } from '../vault';
import { getConfigDir, getSystemConfigDir } from '../config/paths';

/** Legacy file name — no longer written, cleaned up during migration */
const LEGACY_SYNCED_SECRETS_FILE = 'synced-secrets.json';

const MARKER_FILE = '.secrets-migrated';

/**
 * Run the one-time migration from vault.enc secrets to SQLite.
 * Safe to call multiple times — skips if marker exists.
 */
export async function migrateSecretsToSqlite(storage: Storage): Promise<void> {
  // Already migrated? Check DB meta first, then fallback to file marker
  if (storage.getMeta(META_KEYS.SECRETS_MIGRATED)) {
    return;
  }
  const configDir = getConfigDir();
  const markerPath = path.join(configDir, MARKER_FILE);
  if (fs.existsSync(markerPath)) {
    storage.setMeta(META_KEYS.SECRETS_MIGRATED, new Date().toISOString());
    return;
  }

  console.log('[Migration] Starting secret migration (vault.enc → SQLite)...');

  const vault = getVault();
  let secrets: VaultSecret[];

  try {
    secrets = (await vault.get('secrets')) ?? [];
  } catch (err) {
    console.warn(`[Migration] Cannot read secrets from vault.enc: ${(err as Error).message}`);
    // Write marker anyway — vault is unreadable, nothing to migrate
    writeMarker(storage);
    return;
  }

  if (secrets.length === 0) {
    console.log('[Migration] No secrets to migrate from vault.enc');
    writeMarker(storage);
    cleanupSyncFile();
    return;
  }

  let migratedCount = 0;
  let skippedCount = 0;

  for (const secret of secrets) {
    try {
      // Deduplicate by name — skip if already exists in SQLite
      const existing = storage.secrets.getByName(secret.name);
      if (existing) {
        skippedCount++;
        continue;
      }

      storage.secrets.create({
        name: secret.name,
        value: secret.value,
        scope: secret.scope ?? (secret.policyIds.length > 0 ? 'policed' : 'global'),
        policyIds: secret.policyIds,
      });
      migratedCount++;
    } catch (err) {
      console.warn(`[Migration] Failed to migrate secret "${secret.name}": ${(err as Error).message}`);
    }
  }

  console.log(`[Migration] Migrated ${migratedCount} secrets (${skippedCount} skipped as duplicates)`);

  // Clear secrets from vault.enc
  try {
    await vault.set('secrets', []);
    console.log('[Migration] Cleared secrets from vault.enc');
  } catch (err) {
    console.warn(`[Migration] Failed to clear vault.enc secrets: ${(err as Error).message}`);
  }

  // Delete old synced-secrets.json — will be regenerated from SQLite by syncSecrets()
  cleanupSyncFile();

  // Record migration in DB meta
  writeMarker(storage);
  console.log('[Migration] Secret migration complete');
}

function writeMarker(storage: Storage): void {
  try {
    storage.setMeta(META_KEYS.SECRETS_MIGRATED, new Date().toISOString());
  } catch (err) {
    console.warn(`[Migration] Failed to write migration marker: ${(err as Error).message}`);
  }
}

function cleanupSyncFile(): void {
  try {
    const syncPath = path.join(getSystemConfigDir(), LEGACY_SYNCED_SECRETS_FILE);
    if (fs.existsSync(syncPath)) {
      fs.unlinkSync(syncPath);
      console.log('[Migration] Deleted old synced-secrets.json');
    }
  } catch (err) {
    console.warn(`[Migration] Failed to delete synced-secrets.json: ${(err as Error).message}`);
  }
}
