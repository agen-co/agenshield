/**
 * Agent User Homebrew Installation
 *
 * Installs a user-local Homebrew in the agent's $HOME/homebrew directory.
 * This gives the sandboxed agent access to brew without relying on the
 * host system's Homebrew installation.
 */

import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';

const execAsync = promisify(exec);

/** Filter out noisy subprocess output (curl progress meter, etc.) */
function isNoiseLine(line: string): boolean {
  if (/^\s*%\s+Total/.test(line)) return true;
  if (/^\s*Dload\s+Upload/.test(line)) return true;
  if (/^[\d\s.kMG:\-/|]+$/.test(line)) return true;
  if (/^=>?\s*$/.test(line)) return true;
  return false;
}

/**
 * Execute a command with real-time progress logging via spawn.
 * Streams stdout/stderr line-by-line through the log callback.
 */
async function execWithProgress(
  command: string,
  log: (msg: string) => void,
  opts?: { timeout?: number; cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', ['-c', command], {
      cwd: opts?.cwd || '/',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (opts?.timeout) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timed out after ${opts.timeout}ms`));
      }, opts.timeout);
    }

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !isNoiseLine(trimmed)) log(trimmed);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !isNoiseLine(trimmed)) log(trimmed);
      }
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const err = new Error(`Command failed with exit code ${code}: ${stderr.slice(0, 500)}`);
        (err as any).stdout = stdout;
        (err as any).stderr = stderr;
        reject(err);
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

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
  onLog?: (msg: string) => void;
}): Promise<HomebrewInstallResult> {
  const { agentHome, agentUsername, socketGroupName, verbose, onLog } = options;
  const brewDir = `${agentHome}/homebrew`;
  const brewPath = `${brewDir}/bin/brew`;
  const log = onLog || ((msg: string) => verbose && process.stderr.write(`[SETUP] ${msg}\n`));

  try {
    // 1. Create homebrew directory owned by agent user
    log(`Creating homebrew directory at ${brewDir}`);
    await execAsync(`sudo mkdir -p "${brewDir}"`);
    await execAsync(`sudo chown ${agentUsername}:${socketGroupName} "${brewDir}"`);

    // 2. Download and extract Homebrew tarball as agent user
    // --norc --noprofile prevents loading the calling user's rc files
    // -H sets HOME for sudo so the agent user's environment is clean
    // cwd: agentHome avoids getcwd errors when caller's cwd is inaccessible
    log('Downloading and extracting Homebrew');
    const installCmd = [
      `export HOME="${agentHome}"`,
      `/usr/bin/curl -fsSL "${HOMEBREW_TARBALL_URL}" | /usr/bin/tar xz --strip 1 -C homebrew`,
    ].join(' && ');

    await execWithProgress(
      `sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c '${installCmd}'`,
      log,
      { cwd: agentHome, timeout: 120_000 },
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
