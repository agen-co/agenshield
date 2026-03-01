/**
 * Migration 024 — Add enforcer_interval_ms column to config table
 *
 * Stores the process enforcer scan interval (milliseconds).
 * NULL inherits the daemon default (1000ms).
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class EnforcerIntervalMigration implements Migration {
  readonly version = 24;
  readonly name = '024-enforcer-interval';

  up(db: Database.Database): void {
    db.exec(`ALTER TABLE config ADD COLUMN enforcer_interval_ms INTEGER`);
  }
}
