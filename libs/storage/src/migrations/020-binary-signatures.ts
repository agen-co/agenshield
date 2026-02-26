/**
 * Migration 020 — Create binary_signatures table
 *
 * Stores SHA256 fingerprints of known binaries for anti-rename
 * process detection. Signatures can come from cloud sync or local scanning.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class BinarySignaturesMigration implements Migration {
  readonly version = 20;
  readonly name = '020-binary-signatures';

  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE binary_signatures (
        id            TEXT PRIMARY KEY,
        sha256        TEXT NOT NULL,
        package_name  TEXT NOT NULL,
        version       TEXT,
        platform      TEXT,
        source        TEXT NOT NULL DEFAULT 'cloud',
        metadata      TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX idx_binsig_sha256_platform ON binary_signatures(sha256, platform);
      CREATE INDEX idx_binsig_package ON binary_signatures(package_name);
    `);
  }
}
