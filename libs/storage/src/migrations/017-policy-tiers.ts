/**
 * Migration 017 — Add managed policy columns
 *
 * Adds `managed` flag and `managed_source` to the policies table
 * to support the 3-tier policy hierarchy: managed > target > global.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class PolicyTiersMigration implements Migration {
  readonly version = 17;
  readonly name = '017-policy-tiers';

  up(db: Database.Database): void {
    db.exec(`
      ALTER TABLE policies ADD COLUMN managed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE policies ADD COLUMN managed_source TEXT;
      CREATE INDEX idx_policies_managed ON policies(managed);
    `);
  }
}
