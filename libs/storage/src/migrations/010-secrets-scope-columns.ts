/**
 * Migration 010 — Add scope columns to secrets table (existing DBs)
 *
 * Existing databases at version 9 have a secrets table without target_id/user_username.
 * Fresh databases already have them from 001-schema, so this is idempotent.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class SecretsScopeColumnsMigration implements Migration {
  readonly version = 10;
  readonly name = '010-secrets-scope-columns';

  up(db: Database.Database): void {
    const columns = db.pragma('table_info(secrets)') as Array<{ name: string }>;
    const colNames = new Set(columns.map((c) => c.name));

    if (!colNames.has('target_id')) {
      db.exec(
        `ALTER TABLE secrets ADD COLUMN target_id TEXT REFERENCES targets(id) ON DELETE CASCADE`,
      );
    }
    if (!colNames.has('user_username')) {
      db.exec(
        `ALTER TABLE secrets ADD COLUMN user_username TEXT REFERENCES users(username) ON DELETE CASCADE`,
      );
    }

    db.exec(`CREATE INDEX IF NOT EXISTS idx_secrets_scope ON secrets(target_id, user_username)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_secrets_name ON secrets(name)`);
  }
}
