/**
 * Migration 009 — Make secrets.value nullable
 *
 * For databases where migration 007 already ran without the table recreation,
 * the `value` column is still NOT NULL. This migration recreates the table
 * with `value TEXT` (nullable) so that new secrets can be inserted with only
 * `value_encrypted` populated.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class SecretsValueNullableMigration implements Migration {
  readonly version = 9;
  readonly name = '009-secrets-value-nullable';

  up(db: Database.Database): void {
    // Check if value column is still NOT NULL
    const cols = db.prepare('PRAGMA table_info(secrets)').all() as Array<{
      name: string;
      notnull: number;
    }>;
    const valueCol = cols.find((c) => c.name === 'value');

    // Already nullable or table doesn't exist — nothing to do
    if (!valueCol || valueCol.notnull === 0) return;

    // Recreate table with value nullable (SQLite doesn't support ALTER COLUMN)
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      CREATE TABLE secrets_new (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        value           TEXT,
        value_encrypted TEXT,
        scope           TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global','policed','standalone')),
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec(
      'INSERT INTO secrets_new SELECT id, name, value, value_encrypted, scope, created_at FROM secrets',
    );
    db.exec('DROP TABLE secrets');
    db.exec('ALTER TABLE secrets_new RENAME TO secrets');
    db.exec('PRAGMA foreign_keys = ON');
  }
}
