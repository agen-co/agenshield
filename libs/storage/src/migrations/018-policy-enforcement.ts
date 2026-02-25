/**
 * Migration 018 — Add enforcement column to policies
 *
 * Adds `enforcement` column for process-target policies.
 * Values: 'alert' (log only) or 'kill' (terminate process).
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class PolicyEnforcementMigration implements Migration {
  readonly version = 18;
  readonly name = '018-policy-enforcement';

  up(db: Database.Database): void {
    db.exec(`
      ALTER TABLE policies ADD COLUMN enforcement TEXT;
    `);
  }
}
