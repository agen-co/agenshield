/**
 * Slug-prefix disk migration
 *
 * One-time rename of on-disk skill folders from unprefixed to prefixed slugs.
 * Runs after the DB migration (004-slug-prefix) has already updated slug values.
 * Gated by a marker file to ensure it only runs once.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Storage } from '@agenshield/storage';
import { META_KEYS } from '@agenshield/storage';
import { getConfigDir } from '../config/paths';

const MARKER_FILE = '.slug-prefix-disk-migrated';

/**
 * Rename old (unprefixed) skill folders to their new prefixed names.
 * Safe to call multiple times — skips if marker file exists.
 */
export function migrateSlugPrefixDisk(storage: Storage, skillsDir: string): void {
  // Already migrated? Check DB meta first, then fallback to file marker
  if (storage.getMeta(META_KEYS.SLUG_PREFIX_DISK_MIGRATED)) {
    return;
  }
  const configDir = getConfigDir();
  const markerPath = path.join(configDir, MARKER_FILE);
  if (fs.existsSync(markerPath)) {
    storage.setMeta(META_KEYS.SLUG_PREFIX_DISK_MIGRATED, new Date().toISOString());
    return;
  }

  const PREFIX_MAP: Record<string, string> = {
    mcp: 'ag-',
    registry: 'cb-',
  };

  const skills = storage.skills;
  const integrationSkills = skills.getAll({ source: 'integration' });
  let renamed = 0;

  for (const skill of integrationSkills) {
    if (!skill.remoteId) continue;

    const prefix = PREFIX_MAP[skill.remoteId];
    if (!prefix) continue;

    // The DB slug is already prefixed (from migration 004).
    // Derive the old unprefixed slug by stripping the prefix.
    if (!skill.slug.startsWith(prefix)) continue;
    const oldSlug = skill.slug.slice(prefix.length);

    const oldDir = path.join(skillsDir, oldSlug);
    const newDir = path.join(skillsDir, skill.slug);

    // Only rename if old folder exists and new one doesn't
    if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
      try {
        fs.renameSync(oldDir, newDir);
        renamed++;
      } catch (err) {
        console.warn(`[slug-prefix-disk] Failed to rename ${oldDir} → ${newDir}: ${(err as Error).message}`);
      }
    }
  }

  if (renamed > 0) {
    console.log(`[slug-prefix-disk] Renamed ${renamed} skill folder(s)`);
  }

  // Record migration in DB meta
  try {
    storage.setMeta(META_KEYS.SLUG_PREFIX_DISK_MIGRATED, new Date().toISOString());
  } catch (err) {
    console.warn(`[slug-prefix-disk] Failed to write migration marker: ${(err as Error).message}`);
  }
}
