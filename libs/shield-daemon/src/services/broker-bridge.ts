/**
 * Broker Bridge Service
 *
 * Provides helper functions for daemon-to-broker communication.
 * Used for privileged operations that require broker's elevated permissions.
 */

import { BrokerClient, type SkillInstallFile, type SkillInstallResult, type SkillUninstallResult } from '@agenshield/broker';

// Singleton broker client instance
let brokerClient: BrokerClient | null = null;

/**
 * Get the broker client instance
 */
function getBrokerClient(): BrokerClient {
  if (!brokerClient) {
    brokerClient = new BrokerClient({
      socketPath: process.env['AGENSHIELD_SOCKET'] || '/var/run/agenshield/agenshield.sock',
      httpHost: 'localhost',
      httpPort: 5201, // Broker uses 5201, daemon uses 5200
      timeout: 60000, // 60s timeout for file operations
      preferSocket: true,
    });
  }
  return brokerClient;
}

/**
 * Check if the broker is available
 */
export async function isBrokerAvailable(): Promise<boolean> {
  try {
    const client = getBrokerClient();
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
  files: Array<{ name: string; content: string }>,
  options: {
    createWrapper?: boolean;
    agentHome?: string;
    socketGroup?: string;
  } = {}
): Promise<SkillInstallResult> {
  const client = getBrokerClient();

  // Convert files to broker format (no encoding needed for text files)
  const brokerFiles: SkillInstallFile[] = files.map((file) => ({
    name: file.name,
    content: file.content,
    base64: false,
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
  } = {}
): Promise<SkillUninstallResult> {
  const client = getBrokerClient();

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
  });
  if (result.exitCode !== 0) {
    throw new Error(`mkdir via broker failed: ${result.stderr}`);
  }
}

/**
 * Reset the broker client (for testing or reconnection)
 */
export function resetBrokerClient(): void {
  brokerClient = null;
}
