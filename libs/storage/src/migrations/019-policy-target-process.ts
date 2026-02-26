/**
 * Migration 019 — Add 'process' to policies.target CHECK constraint
 *
 * SQLite does not support ALTER TABLE to modify CHECK constraints,
 * so we recreate the table with the updated constraint.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class PolicyTargetProcessMigration implements Migration {
  readonly version = 19;
  readonly name = '019-policy-target-process';

  up(db: Database.Database): void {
    db.exec(`
      -- Create new table with updated CHECK constraint
      CREATE TABLE policies_new (
        id             TEXT PRIMARY KEY,
        profile_id     TEXT REFERENCES profiles(id) ON DELETE CASCADE,
        name           TEXT NOT NULL,
        action         TEXT NOT NULL CHECK (action IN ('allow', 'deny', 'approval')),
        target         TEXT NOT NULL CHECK (target IN ('skill', 'command', 'url', 'filesystem', 'process')),
        patterns       TEXT NOT NULL,
        enabled        INTEGER NOT NULL DEFAULT 1,
        priority       INTEGER,
        operations     TEXT,
        preset         TEXT,
        scope          TEXT,
        network_access TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
        managed        INTEGER NOT NULL DEFAULT 0,
        managed_source TEXT,
        enforcement    TEXT
      );

      -- Copy existing data
      INSERT INTO policies_new
        SELECT id, profile_id, name, action, target, patterns, enabled, priority,
               operations, preset, scope, network_access, created_at, updated_at,
               managed, managed_source, enforcement
        FROM policies;

      -- Drop old table and rename
      DROP TABLE policies;
      ALTER TABLE policies_new RENAME TO policies;

      -- Recreate indexes
      CREATE INDEX idx_policies_scope ON policies(profile_id);
      CREATE INDEX idx_policies_target ON policies(target);
      CREATE INDEX idx_policies_enabled ON policies(enabled);
    `);
  }
}
