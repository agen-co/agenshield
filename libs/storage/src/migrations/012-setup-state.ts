/**
 * Migration 012 — Add setup tracking columns to state table
 *
 * Tracks whether initial setup has been completed and the current
 * setup phase for resumable setup flows.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class SetupStateMigration implements Migration {
  readonly version = 12;
  readonly name = '012-setup-state';

  up(db: Database.Database): void {
    const columns = db.pragma('table_info(state)') as Array<{ name: string }>;
    const colNames = new Set(columns.map((c) => c.name));

    if (!colNames.has('setup_completed')) {
      db.exec(`ALTER TABLE state ADD COLUMN setup_completed INTEGER NOT NULL DEFAULT 0`);
    }

    if (!colNames.has('setup_phase')) {
      db.exec(`ALTER TABLE state ADD COLUMN setup_phase TEXT`);
    }
  }
}
