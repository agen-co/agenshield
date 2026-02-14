/**
 * Post-Migration Legacy File Cleanup
 *
 * Removes deprecated JSON/JSONL files and migration markers from the
 * config directories after all data migrations have completed.
 * SQLite is the single source of truth — these files are no longer read.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Storage } from '@agenshield/storage';
import { META_KEYS } from '@agenshield/storage';
import { getConfigDir, getSystemConfigDir } from '../config/paths';

/** Files safe to delete after all migrations are complete. */
const LEGACY_FILES = [
  // Deprecated config/state — stored in SQLite
  'config.json',
  'state.json',
  // Legacy secret sync file — secrets pushed via IPC now
  'synced-secrets.json',
  // Activity log — migrated to agenshield-activity.db
  'activity.jsonl',
  // File-based migration markers — DB meta is authoritative
  '.secrets-migrated',
  '.skills-migrated',
  '.slug-prefix-disk-migrated',
  // Backup files from skill migration renames
  'approved-skills.json.migrated',
  'skill-versions.json.migrated',
  'skill-analyses.json.migrated',
  // Old backup files
  'config.json.bak',
  'state.json.bak',
  'vault.enc.bak',
];

/**
 * Remove legacy files from config directories after all migrations complete.
 * Idempotent — skips if already cleaned. Non-fatal — never throws.
 */
export function cleanupLegacyFiles(storage: Storage): void {
  try {
    // Already cleaned?
    if (storage.getMeta(META_KEYS.LEGACY_FILES_CLEANED)) {
      return;
    }

    // Wait until ALL prerequisite migrations are done
    const prerequisiteKeys = [
      META_KEYS.SKILLS_MIGRATED,
      META_KEYS.SECRETS_MIGRATED,
      META_KEYS.CONFIG_MIGRATED_TO_DB,
    ];
    for (const key of prerequisiteKeys) {
      if (!storage.getMeta(key)) {
        return;
      }
    }

    // Deduplicate directories (dev mode returns the same dir for both)
    const configDir = getConfigDir();
    const systemDir = getSystemConfigDir();
    const dirs = configDir === systemDir ? [configDir] : [configDir, systemDir];

    let deletedCount = 0;

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;

      for (const file of LEGACY_FILES) {
        const filePath = path.join(dir, file);
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[Cleanup] Deleted ${filePath}`);
            deletedCount++;
          }
        } catch (err) {
          console.warn(`[Cleanup] Failed to delete ${filePath}: ${(err as Error).message}`);
        }
      }
    }

    console.log(`[Cleanup] Cleaned up ${deletedCount} legacy file${deletedCount !== 1 ? 's' : ''}`);
    storage.setMeta(META_KEYS.LEGACY_FILES_CLEANED, new Date().toISOString());
  } catch (err) {
    console.warn(`[Cleanup] Legacy file cleanup failed: ${(err as Error).message}`);
  }
}
