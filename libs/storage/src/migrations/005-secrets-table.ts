/**
 * Migration 005 — Secrets table
 *
 * Creates `secrets` and `secret_policies` tables for plaintext secret
 * storage in SQLite (replaces vault.enc-based storage).
 *
 * Secrets are stored unencrypted — the DB file itself is 0o600.
 * Policy linkage is a many-to-many junction table.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class SecretsTableMigration implements Migration {
  readonly version = 5;
  readonly name = '005-secrets-table';

  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        value      TEXT NOT NULL,
        scope      TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global','policed','standalone')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS secret_policies (
        secret_id TEXT NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
        policy_id TEXT NOT NULL,
        PRIMARY KEY (secret_id, policy_id)
      )
    `);
  }
}
