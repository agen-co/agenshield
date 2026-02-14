/**
 * Migration 011 — Add broker_token column to profiles table
 *
 * Each target profile gets a unique broker token for authenticating
 * broker-to-daemon communication. Fresh databases already include
 * this column from 001-schema, so this is idempotent.
 */

import * as crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class ProfileBrokerTokenMigration implements Migration {
  readonly version = 11;
  readonly name = '011-profile-broker-token';

  up(db: Database.Database): void {
    const columns = db.pragma('table_info(profiles)') as Array<{ name: string }>;
    const colNames = new Set(columns.map((c) => c.name));

    if (!colNames.has('broker_token')) {
      db.exec(`ALTER TABLE profiles ADD COLUMN broker_token TEXT`);
    }

    // Create unique index (idempotent)
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_broker_token ON profiles(broker_token)`,
    );

    // Back-fill tokens for existing target profiles that don't have one
    const rows = db
      .prepare(`SELECT id FROM profiles WHERE type = 'target' AND broker_token IS NULL`)
      .all() as Array<{ id: string }>;

    if (rows.length > 0) {
      const update = db.prepare(`UPDATE profiles SET broker_token = ? WHERE id = ?`);
      for (const row of rows) {
        const token = crypto.randomBytes(32).toString('hex');
        update.run(token, row.id);
      }
    }
  }
}
