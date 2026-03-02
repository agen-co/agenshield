/**
 * Migration 025 — Add enforcement_mode column to profiles
 *
 * Stores which enforcement layer(s) are active for a shielded target:
 * 'proxy', 'interceptor', or 'both'.
 * NULL means 'both' (backward-compatible default).
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class ProfileEnforcementModeMigration implements Migration {
  readonly version = 25;
  readonly name = '025-profile-enforcement-mode';

  up(db: Database.Database): void {
    db.exec(`
      ALTER TABLE profiles ADD COLUMN enforcement_mode TEXT
    `);
  }
}
