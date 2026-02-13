/**
 * Migration 004 — Source-prefixed slugs
 *
 * Renames slugs and folder_paths for integration skills so that external
 * sources have a prefix that prevents namespace collisions.
 *
 * Prefix mapping (by remote_id / source adapter ID):
 *   mcp      → ag-
 *   registry → cb-
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

const PREFIX_MAP: Record<string, string> = {
  mcp: 'ag-',
  registry: 'cb-',
};

export class SlugPrefixMigration implements Migration {
  readonly version = 4;
  readonly name = '004-slug-prefix';

  up(db: Database.Database): void {
    // Find integration skills whose remote_id maps to a known prefix
    const rows = db
      .prepare(`SELECT id, slug, remote_id FROM skills WHERE source = 'integration' AND remote_id IS NOT NULL`)
      .all() as Array<{ id: string; slug: string; remote_id: string }>;

    const updateSlug = db.prepare(`UPDATE skills SET slug = @newSlug WHERE id = @id`);
    const updateFolderPath = db.prepare(
      `UPDATE skill_versions SET folder_path = REPLACE(folder_path, @oldSegment, @newSegment) WHERE skill_id = @skillId`,
    );

    for (const row of rows) {
      const prefix = PREFIX_MAP[row.remote_id];
      if (!prefix) continue;

      // Skip if already prefixed
      if (row.slug.startsWith(prefix)) continue;

      const newSlug = `${prefix}${row.slug}`;

      updateSlug.run({ newSlug, id: row.id });
      updateFolderPath.run({
        oldSegment: `/skills/${row.slug}/`,
        newSegment: `/skills/${newSlug}/`,
        skillId: row.id,
      });
      // Also handle folder paths that end with the slug (no trailing slash)
      updateFolderPath.run({
        oldSegment: `/skills/${row.slug}`,
        newSegment: `/skills/${newSlug}`,
        skillId: row.id,
      });
    }
  }
}
