/**
 * Dev mode state persistence.
 *
 * Stores dev session state at /etc/agenshield/dev-state.json (root-owned, mode 600).
 * Follows the same pattern as backup.ts for reading/writing root-owned files.
 */

import * as fs from 'node:fs';
import { execSync } from 'node:child_process';

const DEV_STATE_PATH = '/etc/agenshield/dev-state.json';
const CONFIG_DIR = '/etc/agenshield';

export interface DevState {
  version: '1.0';
  createdAt: string;
  lastUsedAt: string;
  prefix: string;
  baseName: string;
  agentUsername: string;
  brokerUsername: string;
  socketGroupName: string;
  workspaceGroupName: string;
  baseUid: number;
  baseGid: number;
  testHarnessPath: string;
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
  const result = sudoExec(`cat "${DEV_STATE_PATH}"`);
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
  // Ensure config directory exists
  let result = sudoExec(`mkdir -p "${CONFIG_DIR}"`);
  if (!result.success) {
    return { success: false, error: `Failed to create config dir: ${result.error}` };
  }

  // Write to temp file first, then move with sudo
  const tempPath = '/tmp/agenshield-dev-state.json';
  try {
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch (err) {
    return { success: false, error: `Failed to write temp state: ${err}` };
  }

  result = sudoExec(`mv "${tempPath}" "${DEV_STATE_PATH}"`);
  if (!result.success) {
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    return { success: false, error: `Failed to install state: ${result.error}` };
  }

  result = sudoExec(`chmod 600 "${DEV_STATE_PATH}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set permissions: ${result.error}` };
  }

  result = sudoExec(`chown root:wheel "${DEV_STATE_PATH}"`);
  if (!result.success) {
    return { success: false, error: `Failed to set ownership: ${result.error}` };
  }

  return { success: true };
}

export function deleteDevState(): { success: boolean; error?: string } {
  return sudoExec(`rm -f "${DEV_STATE_PATH}"`);
}

export function devStateExists(): boolean {
  const result = sudoExec(`test -f "${DEV_STATE_PATH}" && echo "exists"`);
  return result.success && result.output === 'exists';
}
