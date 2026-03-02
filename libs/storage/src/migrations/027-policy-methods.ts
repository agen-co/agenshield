/**
 * Migration 027 — Add methods column to policies
 *
 * Adds `methods` column for HTTP method filtering on URL-target policies.
 * JSON-encoded array of HTTP methods (e.g. '["GET","POST"]'), NULL = all methods.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class PolicyMethodsMigration implements Migration {
  readonly version = 27;
  readonly name = '027-policy-methods';

  up(db: Database.Database): void {
    db.exec(`
      ALTER TABLE policies ADD COLUMN methods TEXT;
    `);
  }
}
