/**
 * Broker Bridge Service
 *
 * Provides helper functions for daemon-to-broker communication.
 * Used for privileged operations that require broker's elevated permissions.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BrokerClient, type SkillInstallFile, type SkillInstallResult, type SkillUninstallResult } from '@agenshield/broker';
import type { SyncedSecrets } from '@agenshield/ipc';
import { socketPath } from '@agenshield/ipc';

// Singleton broker client instance
let brokerClient: BrokerClient | null = null;

const SYSTEM_SOCKET = socketPath();

/**
 * Resolve the broker socket path.
 *
 * Priority:
 * 1. `AGENSHIELD_SOCKET` environment variable (explicit override)
 * 2. Per-profile socket at `$AGENSHIELD_AGENT_HOME/.agenshield/run/agenshield.sock`
 * 3. Default socket at `~/.agenshield/run/agenshield.sock`
 */
function resolveSocketPath(): string {
  const envSocket = process.env['AGENSHIELD_SOCKET'];
  if (envSocket) return envSocket;

  const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || os.homedir();
  const perProfileSocket = path.join(agentHome, '.agenshield', 'run', 'agenshield.sock');
  if (fs.existsSync(perProfileSocket)) return perProfileSocket;

  return SYSTEM_SOCKET;
}

/**
 * Get the singleton broker client instance (uses default socket resolution)
 */
function getBrokerClient(): BrokerClient {
  if (!brokerClient) {
    brokerClient = new BrokerClient({
      socketPath: resolveSocketPath(),
      httpHost: 'localhost',
      httpPort: 5201, // Broker uses 5201, daemon uses 5200
      timeout: 60000, // 60s timeout for file operations
      preferSocket: true,
    });
  }
  return brokerClient;
}

/**
 * Get a broker client for a specific socket path, or the singleton if none given.
 */
function getBrokerClientForSocket(socketPath?: string): BrokerClient {
  if (!socketPath) return getBrokerClient();
  return new BrokerClient({
    socketPath,
    httpHost: 'localhost',
    httpPort: 5201,
    timeout: 60000,
    preferSocket: true,
  });
}

/**
 * Check if the broker is available
 *
 * @param socketPath - Optional override socket path (for per-target resolution)
 */
export async function isBrokerAvailable(socketPath?: string): Promise<boolean> {
  try {
    const client = getBrokerClientForSocket(socketPath);
    return await client.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Install a skill via the broker
 *
 * @param slug - Skill slug (directory name)
 * @param files - Array of files to install
 * @param options - Installation options
 * @returns Installation result
 */
export async function installSkillViaBroker(
  slug: string,
  files: Array<{ name: string; content: string; mode?: number }>,
  options: {
    createWrapper?: boolean;
    agentHome?: string;
    socketGroup?: string;
    socketPath?: string;
  } = {}
): Promise<SkillInstallResult> {
  const client = getBrokerClientForSocket(options.socketPath);

  // Convert files to broker format (no encoding needed for text files)
  const brokerFiles: SkillInstallFile[] = files.map((file) => ({
    name: file.name,
    content: file.content,
    base64: false,
    ...(file.mode !== undefined ? { mode: file.mode } : {}),
  }));

  const result = await client.skillInstall({
    slug,
    files: brokerFiles,
    createWrapper: options.createWrapper ?? true,
    agentHome: options.agentHome,
    socketGroup: options.socketGroup,
  });

  return result;
}

/**
 * Uninstall a skill via the broker
 *
 * @param slug - Skill slug to uninstall
 * @param options - Uninstallation options
 * @returns Uninstallation result
 */
export async function uninstallSkillViaBroker(
  slug: string,
  options: {
    removeWrapper?: boolean;
    agentHome?: string;
    socketPath?: string;
  } = {}
): Promise<SkillUninstallResult> {
  const client = getBrokerClientForSocket(options.socketPath);

  const result = await client.skillUninstall({
    slug,
    removeWrapper: options.removeWrapper ?? true,
    agentHome: options.agentHome,
  });

  return result;
}

/**
 * Write a file via the broker's privileged file_write command.
 * The broker auto-creates parent directories.
 */
export async function writeFileViaBroker(
  filePath: string,
  content: string,
  options?: { mode?: number }
): Promise<void> {
  const client = getBrokerClient();
  await client.fileWrite({
    path: filePath,
    content,
    mode: options?.mode,
  });
}

/**
 * Copy a file via the broker by reading locally and writing via broker.
 * Daemon has read access; broker provides write access to privileged paths.
 */
export async function copyFileViaBroker(
  srcPath: string,
  destPath: string,
  mode?: number
): Promise<void> {
  const fs = await import('node:fs');
  const content = fs.readFileSync(srcPath);
  const client = getBrokerClient();
  await client.fileWrite({
    path: destPath,
    content: content.toString('base64'),
    encoding: 'base64',
    mode,
  });
}

/**
 * Create a directory via the broker's exec command.
 */
export async function mkdirViaBroker(dirPath: string): Promise<void> {
  const client = getBrokerClient();
  const result = await client.exec({
    command: '/bin/mkdir',
    args: ['-p', dirPath],
    cwd: '/',
  });
  if (result.exitCode !== 0) {
    throw new Error(`mkdir via broker failed: ${result.stderr}`);
  }
}

/**
 * Remove a file or directory via the broker's exec command.
 */
export async function rmViaBroker(targetPath: string): Promise<void> {
  const client = getBrokerClient();
  const result = await client.exec({
    command: '/bin/rm',
    args: ['-rf', targetPath],
    cwd: '/',
  });
  if (result.exitCode !== 0) {
    throw new Error(`rm via broker failed: ${result.stderr}`);
  }
}

/**
 * Push decrypted secrets to the broker via IPC (Unix socket only).
 * Non-fatal on failure — the broker may not be running.
 */
export async function pushSecretsToBroker(synced: SyncedSecrets): Promise<void> {
  try {
    const client = getBrokerClient();
    await client.secretsSync(synced);
  } catch {
    // Non-fatal: broker may not be running
  }
}

/**
 * Clear the broker's in-memory secrets (e.g. on vault lock or daemon shutdown).
 * Non-fatal on failure.
 */
export async function clearBrokerSecrets(): Promise<void> {
  try {
    const client = getBrokerClient();
    await client.secretsSync({ clear: true });
  } catch {
    // Non-fatal: broker may not be running
  }
}

/**
 * Reset the broker client (for testing or reconnection)
 */
export function resetBrokerClient(): void {
  brokerClient = null;
}
