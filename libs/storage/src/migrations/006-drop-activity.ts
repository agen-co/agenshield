/**
 * Migration 006 — Drop activity_events from main DB
 *
 * Activity events have been moved to a separate database.
 * This migration drops the table from the main DB.
 * Data migration (copying rows) is handled by Storage.open() before
 * running migrations — it copies rows from the main DB's activity_events
 * into the activity DB if needed.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class DropActivityMigration implements Migration {
  readonly version = 6;
  readonly name = '006-drop-activity';

  up(db: Database.Database): void {
    // Drop indexes first, then table
    db.exec(`
      DROP INDEX IF EXISTS idx_activity_ts;
      DROP INDEX IF EXISTS idx_activity_type;
      DROP TABLE IF EXISTS activity_events;
    `);
  }
}
