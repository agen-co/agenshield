/**
 * Migration 022 — Rename profile IDs from `{targetId}-{timestamp}` to agent username
 *
 * Profile IDs were previously generated as e.g. `openclaw-lx5abc123`. This
 * migration renames them to the agent username (e.g. `ash_openclaw_agent`)
 * so the ID conveys what the profile represents.
 *
 * FK constraints are ON DELETE CASCADE only (no ON UPDATE CASCADE), so we
 * INSERT the new row, UPDATE all FK references, then DELETE the old row.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

/** Tables with a `profile_id` column referencing profiles(id) */
const FK_TABLES = [
  'config',
  'policies',
  'secrets',
  'skill_installations',
  'policy_sets',
  'policy_nodes',
];

export class ProfileIdToUsernameMigration implements Migration {
  readonly version = 22;
  readonly name = '022-profile-id-to-username';

  up(db: Database.Database): void {
    // Find profiles that need renaming: agent_username is set and differs from id
    const rows = db
      .prepare(
        `SELECT id, agent_username FROM profiles
         WHERE agent_username IS NOT NULL
           AND agent_username != ''
           AND id != agent_username`,
      )
      .all() as Array<{ id: string; agent_username: string }>;

    if (rows.length === 0) return;

    // Get all column names from the profiles table (minus id, which we replace)
    const columns = (
      db.prepare("PRAGMA table_info('profiles')").all() as Array<{ name: string }>
    ).map((c) => c.name);

    const nonIdColumns = columns.filter((c) => c !== 'id');
    const selectCols = nonIdColumns.map((c) => `"${c}"`).join(', ');

    for (const { id: oldId, agent_username: newId } of rows) {
      // Skip if the new ID already exists (idempotency)
      const existing = db
        .prepare('SELECT id FROM profiles WHERE id = ?')
        .get(newId) as { id: string } | undefined;
      if (existing) continue;

      // 1. Insert new profile row with the agent username as ID
      db.prepare(
        `INSERT INTO profiles (id, ${selectCols})
         SELECT @newId, ${selectCols} FROM profiles WHERE id = @oldId`,
      ).run({ oldId, newId });

      // 2. Update FK references in all dependent tables
      for (const table of FK_TABLES) {
        // Only update if the table exists (some may not in older DBs)
        const tableExists = db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(table);
        if (!tableExists) continue;

        db.prepare(
          `UPDATE "${table}" SET profile_id = @newId WHERE profile_id = @oldId`,
        ).run({ oldId, newId });
      }

      // 3. Delete old profile row (CASCADE handles any remaining refs)
      db.prepare('DELETE FROM profiles WHERE id = @oldId').run({ oldId });
    }
  }
}
