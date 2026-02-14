/**
 * System state manager
 *
 * Reads and writes state from SQLite via StateRepository.
 * Falls back to defaults when no state row exists yet.
 */

import type { SystemState, AgenCoState, DaemonState, UserState, GroupState, InstallationState, PasscodeProtectionState } from '@agenshield/ipc';
import { DEFAULT_PORT } from '@agenshield/ipc';
import { getStorage } from '@agenshield/storage';

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
 * Load system state from DB.
 * Returns default state if no row exists or storage isn't initialized.
 */
export function loadState(): SystemState {
  try {
    const storage = getStorage();
    const state = storage.state.getFull();
    if (!state) return getDefaultState();

    // Merge with defaults to ensure all fields exist
    const defaults = getDefaultState();
    return {
      ...defaults,
      ...state,
      daemon: { ...defaults.daemon, ...state.daemon },
      agenco: { ...defaults.agenco, ...state.agenco },
      installation: { ...defaults.installation, ...state.installation },
    };
  } catch {
    return getDefaultState();
  }
}

/**
 * Save full system state to DB.
 * Writes to state table + users/groups tables.
 */
export function saveState(state: SystemState): void {
  const storage = getStorage();
  const repo = storage.state;

  // Ensure state row exists
  repo.init(state.version, state.installedAt);

  // Update all sub-states
  repo.updateDaemon({
    running: state.daemon.running,
    pid: state.daemon.pid ?? null,
    startedAt: state.daemon.startedAt ?? null,
    port: state.daemon.port,
  });

  repo.updateAgenCo({
    authenticated: state.agenco.authenticated,
    lastAuthAt: state.agenco.lastAuthAt ?? null,
    connectedIntegrations: state.agenco.connectedIntegrations,
  });

  repo.updateInstallation({
    preset: state.installation.preset,
    baseName: state.installation.baseName,
    prefix: state.installation.prefix ?? null,
    wrappers: state.installation.wrappers,
    seatbeltInstalled: state.installation.seatbeltInstalled,
  });

  if (state.passcodeProtection) {
    repo.updatePasscode({
      enabled: state.passcodeProtection.enabled,
      allowAnonymousReadOnly: state.passcodeProtection.allowAnonymousReadOnly,
      failedAttempts: state.passcodeProtection.failedAttempts,
      lockedUntil: state.passcodeProtection.lockedUntil ?? null,
    });
  }

  repo.updateVersion(state.version);

  // Sync users — replace all
  const currentUsers = repo.getUsers();
  for (const u of currentUsers) {
    repo.removeUser(u.username);
  }
  for (const u of state.users) {
    repo.addUser(u);
  }

  // Sync groups — replace all
  const currentGroups = repo.getGroups();
  for (const g of currentGroups) {
    repo.removeGroup(g.name);
  }
  for (const g of state.groups) {
    repo.addGroup(g);
  }
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
  try {
    getStorage().state.updateDaemon(updates);
  } catch {
    // Storage not initialized — no-op
  }
  return loadState();
}

/**
 * Update AgenCo state
 */
export function updateAgenCoState(updates: Partial<AgenCoState>): SystemState {
  try {
    getStorage().state.updateAgenCo(updates);
  } catch {
    // Storage not initialized — no-op
  }
  return loadState();
}

/**
 * Update installation state
 */
export function updateInstallationState(updates: Partial<InstallationState>): SystemState {
  try {
    getStorage().state.updateInstallation(updates);
  } catch {
    // Storage not initialized — no-op
  }
  return loadState();
}

/**
 * Update passcode protection state
 */
export function updatePasscodeProtectionState(updates: Partial<PasscodeProtectionState>): SystemState {
  try {
    getStorage().state.updatePasscode(updates);
  } catch {
    // Storage not initialized — no-op
  }
  return loadState();
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
  try {
    getStorage().state.addUser(user);
  } catch {
    // Storage not initialized — no-op
  }
  return loadState();
}

/**
 * Remove a user from state
 */
export function removeUserState(username: string): SystemState {
  try {
    getStorage().state.removeUser(username);
  } catch {
    // Storage not initialized — no-op
  }
  return loadState();
}

/**
 * Add a group to state
 */
export function addGroupState(group: GroupState): SystemState {
  try {
    getStorage().state.addGroup(group);
  } catch {
    // Storage not initialized — no-op
  }
  return loadState();
}

/**
 * Remove a group from state
 */
export function removeGroupState(name: string): SystemState {
  try {
    getStorage().state.removeGroup(name);
  } catch {
    // Storage not initialized — no-op
  }
  return loadState();
}

/**
 * Add a connected integration to AgenCo state
 */
export function addConnectedIntegration(integrationId: string): SystemState {
  const current = loadState();
  if (!current.agenco.connectedIntegrations.includes(integrationId)) {
    const updated = [...current.agenco.connectedIntegrations, integrationId];
    try {
      getStorage().state.updateAgenCo({ connectedIntegrations: updated });
    } catch {
      // Storage not initialized — no-op
    }
  }
  return loadState();
}

/**
 * Remove a connected integration from AgenCo state
 */
export function removeConnectedIntegration(integrationId: string): SystemState {
  const current = loadState();
  const updated = current.agenco.connectedIntegrations.filter((id) => id !== integrationId);
  try {
    getStorage().state.updateAgenCo({ connectedIntegrations: updated });
  } catch {
    // Storage not initialized — no-op
  }
  return loadState();
}

/**
 * Initialize state if it doesn't exist
 */
export function initializeState(): SystemState {
  try {
    const storage = getStorage();
    const existing = storage.state.get();
    if (!existing) {
      storage.state.init('1.0.0');
    }
  } catch {
    // Storage not initialized — no-op
  }
  return loadState();
}
