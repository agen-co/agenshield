/**
 * Migration 015 — Create dismissed_targets table
 *
 * Stores target IDs that the user has hidden from the canvas.
 * Server-side storage ensures dismissed state survives uninstall/reinstall.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class DismissedTargetsMigration implements Migration {
  readonly version = 15;
  readonly name = '015-dismissed-targets';

  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS dismissed_targets (
        target_id    TEXT PRIMARY KEY,
        dismissed_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }
}
