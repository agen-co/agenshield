/**
 * Migration runner
 *
 * Applies pending migrations in order within a transaction.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';
import { SchemaMigration } from './001-schema';
import { DatabaseCorruptedError } from '../errors';

export type { Migration };
export { runActivityMigrations, ACTIVITY_MIGRATIONS } from './activity/index';

const TABLE = '_migrations';

export const ALL_MIGRATIONS: Migration[] = [
  new SchemaMigration(),
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
 * Core tables created by migration 001 — used for corruption detection.
 * If the migration table says 001 was applied but these are missing, the DB is corrupted.
 */
const SCHEMA_TABLES = [
  'meta', 'profiles', 'config', 'policies', 'state', 'secrets',
  'skills', 'skill_versions', 'skill_installations', 'allowed_commands',
];

/**
 * Validate that the database schema matches what migrations claim was applied.
 * Throws `DatabaseCorruptedError` if critical tables are missing.
 */
export function validateDbIntegrity(db: Database.Database, dbPath?: string): void {
  const current = getCurrentVersion(db);
  if (current < 1) return; // No migrations applied yet — nothing to check

  const existingTables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
      .map((r) => r.name),
  );

  const missing = SCHEMA_TABLES.filter((t) => !existingTables.has(t));
  if (missing.length > 0) {
    throw new DatabaseCorruptedError(dbPath ?? 'unknown', missing);
  }
}

/**
 * Run all pending migrations.
 * Returns the number of migrations applied.
 */
export function runMigrations(
  db: Database.Database,
  encryptionKey: Buffer | null,
  migrations: Migration[] = ALL_MIGRATIONS,
  dbPath?: string,
): number {
  ensureMigrationsTable(db);
  const current = getCurrentVersion(db);

  // Integrity check: only when using default migrations (skip for custom test migrations)
  if (migrations === ALL_MIGRATIONS) {
    validateDbIntegrity(db, dbPath);
  }

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
