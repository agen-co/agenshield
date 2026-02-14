/**
 * Activity database migration runner
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types';
import { ActivitySchemaMigration } from './001-activity-schema';
import { AlertsTableMigration } from './002-alerts-table';

export const ACTIVITY_MIGRATIONS: Migration[] = [
  new ActivitySchemaMigration(),
  new AlertsTableMigration(),
];

const TABLE = '_migrations';

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function getCurrentVersion(db: Database.Database): number {
  ensureMigrationsTable(db);
  const row = db.prepare(`SELECT MAX(version) as version FROM ${TABLE}`).get() as
    | { version: number | null }
    | undefined;
  return row?.version ?? 0;
}

/**
 * Run pending activity migrations.
 * Returns the number of migrations applied.
 */
export function runActivityMigrations(
  db: Database.Database,
  migrations: Migration[] = ACTIVITY_MIGRATIONS,
): number {
  ensureMigrationsTable(db);
  const current = getCurrentVersion(db);

  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) return 0;

  const insertMigration = db.prepare(
    `INSERT INTO ${TABLE} (version, name) VALUES (@version, @name)`,
  );

  const applyAll = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db, null);
      insertMigration.run({ version: migration.version, name: migration.name });
    }
  });

  applyAll();

  const lastVersion = pending[pending.length - 1].version;
  db.pragma(`user_version = ${lastVersion}`);

  return pending.length;
}
