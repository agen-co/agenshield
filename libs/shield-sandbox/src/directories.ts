/**
 * Directory Structure Management
 *
 * Creates and manages AgenShield directory structure.
 * Supports dynamic configuration based on UserConfig.
 */

import * as fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { UserConfig, PathsConfig } from '@agenshield/ipc';
import { createUserConfig } from './users';

const execAsync = promisify(exec);

/**
 * Directory definition with ownership and permissions
 */
export interface DirectoryDefinition {
  mode: number;
  owner: string;
  group: string;
}

/**
 * Directory structure type
 */
export interface DirectoryStructure {
  system: Record<string, DirectoryDefinition>;
  agent: Record<string, DirectoryDefinition>;
}

/**
 * Create directory structure based on UserConfig
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 * @returns Directory structure with all paths and permissions
 */
export function createDirectoryStructure(config?: UserConfig): DirectoryStructure {
  const cfg = config || createUserConfig();
  const agentUsername = cfg.agentUser.username;
  const brokerUsername = cfg.brokerUser.username;
  const socketGroupName = cfg.groups.socket.name;
  const workspaceGroupName = cfg.groups.workspace.name;
  const agentHome = cfg.agentUser.home;

  return {
    // System directories (require root)
    system: {
      '/opt/agenshield': {
        mode: 0o755,
        owner: 'root',
        group: 'wheel',
      },
      '/opt/agenshield/config': {
        mode: 0o755,
        owner: brokerUsername,
        group: socketGroupName,
      },
      '/opt/agenshield/policies': {
        mode: 0o755,
        owner: brokerUsername,
        group: socketGroupName,
      },
      '/opt/agenshield/policies/custom': {
        mode: 0o755,
        owner: brokerUsername,
        group: socketGroupName,
      },
      '/opt/agenshield/ops': {
        mode: 0o755,
        owner: brokerUsername,
        group: socketGroupName,
      },
      '/opt/agenshield/bin': {
        mode: 0o755,
        owner: 'root',
        group: 'wheel',
      },
      '/opt/agenshield/quarantine': {
        mode: 0o700,
        owner: 'root',
        group: 'wheel',
      },
      '/opt/agenshield/quarantine/skills': {
        mode: 0o700,
        owner: 'root',
        group: 'wheel',
      },
      '/etc/agenshield': {
        mode: 0o755,
        owner: 'root',
        group: 'wheel',
      },
      '/etc/agenshield/seatbelt': {
        mode: 0o755,
        owner: 'root',
        group: 'wheel',
      },
      '/etc/agenshield/seatbelt/ops': {
        mode: 0o755,
        owner: 'root',
        group: 'wheel',
      },
      '/var/run/agenshield': {
        mode: 0o770,
        owner: brokerUsername,
        group: socketGroupName,
      },
      '/var/log/agenshield': {
        mode: 0o755,
        owner: brokerUsername,
        group: socketGroupName,
      },
    },

    // Agent user directories
    agent: {
      [agentHome]: {
        mode: 0o755,
        owner: agentUsername,
        group: socketGroupName,
      },
      [`${agentHome}/bin`]: {
        mode: 0o755,
        owner: 'root',              // only root can write; agent can read+exec via group
        group: socketGroupName,
      },
      [`${agentHome}/.openclaw`]: {
        mode: 0o755,
        owner: 'root',
        group: socketGroupName,
      },
      [`${agentHome}/.openclaw/skills`]: {
        mode: 0o755,
        owner: 'root',
        group: socketGroupName,
      },
      [`${agentHome}/workspace`]: {
        mode: 0o2775, // setgid bit
        owner: agentUsername,
        group: workspaceGroupName,
      },
      [`${agentHome}/.openclaw-pkg`]: {
        mode: 0o755,
        owner: agentUsername,
        group: socketGroupName,
      },
    },
  };
}

/**
 * Create paths configuration based on UserConfig
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 * @returns PathsConfig with all paths
 */
export function createPathsConfig(config?: UserConfig): PathsConfig {
  const cfg = config || createUserConfig();
  const agentHome = cfg.agentUser.home;

  return {
    socketPath: '/var/run/agenshield/agenshield.sock',
    configDir: '/opt/agenshield/config',
    policiesDir: '/opt/agenshield/policies',
    seatbeltDir: '/etc/agenshield/seatbelt',
    logDir: '/var/log/agenshield',
    agentHomeDir: agentHome,
    socketDir: '/var/run/agenshield',
  };
}

export interface DirectoryResult {
  success: boolean;
  path: string;
  message: string;
  error?: Error;
}

/**
 * Create a directory with specific ownership and permissions
 */
export async function createDirectory(
  dirPath: string,
  options: {
    mode: number;
    owner: string;
    group: string;
  }
): Promise<DirectoryResult> {
  try {
    // Create directory (via sudo for system paths like /opt, /etc, /var)
    await execAsync(`sudo mkdir -p "${dirPath}"`);

    // Set ownership (requires sudo)
    await execAsync(`sudo chown ${options.owner}:${options.group} "${dirPath}"`);

    // Ensure mode is set correctly (mkdir might not set all bits)
    await execAsync(`sudo chmod ${options.mode.toString(8)} "${dirPath}"`);

    return {
      success: true,
      path: dirPath,
      message: `Created ${dirPath}`,
    };
  } catch (error) {
    return {
      success: false,
      path: dirPath,
      message: `Failed to create ${dirPath}: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Create all system directories
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 */
export async function createSystemDirectories(config?: UserConfig): Promise<DirectoryResult[]> {
  const structure = createDirectoryStructure(config);
  const results: DirectoryResult[] = [];

  for (const [dirPath, options] of Object.entries(structure.system)) {
    const result = await createDirectory(dirPath, options);
    results.push(result);
  }

  return results;
}

/**
 * Create all agent directories
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 */
export async function createAgentDirectories(config?: UserConfig): Promise<DirectoryResult[]> {
  const structure = createDirectoryStructure(config);
  const results: DirectoryResult[] = [];

  for (const [dirPath, options] of Object.entries(structure.agent)) {
    const result = await createDirectory(dirPath, options);
    results.push(result);
  }

  return results;
}

/**
 * Create all directories
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 */
export async function createAllDirectories(config?: UserConfig): Promise<DirectoryResult[]> {
  const systemResults = await createSystemDirectories(config);
  const agentResults = await createAgentDirectories(config);

  return [...systemResults, ...agentResults];
}

/**
 * Verify directory structure
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 */
export async function verifyDirectories(config?: UserConfig): Promise<{
  valid: boolean;
  missing: string[];
  incorrect: Array<{ path: string; issue: string }>;
}> {
  const structure = createDirectoryStructure(config);
  const missing: string[] = [];
  const incorrect: Array<{ path: string; issue: string }> = [];

  const allDirs = {
    ...structure.system,
    ...structure.agent,
  };

  for (const [dirPath, expected] of Object.entries(allDirs)) {
    try {
      const stats = await fs.stat(dirPath);

      if (!stats.isDirectory()) {
        incorrect.push({ path: dirPath, issue: 'Not a directory' });
        continue;
      }

      // Check mode (ignore setgid bit for comparison)
      const actualMode = stats.mode & 0o7777;
      const expectedMode = expected.mode & 0o7777;
      if (actualMode !== expectedMode) {
        incorrect.push({
          path: dirPath,
          issue: `Mode mismatch: expected ${expectedMode.toString(8)}, got ${actualMode.toString(8)}`,
        });
      }
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno === 'ENOENT') {
        missing.push(dirPath);
      } else if (errno === 'EACCES') {
        // Running as non-root — use sudo to verify the directory
        try {
          // macOS: stat -f '%Lp' returns octal mode (e.g. "755")
          const { stdout: modeStr } = await execAsync(`sudo stat -f '%Lp' "${dirPath}"`);
          const actualMode = parseInt(modeStr.trim(), 8);
          const expectedMode = expected.mode & 0o7777;
          if (actualMode !== expectedMode) {
            incorrect.push({
              path: dirPath,
              issue: `Mode mismatch: expected ${expectedMode.toString(8)}, got ${actualMode.toString(8)}`,
            });
          }
        } catch {
          // sudo stat failed — EACCES means the path exists, don't report as missing
        }
      } else {
        incorrect.push({
          path: dirPath,
          issue: (error as Error).message,
        });
      }
    }
  }

  return {
    valid: missing.length === 0 && incorrect.length === 0,
    missing,
    incorrect,
  };
}

/**
 * Setup socket directory with correct permissions
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 */
export async function setupSocketDirectory(config?: UserConfig): Promise<DirectoryResult> {
  const cfg = config || createUserConfig();
  const socketDir = '/var/run/agenshield';

  try {
    // Create directory
    await execAsync(`sudo mkdir -p "${socketDir}"`);

    // Set ownership and permissions
    await execAsync(`sudo chown ${cfg.brokerUser.username}:${cfg.groups.socket.name} "${socketDir}"`);
    await execAsync(`sudo chmod 770 "${socketDir}"`);

    return {
      success: true,
      path: socketDir,
      message: 'Socket directory configured',
    };
  } catch (error) {
    return {
      success: false,
      path: socketDir,
      message: `Failed to setup socket directory: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Get directory info
 */
export async function getDirectoryInfo(dirPath: string): Promise<{
  exists: boolean;
  mode?: string;
  owner?: string;
  group?: string;
} | null> {
  try {
    const { stdout } = await execAsync(`ls -ld "${dirPath}"`);
    const parts = stdout.trim().split(/\s+/);

    return {
      exists: true,
      mode: parts[0],
      owner: parts[2],
      group: parts[3],
    };
  } catch {
    return { exists: false };
  }
}

/**
 * Remove all directories (for uninstall/cleanup)
 * WARNING: This is destructive!
 *
 * @param config - Optional UserConfig, uses defaults if not provided
 */
export async function removeAllDirectories(config?: UserConfig): Promise<DirectoryResult[]> {
  const cfg = config || createUserConfig();
  const results: DirectoryResult[] = [];

  // Remove in reverse order (agent dirs first, then system)
  const agentHome = cfg.agentUser.home;

  // Remove agent home
  try {
    await execAsync(`sudo rm -rf "${agentHome}"`);
    results.push({ success: true, path: agentHome, message: `Removed ${agentHome}` });
  } catch (error) {
    results.push({
      success: false,
      path: agentHome,
      message: `Failed to remove ${agentHome}: ${(error as Error).message}`,
      error: error as Error,
    });
  }

  // Remove system directories (in safe order)
  const systemDirs = [
    '/var/run/agenshield',
    '/var/log/agenshield',
    '/etc/agenshield',
    '/opt/agenshield',
  ];

  for (const dirPath of systemDirs) {
    try {
      await execAsync(`sudo rm -rf "${dirPath}"`);
      results.push({ success: true, path: dirPath, message: `Removed ${dirPath}` });
    } catch (error) {
      results.push({
        success: false,
        path: dirPath,
        message: `Failed to remove ${dirPath}: ${(error as Error).message}`,
        error: error as Error,
      });
    }
  }

  return results;
}
