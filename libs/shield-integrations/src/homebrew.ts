/**
 * Agent User Homebrew Installation
 *
 * Installs a user-local Homebrew in the agent's $HOME/homebrew directory.
 * This gives the sandboxed agent access to brew without relying on the
 * host system's Homebrew installation.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';

const execAsync = promisify(exec);

const HOMEBREW_TARBALL_URL = 'https://github.com/Homebrew/brew/tarball/master';

export interface HomebrewInstallResult {
  success: boolean;
  brewPath: string;
  message: string;
  error?: Error;
}

/**
 * Install a user-local Homebrew for the agent user.
 *
 * Creates $HOME/homebrew and downloads the Homebrew tarball into it.
 * Runs as the agent user via `sudo -u`.
 */
export async function installAgentHomebrew(options: {
  agentHome: string;
  agentUsername: string;
  socketGroupName: string;
  verbose?: boolean;
}): Promise<HomebrewInstallResult> {
  const { agentHome, agentUsername, socketGroupName, verbose } = options;
  const brewDir = `${agentHome}/homebrew`;
  const brewPath = `${brewDir}/bin/brew`;
  const log = (msg: string) => verbose && process.stderr.write(`[SETUP] ${msg}\n`);

  try {
    // 1. Create homebrew directory owned by agent user
    log(`Creating homebrew directory at ${brewDir}`);
    await execAsync(`sudo mkdir -p "${brewDir}"`);
    await execAsync(`sudo chown ${agentUsername}:${socketGroupName} "${brewDir}"`);

    // 2. Download and extract Homebrew tarball as agent user
    // --norc --noprofile prevents loading the calling user's rc files
    // -H sets HOME for sudo so the agent user's environment is clean
    log('Downloading and extracting Homebrew');
    const installCmd = [
      `cd "${agentHome}"`,
      `export HOME="${agentHome}"`,
      `/usr/bin/curl -fsSL "${HOMEBREW_TARBALL_URL}" | /usr/bin/tar xz --strip 1 -C homebrew`,
    ].join(' && ');

    await execAsync(
      `sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c '${installCmd}'`,
      { timeout: 120_000 },
    );

    // 3. Verify brew binary exists
    try {
      await fs.access(brewPath);
    } catch {
      return {
        success: false,
        brewPath,
        message: 'Homebrew downloaded but brew binary not found',
      };
    }

    // 4. Ensure correct ownership
    log('Setting ownership for homebrew directory');
    await execAsync(`sudo chown -R ${agentUsername}:${socketGroupName} "${brewDir}"`);

    log(`Homebrew installed at ${brewDir}`);
    return {
      success: true,
      brewPath,
      message: `Homebrew installed at ${brewDir}`,
    };
  } catch (error) {
    return {
      success: false,
      brewPath,
      message: `Homebrew installation failed: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Check if agent-local Homebrew is installed.
 */
export async function isAgentHomebrewInstalled(agentHome: string): Promise<boolean> {
  try {
    await fs.access(`${agentHome}/homebrew/bin/brew`);
    return true;
  } catch {
    return false;
  }
}
