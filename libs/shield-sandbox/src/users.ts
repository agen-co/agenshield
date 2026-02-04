/**
 * User and Group Management
 *
 * Creates and manages AgenShield users and groups on macOS.
 * Supports dynamic configuration with optional prefix for testing/multiple instances.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { UserConfig, UserDefinition, GroupDefinition } from '@agenshield/ipc';

const execAsync = promisify(exec);

/**
 * Default base UIDs/GIDs
 */
export const DEFAULT_BASE_UID = 5200;
export const DEFAULT_BASE_GID = 5100;

/**
 * Default base name for users/groups (the part after ash_ prefix)
 */
export const DEFAULT_BASE_NAME = 'default';

/**
 * Required prefix for all AgenShield users/groups
 */
export const ASH_PREFIX = 'ash_';

/**
 * Create user configuration with optional prefix, base IDs, and base name
 *
 * @param options - Configuration options
 * @param options.prefix - Optional additional prefix for all names (for testing multiple instances)
 * @param options.baseUid - Base UID for users (default: 5200)
 * @param options.baseGid - Base GID for groups (default: 5100)
 * @param options.baseName - Base name for users/groups (default: 'default')
 * @returns Complete UserConfig object
 *
 * Naming pattern: ash_{baseName}_{role} (or {prefix}_ash_{baseName}_{role} with prefix)
 *
 * @example
 * // Default configuration
 * const config = createUserConfig();
 * // config.agentUser.username === 'ash_default_agent'
 * // config.groups.socket.name === 'ash_default'
 *
 * @example
 * // With custom base name
 * const customConfig = createUserConfig({ baseName: 'myapp' });
 * // customConfig.agentUser.username === 'ash_myapp_agent'
 *
 * @example
 * // With prefix for testing multiple instances
 * const testConfig = createUserConfig({ prefix: 'test1', baseName: 'myapp' });
 * // testConfig.agentUser.username === 'test1_ash_myapp_agent'
 *
 * @example
 * // With custom UIDs
 * const customConfig = createUserConfig({ baseName: 'ci', baseUid: 6200, baseGid: 6100 });
 */
export function createUserConfig(options?: {
  prefix?: string;
  baseUid?: number;
  baseGid?: number;
  baseName?: string;
}): UserConfig {
  const testPrefix = options?.prefix || '';
  const baseUid = options?.baseUid || DEFAULT_BASE_UID;
  const baseGid = options?.baseGid || DEFAULT_BASE_GID;
  const baseName = options?.baseName || DEFAULT_BASE_NAME;

  // Build the full prefix: {testPrefix?_}ash_{baseName}
  // e.g., "ash_default" or "test1_ash_myapp"
  const fullPrefix = testPrefix ? `${testPrefix}_${ASH_PREFIX}${baseName}` : `${ASH_PREFIX}${baseName}`;

  const agentUser: UserDefinition = {
    username: `${fullPrefix}_agent`,
    uid: baseUid,
    gid: baseGid, // Primary group: socket group
    shell: '/usr/local/bin/guarded-shell',
    home: `/Users/${fullPrefix}_agent`,
    realname: `AgenShield Agent (${baseName})`,
    groups: [`${fullPrefix}`, `${fullPrefix}_workspace`],
  };

  const brokerUser: UserDefinition = {
    username: `${fullPrefix}_broker`,
    uid: baseUid + 1,
    gid: baseGid, // Primary group: socket group
    shell: '/bin/bash',
    home: '/var/empty',
    realname: `AgenShield Broker (${baseName})`,
    groups: [`${fullPrefix}`],
  };

  const groups = {
    socket: {
      name: `${fullPrefix}`,
      gid: baseGid,
      description: `AgenShield socket access (${baseName})`,
    } as GroupDefinition,
    workspace: {
      name: `${fullPrefix}_workspace`,
      gid: baseGid + 1,
      description: `AgenShield workspace access (${baseName})`,
    } as GroupDefinition,
  };

  return {
    agentUser,
    brokerUser,
    groups,
    prefix: testPrefix,
    baseName,
    baseUid,
    baseGid,
  };
}

/**
 * Default user configuration
 */
const DEFAULT_CONFIG = createUserConfig();

export interface CreateResult {
  success: boolean;
  message: string;
  error?: Error;
}

/**
 * Check if a group exists
 */
export async function groupExists(name: string): Promise<boolean> {
  try {
    await execAsync(`dscl . -read /Groups/${name}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a user exists
 */
export async function userExists(username: string): Promise<boolean> {
  try {
    await execAsync(`dscl . -read /Users/${username}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a group
 */
export async function createGroup(
  name: string,
  gid: number,
  description?: string
): Promise<CreateResult> {
  try {
    if (await groupExists(name)) {
      return { success: true, message: `Group ${name} already exists` };
    }

    // Create group
    await execAsync(`sudo dscl . -create /Groups/${name}`);
    await execAsync(`sudo dscl . -create /Groups/${name} PrimaryGroupID ${gid}`);
    await execAsync(`sudo dscl . -create /Groups/${name} RealName "${description || name}"`);
    await execAsync(`sudo dscl . -create /Groups/${name} Password "*"`);

    return { success: true, message: `Created group ${name} (GID: ${gid})` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to create group ${name}: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Create all required groups from config
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 */
export async function createGroups(config?: UserConfig): Promise<CreateResult[]> {
  const cfg = config || DEFAULT_CONFIG;
  const results: CreateResult[] = [];

  // Create socket group
  const socketResult = await createGroup(
    cfg.groups.socket.name,
    cfg.groups.socket.gid,
    cfg.groups.socket.description
  );
  results.push(socketResult);

  // Create workspace group
  const workspaceResult = await createGroup(
    cfg.groups.workspace.name,
    cfg.groups.workspace.gid,
    cfg.groups.workspace.description
  );
  results.push(workspaceResult);

  return results;
}

/**
 * Create a user from UserDefinition
 */
export async function createUser(userDef: UserDefinition): Promise<CreateResult> {
  try {
    if (await userExists(userDef.username)) {
      return { success: true, message: `User ${userDef.username} already exists` };
    }

    // Create user
    await execAsync(`sudo dscl . -create /Users/${userDef.username}`);
    await execAsync(`sudo dscl . -create /Users/${userDef.username} UniqueID ${userDef.uid}`);
    await execAsync(`sudo dscl . -create /Users/${userDef.username} PrimaryGroupID ${userDef.gid}`);
    await execAsync(`sudo dscl . -create /Users/${userDef.username} UserShell ${userDef.shell}`);
    await execAsync(`sudo dscl . -create /Users/${userDef.username} NFSHomeDirectory ${userDef.home}`);
    await execAsync(`sudo dscl . -create /Users/${userDef.username} RealName "${userDef.realname}"`);
    await execAsync(`sudo dscl . -create /Users/${userDef.username} Password "*"`);

    // Add to additional groups
    for (const group of userDef.groups) {
      try {
        await execAsync(`sudo dseditgroup -o edit -a ${userDef.username} -t user ${group}`);
      } catch {
        // Group might not exist yet, ignore
      }
    }

    // Create home directory if specified and not /var/empty
    if (userDef.home !== '/var/empty') {
      await execAsync(`sudo mkdir -p ${userDef.home}`);
      await execAsync(`sudo chown ${userDef.username}:${userDef.gid} ${userDef.home}`);
      await execAsync(`sudo chmod 755 ${userDef.home}`);
    }

    return { success: true, message: `Created user ${userDef.username} (UID: ${userDef.uid})` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to create user ${userDef.username}: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Create the agent user
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 */
export async function createAgentUser(config?: UserConfig): Promise<CreateResult> {
  const cfg = config || DEFAULT_CONFIG;
  return createUser(cfg.agentUser);
}

/**
 * Create the broker user
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 */
export async function createBrokerUser(config?: UserConfig): Promise<CreateResult> {
  const cfg = config || DEFAULT_CONFIG;
  return createUser(cfg.brokerUser);
}

/**
 * Create all required users
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 */
export async function createUsers(config?: UserConfig): Promise<CreateResult[]> {
  const results: CreateResult[] = [];

  results.push(await createAgentUser(config));
  results.push(await createBrokerUser(config));

  return results;
}

/**
 * Create all groups and users
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 */
export async function createAllUsersAndGroups(config?: UserConfig): Promise<{
  groups: CreateResult[];
  users: CreateResult[];
}> {
  const groups = await createGroups(config);
  const users = await createUsers(config);
  return { groups, users };
}

/**
 * Delete a group
 */
export async function deleteGroup(name: string): Promise<CreateResult> {
  try {
    if (!(await groupExists(name))) {
      return { success: true, message: `Group ${name} does not exist` };
    }

    await execAsync(`sudo dscl . -delete /Groups/${name}`);
    return { success: true, message: `Deleted group ${name}` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to delete group ${name}: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Delete a user
 */
export async function deleteUser(username: string): Promise<CreateResult> {
  try {
    if (!(await userExists(username))) {
      return { success: true, message: `User ${username} does not exist` };
    }

    await execAsync(`sudo dscl . -delete /Users/${username}`);
    return { success: true, message: `Deleted user ${username}` };
  } catch (error) {
    return {
      success: false,
      message: `Failed to delete user ${username}: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Delete all groups from config
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 */
export async function deleteGroups(config?: UserConfig): Promise<CreateResult[]> {
  const cfg = config || DEFAULT_CONFIG;
  const results: CreateResult[] = [];

  results.push(await deleteGroup(cfg.groups.socket.name));
  results.push(await deleteGroup(cfg.groups.workspace.name));

  return results;
}

/**
 * Delete all users from config
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 */
export async function deleteUsers(config?: UserConfig): Promise<CreateResult[]> {
  const cfg = config || DEFAULT_CONFIG;
  const results: CreateResult[] = [];

  results.push(await deleteUser(cfg.agentUser.username));
  results.push(await deleteUser(cfg.brokerUser.username));

  return results;
}

/**
 * Delete all users and groups (for uninstall/cleanup)
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 */
export async function deleteAllUsersAndGroups(config?: UserConfig): Promise<{
  users: CreateResult[];
  groups: CreateResult[];
}> {
  // Delete users first, then groups
  const users = await deleteUsers(config);
  const groups = await deleteGroups(config);
  return { users, groups };
}

/**
 * Get user info
 */
export async function getUserInfo(username: string): Promise<Record<string, string> | null> {
  try {
    const { stdout } = await execAsync(`dscl . -read /Users/${username}`);
    const info: Record<string, string> = {};

    for (const line of stdout.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        info[key] = value;
      }
    }

    return info;
  } catch {
    return null;
  }
}

/**
 * Get group info
 */
export async function getGroupInfo(name: string): Promise<Record<string, string> | null> {
  try {
    const { stdout } = await execAsync(`dscl . -read /Groups/${name}`);
    const info: Record<string, string> = {};

    for (const line of stdout.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        info[key] = value;
      }
    }

    return info;
  } catch {
    return null;
  }
}

/**
 * Verify that all required users and groups exist
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 */
export async function verifyUsersAndGroups(config?: UserConfig): Promise<{
  valid: boolean;
  missingGroups: string[];
  missingUsers: string[];
}> {
  const cfg = config || DEFAULT_CONFIG;
  const missingGroups: string[] = [];
  const missingUsers: string[] = [];

  // Check groups
  if (!(await groupExists(cfg.groups.socket.name))) {
    missingGroups.push(cfg.groups.socket.name);
  }
  if (!(await groupExists(cfg.groups.workspace.name))) {
    missingGroups.push(cfg.groups.workspace.name);
  }

  // Check users
  if (!(await userExists(cfg.agentUser.username))) {
    missingUsers.push(cfg.agentUser.username);
  }
  if (!(await userExists(cfg.brokerUser.username))) {
    missingUsers.push(cfg.brokerUser.username);
  }

  return {
    valid: missingGroups.length === 0 && missingUsers.length === 0,
    missingGroups,
    missingUsers,
  };
}
