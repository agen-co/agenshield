/**
 * Dev mode state persistence.
 *
 * Stores dev session state at ~/.agenshield/dev-state.json (root-owned, mode 600).
 * Follows the same pattern as backup.ts for reading/writing root-owned files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

function devStatePath(): string {
  const home = process.env['HOME'] || '';
  return `${home}/.agenshield/dev-state.json`;
}

function devStateDir(): string {
  return path.dirname(devStatePath());
}

/** @deprecated Legacy path — kept for backward-compat reads */
const LEGACY_DEV_STATE_PATH = '/etc/agenshield/dev-state.json';

export interface DevState {
  version: '1.0';
  createdAt: string;
  lastUsedAt: string;
  prefix: string;
  baseName: string;
  agentUsername: string;
  brokerUsername: string;
  socketGroupName: string;
  baseUid: number;
  baseGid: number;
  testHarnessPath: string;
  nodePath: string;
  skillsDir?: string;
  installedSkills?: string[];
}

function sudoExec(cmd: string): { success: boolean; output?: string; error?: string } {
  try {
    const output = execSync(`sudo ${cmd}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output: output.trim() };
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    return { success: false, error: error.stderr || error.message || 'Unknown error' };
  }
}

export function loadDevState(): DevState | null {
  // Try new path first, then legacy
  let result = sudoExec(`cat "${devStatePath()}"`);
  if (!result.success || !result.output) {
    result = sudoExec(`cat "${LEGACY_DEV_STATE_PATH}"`);
  }
  if (!result.success || !result.output) return null;

  try {
    const state = JSON.parse(result.output) as DevState;
    if (state.version !== '1.0') return null;
    return state;
  } catch {
    return null;
  }
}

export function saveDevState(state: DevState): { success: boolean; error?: string } {
  const statePath = devStatePath();
  const dir = devStateDir();

  // Ensure directory exists
  let result = sudoExec(`mkdir -p "${dir}"`);
  if (!result.success) {
    return { success: false, error: `Failed to create dir: ${result.error}` };
  }

  // Write to temp file first, then move with sudo
  const tempPath = '/tmp/agenshield-dev-state.json';
  try {
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch (err) {
    return { success: false, error: `Failed to write temp state: ${err}` };
  }

  result = sudoExec(`mv "${tempPath}" "${statePath}"`);
  if (!result.success) {
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    return { success: false, error: `Failed to install state: ${result.error}` };
  }

  result = sudoExec(`chmod 600 "${statePath}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set permissions: ${result.error}` };
  }

  result = sudoExec(`chown root:wheel "${statePath}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set ownership: ${result.error}` };
  }

  return { success: true };
}

export function deleteDevState(): { success: boolean; error?: string } {
  // Remove from both new and legacy paths
  sudoExec(`rm -f "${devStatePath()}"`);
  sudoExec(`rm -f "${LEGACY_DEV_STATE_PATH}"`);
  return { success: true };
}

export function devStateExists(): boolean {
  const result = sudoExec(`test -f "${devStatePath()}" && echo "exists"`);
  if (result.success && result.output === 'exists') return true;
  // Fallback to legacy path
  const legacy = sudoExec(`test -f "${LEGACY_DEV_STATE_PATH}" && echo "exists"`);
  return legacy.success && legacy.output === 'exists';
}
