/**
 * Migration registry
 *
 * Exports ALL_MIGRATIONS sorted by semver, plus state read/write utilities.
 * Migration state is stored at /etc/agenshield/migrations.json.
 */

import { execSync } from 'node:child_process';
import type { Migration, MigrationState } from './types.js';
import { migration as v020 } from './v0-2-0.js';
import { MIGRATION_STATE_PATH } from '@agenshield/ipc';

export type { Migration, MigrationState, MigrationRecord, MigrationStep, MigrationStepResult, UpdateContext, DiscoveredUser } from './types.js';

/**
 * All migrations sorted by semver (ascending).
 * Add new migrations here in version order.
 */
export const ALL_MIGRATIONS: Migration[] = [
  v020,
];

/**
 * Compare two semver strings. Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Get pending migrations between fromVersion (exclusive) and toVersion (inclusive).
 */
export function getPendingMigrations(fromVersion: string, toVersion: string): Migration[] {
  return ALL_MIGRATIONS.filter(
    (m) => compareSemver(m.version, fromVersion) > 0 && compareSemver(m.version, toVersion) <= 0
  );
}

/**
 * Load migration state from /etc/agenshield/migrations.json.
 * Uses sudo cat since the file is root-owned.
 * Returns null if file doesn't exist.
 */
export function loadMigrationState(): MigrationState | null {
  try {
    const content = execSync(`sudo cat "${MIGRATION_STATE_PATH}" 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    return JSON.parse(content.trim());
  } catch {
    return null;
  }
}

/**
 * Save migration state to /etc/agenshield/migrations.json.
 * Uses sudo tee + mv pattern for atomic writes.
 */
export function saveMigrationState(state: MigrationState): void {
  const content = JSON.stringify(state, null, 2);
  const tmpPath = '/tmp/agenshield-migrations.json';

  execSync(`sudo tee "${tmpPath}" > /dev/null`, {
    input: content,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Ensure parent directory exists
  execSync(`sudo mkdir -p "$(dirname "${MIGRATION_STATE_PATH}")"`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  execSync(`sudo mv "${tmpPath}" "${MIGRATION_STATE_PATH}"`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  execSync(`sudo chmod 644 "${MIGRATION_STATE_PATH}"`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Aggregate release notes from multiple migrations into a single markdown document.
 */
export function aggregateReleaseNotes(migrations: Migration[]): string {
  return migrations.map((m) => m.releaseNotes.trim()).join('\n\n---\n\n');
}
