/**
 * Migration 026 — Add workspace_paths column to profiles
 *
 * Stores allowed workspace directories as a JSON array string.
 * NULL means no workspace restrictions (backward-compatible default).
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class ProfileWorkspacePathsMigration implements Migration {
  readonly version = 26;
  readonly name = '026-profile-workspace-paths';

  up(db: Database.Database): void {
    db.exec(`
      ALTER TABLE profiles ADD COLUMN workspace_paths TEXT
    `);
  }
}
