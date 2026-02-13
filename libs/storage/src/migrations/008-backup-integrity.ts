/**
 * Migration 008 — Add backup_hash column to skill_versions
 *
 * Stores a SHA-256 hash of backup file contents for tamper detection.
 * When restoring from backup, the hash is recomputed and compared to
 * detect any unauthorized modifications.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class BackupIntegrityMigration implements Migration {
  readonly version = 8;
  readonly name = '008-backup-integrity';

  up(db: Database.Database): void {
    db.exec(`ALTER TABLE skill_versions ADD COLUMN backup_hash TEXT`);
  }
}
