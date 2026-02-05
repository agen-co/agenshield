/**
 * System state manager
 *
 * Manages the state.json file for tracking AgenShield system state.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SystemState, AgenCoState, DaemonState, UserState, GroupState, InstallationState, PasscodeProtectionState } from '@agenshield/ipc';
import { STATE_FILE, DEFAULT_PORT } from '@agenshield/ipc';
import { getConfigDir } from '../config/paths';

/**
 * Get the state file path
 */
export function getStatePath(): string {
  return path.join(getConfigDir(), STATE_FILE);
}

/**
 * Get default system state
 */
export function getDefaultState(): SystemState {
  return {
    version: '1.0.0',
    installedAt: new Date().toISOString(),
    daemon: {
      running: false,
      port: DEFAULT_PORT,
    },
    users: [],
    groups: [],
    agenco: {
      authenticated: false,
      connectedIntegrations: [],
    },
    installation: {
      preset: 'unknown',
      baseName: 'default',
      wrappers: [],
      seatbeltInstalled: false,
    },
  };
}

/**
 * Load system state from disk
 * Returns default state if file doesn't exist or is invalid
 */
export function loadState(): SystemState {
  const statePath = getStatePath();

  if (!fs.existsSync(statePath)) {
    return getDefaultState();
  }

  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw);

    // Merge with defaults to ensure all fields exist
    return {
      ...getDefaultState(),
      ...parsed,
      daemon: { ...getDefaultState().daemon, ...parsed.daemon },
      agenco: { ...getDefaultState().agenco, ...parsed.agenco },
      installation: { ...getDefaultState().installation, ...parsed.installation },
    };
  } catch (error) {
    console.error('Failed to load state file:', (error as Error).message);
    return getDefaultState();
  }
}

/**
 * Save system state to disk
 */
export function saveState(state: SystemState): void {
  const statePath = getStatePath();
  const configDir = getConfigDir();

  // Ensure config directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o644 });
}

/**
 * Update system state with partial updates
 */
export function updateState(updates: Partial<SystemState>): SystemState {
  const current = loadState();

  // Deep merge for nested objects
  const updated: SystemState = {
    ...current,
    ...updates,
  };

  // Handle nested object merges
  if (updates.daemon) {
    updated.daemon = { ...current.daemon, ...updates.daemon };
  }
  if (updates.agenco) {
    updated.agenco = { ...current.agenco, ...updates.agenco };
  }
  if (updates.installation) {
    updated.installation = { ...current.installation, ...updates.installation };
  }
  if (updates.passcodeProtection) {
    updated.passcodeProtection = { ...current.passcodeProtection, ...updates.passcodeProtection };
  }

  saveState(updated);
  return updated;
}

/**
 * Update daemon state
 */
export function updateDaemonState(updates: Partial<DaemonState>): SystemState {
  const current = loadState();
  current.daemon = { ...current.daemon, ...updates };
  saveState(current);
  return current;
}

/**
 * Update AgenCo state
 */
export function updateAgenCoState(updates: Partial<AgenCoState>): SystemState {
  const current = loadState();
  current.agenco = { ...current.agenco, ...updates };
  saveState(current);
  return current;
}

/**
 * Update installation state
 */
export function updateInstallationState(updates: Partial<InstallationState>): SystemState {
  const current = loadState();
  current.installation = { ...current.installation, ...updates };
  saveState(current);
  return current;
}

/**
 * Update passcode protection state
 */
export function updatePasscodeProtectionState(updates: Partial<PasscodeProtectionState>): SystemState {
  const current = loadState();
  current.passcodeProtection = { ...current.passcodeProtection, ...updates } as PasscodeProtectionState;
  saveState(current);
  return current;
}

/**
 * Get passcode protection state
 */
export function getPasscodeProtectionState(): PasscodeProtectionState | undefined {
  const current = loadState();
  return current.passcodeProtection;
}

/**
 * Add a user to state
 */
export function addUserState(user: UserState): SystemState {
  const current = loadState();

  // Check if user already exists
  const existingIndex = current.users.findIndex((u) => u.username === user.username);
  if (existingIndex >= 0) {
    current.users[existingIndex] = user;
  } else {
    current.users.push(user);
  }

  saveState(current);
  return current;
}

/**
 * Remove a user from state
 */
export function removeUserState(username: string): SystemState {
  const current = loadState();
  current.users = current.users.filter((u) => u.username !== username);
  saveState(current);
  return current;
}

/**
 * Add a group to state
 */
export function addGroupState(group: GroupState): SystemState {
  const current = loadState();

  // Check if group already exists
  const existingIndex = current.groups.findIndex((g) => g.name === group.name);
  if (existingIndex >= 0) {
    current.groups[existingIndex] = group;
  } else {
    current.groups.push(group);
  }

  saveState(current);
  return current;
}

/**
 * Remove a group from state
 */
export function removeGroupState(name: string): SystemState {
  const current = loadState();
  current.groups = current.groups.filter((g) => g.name !== name);
  saveState(current);
  return current;
}

/**
 * Add a connected integration to AgenCo state
 */
export function addConnectedIntegration(integrationId: string): SystemState {
  const current = loadState();

  if (!current.agenco.connectedIntegrations.includes(integrationId)) {
    current.agenco.connectedIntegrations.push(integrationId);
    saveState(current);
  }

  return current;
}

/**
 * Remove a connected integration from AgenCo state
 */
export function removeConnectedIntegration(integrationId: string): SystemState {
  const current = loadState();
  current.agenco.connectedIntegrations = current.agenco.connectedIntegrations.filter(
    (id) => id !== integrationId
  );
  saveState(current);
  return current;
}

/**
 * Initialize state file if it doesn't exist
 */
export function initializeState(): SystemState {
  const statePath = getStatePath();

  if (!fs.existsSync(statePath)) {
    const state = getDefaultState();
    saveState(state);
    return state;
  }

  return loadState();
}
