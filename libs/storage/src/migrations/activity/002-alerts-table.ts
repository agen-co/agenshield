/**
 * Activity Migration 002 — Alerts table
 *
 * Creates the alerts table for persistent alert acknowledgement system.
 * Alerts reference activity_events by FK and persist until acknowledged.
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types';

export class AlertsTableMigration implements Migration {
  readonly version = 2;
  readonly name = 'activity-002-alerts-table';

  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS alerts (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_event_id  INTEGER NOT NULL REFERENCES activity_events(id),
        profile_id         TEXT,
        event_type         TEXT NOT NULL,
        severity           TEXT NOT NULL CHECK(severity IN ('critical','warning','info')),
        title              TEXT NOT NULL,
        description        TEXT NOT NULL,
        navigation_target  TEXT NOT NULL,
        details            TEXT,
        acknowledged_at    TEXT,
        created_at         TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_unack ON alerts(acknowledged_at) WHERE acknowledged_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
      CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
    `);
  }
}
