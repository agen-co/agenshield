/**
 * Activity Migration 003 — Add source column
 *
 * Stores the derived event source (e.g. target ID) alongside
 * the activity event so historical queries can filter by source
 * without re-deriving at read time.
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types';

export class ActivitySourceMigration implements Migration {
  readonly version = 3;
  readonly name = 'activity-003-source';

  up(db: Database.Database): void {
    db.exec(`ALTER TABLE activity_events ADD COLUMN source TEXT`);
  }
}
