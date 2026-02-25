/**
 * Setup state persistence
 *
 * Tracks whether `agenshield setup` has been completed. All CLI commands
 * that require a working AgenShield installation check this before running.
 *
 * State file: ~/.agenshield/setup.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { AGENSHIELD_HOME } from './home.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SetupState {
  /** ISO timestamp of when setup was completed */
  completedAt: string;
  /** Which mode was selected during setup */
  mode: 'local' | 'cloud';
  /** Cloud API URL (only set for cloud mode) */
  cloudUrl?: string;
}

// ---------------------------------------------------------------------------
// Path
// ---------------------------------------------------------------------------

/** Absolute path to the setup state file */
export function getSetupStatePath(): string {
  return path.join(AGENSHIELD_HOME, 'setup.json');
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

/**
 * Read the setup state file. Returns null if missing or malformed.
 */
export function readSetupState(): SetupState | null {
  try {
    const raw = fs.readFileSync(getSetupStatePath(), 'utf-8');
    const data = JSON.parse(raw) as SetupState;
    if (typeof data.completedAt !== 'string' || typeof data.mode !== 'string') {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Persist setup state atomically (write-to-tmp then rename).
 */
export function writeSetupState(state: SetupState): void {
  const filePath = getSetupStatePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', { mode: 0o644 });
  fs.renameSync(tmpPath, filePath);
}

/**
 * Returns true when setup has been completed at least once.
 */
export function isSetupComplete(): boolean {
  return readSetupState() !== null;
}

/**
 * Remove the setup state file (used by uninstall).
 */
export function clearSetupState(): void {
  try {
    fs.unlinkSync(getSetupStatePath());
  } catch {
    // File may not exist — that's fine
  }
}
