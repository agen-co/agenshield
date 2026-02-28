/**
 * Migration 023 — Remove source prefixes from skill slugs
 *
 * Skills had prefixed slugs (e.g. 'oc-gog', 'ag-agenco', 'ch-my-skill').
 * This migration:
 * 1. Adds a `source_origin` column to track where a skill came from
 * 2. Populates source_origin from existing slug prefixes
 * 3. Strips prefixes to leave raw slugs
 * 4. Updates folder_path in skill_versions to reflect renamed slugs
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class RemoveSlugPrefixMigration implements Migration {
  readonly version = 23;
  readonly name = '023-remove-slug-prefix';

  up(db: Database.Database): void {
    // 1. Add source_origin column (skip if already present — fresh DBs include it in 001)
    const columns = (db.prepare("PRAGMA table_info('skills')").all() as Array<{ name: string }>).map(c => c.name);
    if (!columns.includes('source_origin')) {
      db.exec(`ALTER TABLE skills ADD COLUMN source_origin TEXT NOT NULL DEFAULT 'unknown'`);
    }

    // 2. Populate from existing prefixes
    db.exec(`UPDATE skills SET source_origin = 'openclaw' WHERE slug LIKE 'oc-%'`);
    db.exec(`UPDATE skills SET source_origin = 'clawhub' WHERE slug LIKE 'ch-%'`);
    db.exec(`UPDATE skills SET source_origin = 'local' WHERE slug LIKE 'lo-%'`);
    db.exec(`UPDATE skills SET source_origin = 'mcp' WHERE slug LIKE 'ag-%'`);
    db.exec(`UPDATE skills SET source_origin = 'registry' WHERE slug LIKE 'cb-%'`);

    // 3. Strip known 2-char prefixes from slugs (oc-, ch-, lo-, ag-, cb-)
    // Only strip when source_origin was set (i.e. a known prefix was found)
    db.exec(`UPDATE skills SET slug = SUBSTR(slug, 4) WHERE source_origin != 'unknown'`);

    // 4. Update folder_path in skill_versions to reflect renamed slugs
    // folder_path pattern: .../skills/{old-slug}/{version} or .../skills/{old-slug}
    // We need to replace the prefixed slug segment with the new raw slug
    const prefixedVersions = db
      .prepare(
        `SELECT sv.id, sv.folder_path, s.slug as new_slug
         FROM skill_versions sv
         JOIN skills s ON sv.skill_id = s.id
         WHERE s.source_origin != 'unknown'`,
      )
      .all() as Array<{ id: string; folder_path: string; new_slug: string }>;

    const updateFolderPath = db.prepare(
      `UPDATE skill_versions SET folder_path = @folderPath, updated_at = datetime('now') WHERE id = @id`,
    );

    for (const row of prefixedVersions) {
      // Replace the slug segment in the folder path
      // Match patterns like /skills/oc-gog/1.0.0 → /skills/gog/1.0.0
      const parts = row.folder_path.split('/');
      const skillsIdx = parts.lastIndexOf('skills');
      if (skillsIdx >= 0 && skillsIdx + 1 < parts.length) {
        parts[skillsIdx + 1] = row.new_slug;
        updateFolderPath.run({ id: row.id, folderPath: parts.join('/') });
      }
    }
  }
}
