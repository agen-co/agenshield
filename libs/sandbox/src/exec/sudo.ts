/**
 * Canonical sudo execution helper
 *
 * Consolidates the previously duplicated sudoExec implementations
 * from macos.ts, backup.ts, restore.ts, migration.ts, presets/custom.ts,
 * and presets/dev-harness.ts into a single shared function.
 */

import { execSync } from 'node:child_process';

export interface SudoResult {
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Execute a command with sudo
 */
export function sudoExec(cmd: string): SudoResult {
  try {
    const output = execSync(`sudo ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { success: true, output: output.trim() };
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    return { success: false, error: error.stderr || error.message || 'Unknown error' };
  }
}
