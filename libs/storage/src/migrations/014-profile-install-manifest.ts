/**
 * Migration 014 — Add install_manifest column to profiles table
 *
 * Stores the JSON-serialized InstallManifest (steps executed during shield).
 * Used for manifest-driven rollback in unshield.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class ProfileInstallManifestMigration implements Migration {
  readonly version = 14;
  readonly name = '014-profile-install-manifest';

  up(db: Database.Database): void {
    const columns = db.pragma('table_info(profiles)') as Array<{ name: string }>;
    const colNames = new Set(columns.map((c) => c.name));

    if (!colNames.has('install_manifest')) {
      db.exec(`ALTER TABLE profiles ADD COLUMN install_manifest TEXT`);
    }
  }
}
