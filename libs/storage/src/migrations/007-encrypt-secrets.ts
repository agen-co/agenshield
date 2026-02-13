/**
 * Migration 007 — Encrypt secrets
 *
 * Adds `value_encrypted` column to secrets table and encrypts existing plaintext
 * values if an encryption key is available. If the key isn't available (vault
 * locked at migration time), marks a meta flag for deferred encryption on unlock.
 *
 * After encryption, the old `value` column is NULLed out (not dropped, as SQLite
 * doesn't support DROP COLUMN in older versions; the column is kept but unused).
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class EncryptSecretsMigration implements Migration {
  readonly version = 7;
  readonly name = '007-encrypt-secrets';

  up(db: Database.Database, encryptionKey: Buffer | null): void {
    // Add value_encrypted column
    const colInfo = db.prepare("PRAGMA table_info(secrets)").all() as Array<{ name: string }>;
    const hasCol = colInfo.some((c) => c.name === 'value_encrypted');

    if (!hasCol) {
      db.exec('ALTER TABLE secrets ADD COLUMN value_encrypted TEXT');
    }

    // Recreate table to make `value` nullable (SQLite doesn't support ALTER COLUMN)
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
    db.exec('INSERT INTO secrets_new SELECT id, name, value, value_encrypted, scope, created_at FROM secrets');
    db.exec('DROP TABLE secrets');
    db.exec('ALTER TABLE secrets_new RENAME TO secrets');
    db.exec('PRAGMA foreign_keys = ON');

    // If encryption key available, encrypt existing rows now
    if (encryptionKey) {
      this.encryptExisting(db, encryptionKey);
    } else {
      // Mark for deferred encryption on first unlock
      db.prepare(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('pending_secrets_encryption', 'true')",
      ).run();
    }
  }

  private encryptExisting(db: Database.Database, key: Buffer): void {
    // Lazy import to avoid circular dep at module level
    const crypto = require('node:crypto');

    const rows = db.prepare(
      'SELECT id, value FROM secrets WHERE value IS NOT NULL AND value_encrypted IS NULL',
    ).all() as Array<{ id: string; value: string }>;

    if (rows.length === 0) return;

    const update = db.prepare(
      'UPDATE secrets SET value_encrypted = @encrypted, value = NULL WHERE id = @id',
    );

    for (const row of rows) {
      const encrypted = encryptAes(row.value, key, crypto);
      update.run({ id: row.id, encrypted });
    }
  }
}

/** Inline AES-256-GCM encryption (same format as crypto.ts) */
function encryptAes(
  plaintext: string,
  key: Buffer,
  crypto: typeof import('node:crypto'),
): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}
