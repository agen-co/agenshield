/**
 * Migration runner
 *
 * Applies pending migrations in order within a transaction.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';
import { InitialSchemaMigration } from './001-initial-schema';
import { ImportJsonMigration } from './002-import-json';
import { SkillsManagerColumnsMigration } from './003-skills-manager-columns';

export type { Migration };

const TABLE = '_migrations';

export const ALL_MIGRATIONS: Migration[] = [
  new InitialSchemaMigration(),
  new ImportJsonMigration(),
  new SkillsManagerColumnsMigration(),
];

/**
 * Ensure the _migrations table exists.
 */
function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Get the DB schema version via PRAGMA user_version (fast, no table query).
 */
export function getDbVersion(db: Database.Database): number {
  const row = db.pragma('user_version', { simple: true });
  return (row as number) ?? 0;
}

/**
 * Get the current migration version (highest applied version).
 * Also syncs PRAGMA user_version if it diverges from the table version.
 */
export function getCurrentVersion(db: Database.Database): number {
  ensureMigrationsTable(db);
  const row = db.prepare(`SELECT MAX(version) as version FROM ${TABLE}`).get() as
    | { version: number | null }
    | undefined;
  const tableVersion = row?.version ?? 0;

  const pragmaVersion = getDbVersion(db);
  if (pragmaVersion !== tableVersion) {
    db.pragma(`user_version = ${tableVersion}`);
  }

  return tableVersion;
}

/**
 * Run all pending migrations.
 * Returns the number of migrations applied.
 */
export function runMigrations(
  db: Database.Database,
  encryptionKey: Buffer | null,
  migrations: Migration[] = ALL_MIGRATIONS,
): number {
  ensureMigrationsTable(db);
  const current = getCurrentVersion(db);

  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);

  if (pending.length === 0) return 0;

  const insertMigration = db.prepare(
    `INSERT INTO ${TABLE} (version, name) VALUES (@version, @name)`,
  );

  const applyAll = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db, encryptionKey);
      insertMigration.run({ version: migration.version, name: migration.name });
    }
  });

  applyAll();

  // Set PRAGMA user_version to last applied migration version
  const lastVersion = pending[pending.length - 1].version;
  db.pragma(`user_version = ${lastVersion}`);

  return pending.length;
}
