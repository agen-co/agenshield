/**
 * Migration 003 — Add skills manager columns
 *
 * Adds remote_id and is_public to skills table,
 * auto_update and pinned_version to skill_installations table.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class SkillsManagerColumnsMigration implements Migration {
  readonly version = 3;
  readonly name = '003-skills-manager-columns';

  up(db: Database.Database): void {
    db.exec(`
      ALTER TABLE skills ADD COLUMN remote_id TEXT;
      ALTER TABLE skills ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE skill_installations ADD COLUMN auto_update INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE skill_installations ADD COLUMN pinned_version TEXT;
      CREATE INDEX IF NOT EXISTS idx_skills_remote ON skills(remote_id);
      CREATE INDEX IF NOT EXISTS idx_si_auto_update ON skill_installations(auto_update);
    `);
  }
}
