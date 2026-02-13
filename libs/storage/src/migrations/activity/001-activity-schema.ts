/**
 * Activity Migration 001 — Activity events table
 *
 * Creates the activity_events table in the dedicated activity database.
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types';

export class ActivitySchemaMigration implements Migration {
  readonly version = 1;
  readonly name = 'activity-001-schema';

  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        target_id  TEXT,
        type       TEXT NOT NULL,
        timestamp  TEXT NOT NULL,
        data       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_events(type);
    `);
  }
}
