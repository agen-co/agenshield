/**
 * OpenClaw Installation for Agent User
 *
 * Handles installing OpenClaw via npm in the agent's sandboxed environment,
 * copying and sanitizing the host user's .openclaw config, and stopping
 * the host user's OpenClaw processes.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { exec, execSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OpenClawInstallResult {
  success: boolean;
  version: string;
  binaryPath: string;
  message: string;
  error?: Error;
}

export interface OpenClawConfigCopyResult {
  success: boolean;
  configDir: string;
  sanitized: boolean;
  message: string;
  error?: Error;
}

export interface StopHostOpenClawResult {
  success: boolean;
  daemonStopped: boolean;
  gatewayStopped: boolean;
  message: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sudoExec(cmd: string): { success: boolean; output?: string; error?: string } {
  try {
    const output = execSync(`sudo ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { success: true, output: output.trim() };
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    return { success: false, error: error.stderr || error.message || 'Unknown error' };
  }
}

/**
 * Sanitize an OpenClaw config object — strip secrets and rewrite paths.
 *
 * - Strips env and apiKey from skill entries (AgenShield manages those via vault)
 * - Rewrites workspace paths from original user's home to agent user's workspace
 */
function sanitizeOpenClawConfig(
  config: Record<string, unknown>,
  originalHome: string,
  agentHome: string,
): Record<string, unknown> {
  const agentWorkspace = `${agentHome}/workspace`;

  // Deep-clone and do string replacement of all path references
  let configStr = JSON.stringify(config);
  // Replace original user's .openclaw workspace references with agent workspace
  configStr = configStr.replaceAll(`${originalHome}/.openclaw`, agentWorkspace);
  // Replace any other references to original user's home with agent home
  configStr = configStr.replaceAll(originalHome, agentHome);

  const sanitized = JSON.parse(configStr) as Record<string, unknown>;

  // Strip env and apiKey from all skill entries
  // (AgenShield manages secrets via its own vault)
  const skills = (sanitized['skills'] ?? {}) as Record<string, unknown>;
  const entries = (skills['entries'] ?? {}) as Record<string, Record<string, unknown>>;
  for (const entry of Object.values(entries)) {
    if (entry && typeof entry === 'object') {
      delete entry['env'];
      delete entry['apiKey'];
    }
  }

  return sanitized;
}

/** MIME type prefixes that indicate binary files — skip these during path rewriting */
const BINARY_MIME_PREFIXES = [
  'image/',
  'audio/',
  'video/',
  'application/octet-stream',
  'application/x-sqlite',
  'application/gzip',
  'application/zip',
  'application/x-mach-binary',
  'application/x-executable',
];

/**
 * Recursively rewrite path references in all text files inside a directory.
 *
 * Applies two replacements in order (more specific first):
 * 1. `{originalHome}/.openclaw/workspace` → `{agentHome}/workspace`
 * 2. `{originalHome}` → `{agentHome}`
 *
 * Skips binary files. Only writes back files that actually changed.
 * Returns count of files modified.
 */
function rewritePathsInDirectory(
  dir: string,
  originalHome: string,
  agentHome: string,
  log: (msg: string) => void,
): number {
  if (!fs.existsSync(dir)) return 0;

  // Get all files recursively
  const findResult = sudoExec(`find "${dir}" -type f`);
  if (!findResult.success || !findResult.output) return 0;

  const files = findResult.output.split('\n').filter(Boolean);
  let modified = 0;

  for (const filePath of files) {
    // Check MIME type to skip binaries
    const mimeResult = sudoExec(`file --mime-type -b "${filePath}"`);
    if (!mimeResult.success || !mimeResult.output) continue;
    const mime = mimeResult.output.trim();
    if (BINARY_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) continue;

    // Read file content
    const readResult = sudoExec(`cat "${filePath}"`);
    if (!readResult.success || readResult.output === undefined) continue;
    const content = readResult.output;

    // Apply replacements (specific first, then general)
    let updated = content;
    updated = updated.replaceAll(`${originalHome}/.openclaw/workspace`, `${agentHome}/workspace`);
    updated = updated.replaceAll(`${originalHome}/.openclaw`, `${agentHome}/.openclaw`);
    updated = updated.replaceAll(originalHome, agentHome);

    // Only write back if changed
    if (updated !== content) {
      const tmpFile = path.join(os.tmpdir(), `agenshield-rewrite-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      fs.writeFileSync(tmpFile, updated);
      sudoExec(`mv "${tmpFile}" "${filePath}"`);
      modified++;
      log(`Rewrote paths in ${filePath}`);
    }
  }

  return modified;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Detect the OpenClaw version installed on the host system.
 * Returns the version string or null if not found.
 */
export function detectHostOpenClawVersion(): string | null {
  try {
    const output = execSync('openclaw --version', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    // Output might be "openclaw v1.2.3" or just "1.2.3"
    const match = output.match(/(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/);
    return match ? match[1] : output;
  } catch {
    return null;
  }
}

/**
 * Install OpenClaw for the agent user via NVM's npm.
 *
 * Uses the agent's NVM environment to run `npm install -g openclaw@<version>`.
 * Falls back to 'latest' if no version specified.
 */
export async function installAgentOpenClaw(options: {
  agentHome: string;
  agentUsername: string;
  socketGroupName: string;
  /** Version to install (from host), or 'latest' */
  targetVersion?: string;
  verbose?: boolean;
}): Promise<OpenClawInstallResult> {
  const { agentHome, agentUsername, socketGroupName, verbose } = options;
  const targetVersion = options.targetVersion || 'latest';
  const nvmDir = `${agentHome}/.nvm`;
  const log = (msg: string) => verbose && process.stderr.write(`[SETUP] ${msg}\n`);

  const empty: OpenClawInstallResult = {
    success: false,
    version: '',
    binaryPath: '',
    message: '',
  };

  try {
    // 1. Install openclaw via npm (using NVM's node/npm)
    const versionSpec = targetVersion === 'latest' ? 'openclaw' : `openclaw@${targetVersion}`;
    log(`Installing ${versionSpec} for agent user via NVM npm`);

    const installCmd = [
      `export HOME="${agentHome}"`,
      `export NVM_DIR="${nvmDir}"`,
      `source "${nvmDir}/nvm.sh"`,
      `npm install -g ${versionSpec}`,
    ].join(' && ');

    await execAsync(
      `sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c '${installCmd}'`,
      { cwd: '/', timeout: 180_000 },
    );

    // 2. Resolve installed binary path
    log('Resolving installed openclaw binary path');
    const whichCmd = [
      `export HOME="${agentHome}"`,
      `export NVM_DIR="${nvmDir}"`,
      `source "${nvmDir}/nvm.sh"`,
      `which openclaw`,
    ].join(' && ');

    const { stdout: binaryPath } = await execAsync(
      `sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c '${whichCmd}'`,
      { cwd: '/' },
    );
    const resolvedPath = binaryPath.trim();

    if (!resolvedPath) {
      return { ...empty, message: 'OpenClaw installed but binary path could not be resolved' };
    }

    // 3. Verify version
    log('Verifying OpenClaw installation');
    const verifyCmd = [
      `export HOME="${agentHome}"`,
      `export NVM_DIR="${nvmDir}"`,
      `source "${nvmDir}/nvm.sh"`,
      `openclaw --version`,
    ].join(' && ');

    const { stdout: versionOut } = await execAsync(
      `sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c '${verifyCmd}'`,
      { cwd: '/' },
    );
    const installedVersion = versionOut.trim();

    log(`OpenClaw ${installedVersion} installed at ${resolvedPath}`);
    return {
      success: true,
      version: installedVersion,
      binaryPath: resolvedPath,
      message: `OpenClaw ${installedVersion} installed at ${resolvedPath}`,
    };
  } catch (error) {
    return {
      ...empty,
      message: `OpenClaw installation failed: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Copy the host user's .openclaw config directory to the agent user.
 *
 * - Bulk-copies the entire .openclaw directory
 * - Moves workspace from .openclaw/workspace to {agentHome}/workspace
 * - Sanitizes the config (strips secrets, rewrites paths)
 * - Sets correct ownership for agent user (agent runs the OpenClaw processes)
 */
export function copyOpenClawConfig(options: {
  /** Path to the host user's .openclaw directory (e.g., /Users/david/.openclaw) */
  sourceConfigPath: string;
  /** Agent user's home directory */
  agentHome: string;
  /** Agent username (owns .openclaw and workspace) */
  agentUsername: string;
  /** Socket group name */
  socketGroup: string;
  verbose?: boolean;
}): OpenClawConfigCopyResult {
  const { sourceConfigPath, agentHome, agentUsername, socketGroup, verbose } = options;
  const targetConfigDir = path.join(agentHome, '.openclaw');
  const targetWorkspaceDir = path.join(agentHome, 'workspace');
  const log = (msg: string) => verbose && process.stderr.write(`[SETUP] ${msg}\n`);

  // Derive original user's home from source config path (e.g., /Users/david from /Users/david/.openclaw)
  const originalHome = path.dirname(sourceConfigPath);

  try {
    // 1. Create target directories
    log(`Creating target config directory: ${targetConfigDir}`);
    sudoExec(`mkdir -p "${targetConfigDir}"`);
    sudoExec(`mkdir -p "${targetWorkspaceDir}"`);

    if (!fs.existsSync(sourceConfigPath)) {
      log('Source config path does not exist, creating empty config');
      sudoExec(`mkdir -p "${path.join(targetConfigDir, 'skills')}"`);
      sudoExec(`chown -R ${agentUsername}:${socketGroup} "${targetConfigDir}"`);
      sudoExec(`chown -R ${agentUsername}:${socketGroup} "${targetWorkspaceDir}"`);
      sudoExec(`chmod 2775 "${targetConfigDir}"`);
      sudoExec(`chmod 2775 "${targetWorkspaceDir}"`);
      return {
        success: true,
        configDir: targetConfigDir,
        sanitized: false,
        message: 'Created empty .openclaw directory (source not found)',
      };
    }

    // 2. Bulk-copy entire .openclaw directory
    log(`Copying ${sourceConfigPath} to ${targetConfigDir}`);
    sudoExec(`cp -R "${sourceConfigPath}/." "${targetConfigDir}/"`);

    // 3. Move workspace from .openclaw/workspace to {agentHome}/workspace
    const sourceWorkspaceDir = path.join(sourceConfigPath, 'workspace');
    if (fs.existsSync(sourceWorkspaceDir)) {
      log(`Moving workspace from ${sourceWorkspaceDir} to ${targetWorkspaceDir}`);
      sudoExec(`cp -R "${sourceWorkspaceDir}/." "${targetWorkspaceDir}/"`);
    }
    // Also move the copied workspace out of .openclaw if it ended up there
    const copiedWorkspaceInConfig = path.join(targetConfigDir, 'workspace');
    if (fs.existsSync(copiedWorkspaceInConfig)) {
      log(`Moving workspace out of .openclaw to ${targetWorkspaceDir}`);
      sudoExec(`cp -R "${copiedWorkspaceInConfig}/." "${targetWorkspaceDir}/"`);
      sudoExec(`rm -rf "${copiedWorkspaceInConfig}"`);
    }

    // 4. Read the ORIGINAL config and sanitize (rewrite paths + strip secrets)
    let sanitized = false;
    const sourceJsonPath = path.join(sourceConfigPath, 'openclaw.json');
    if (fs.existsSync(sourceJsonPath)) {
      log('Sanitizing openclaw.json (stripping secrets, rewriting paths)');
      try {
        const config = JSON.parse(fs.readFileSync(sourceJsonPath, 'utf-8'));
        const sanitizedConfig = sanitizeOpenClawConfig(config, originalHome, agentHome);
        const destJsonPath = path.join(targetConfigDir, 'openclaw.json');
        const tempPath = '/tmp/openclaw-clean-config.json';
        fs.writeFileSync(tempPath, JSON.stringify(sanitizedConfig, null, 2));
        sudoExec(`mv "${tempPath}" "${destJsonPath}"`);
        sanitized = true;
      } catch (err) {
        log(`Warning: failed to sanitize config: ${err}`);
      }
    }

    // 5. Rewrite paths in ALL text files inside .openclaw and workspace
    //    Handles session files, scripts, and any other files with hardcoded paths
    log('Rewriting paths in all text files inside .openclaw and workspace');
    const configRewritten = rewritePathsInDirectory(targetConfigDir, originalHome, agentHome, log);
    const workspaceRewritten = rewritePathsInDirectory(targetWorkspaceDir, originalHome, agentHome, log);
    log(`Rewrote paths in ${configRewritten + workspaceRewritten} files`);

    // 6. Set correct ownership — agent user owns both .openclaw and workspace
    log(`Setting ownership: ${agentUsername}:${socketGroup}`);
    sudoExec(`chown -R ${agentUsername}:${socketGroup} "${targetConfigDir}"`);
    sudoExec(`chown -R ${agentUsername}:${socketGroup} "${targetWorkspaceDir}"`);
    sudoExec(`chmod 2775 "${targetConfigDir}"`);
    sudoExec(`chmod 2775 "${targetWorkspaceDir}"`);

    return {
      success: true,
      configDir: targetConfigDir,
      sanitized,
      message: `Copied .openclaw config to ${targetConfigDir}, workspace to ${targetWorkspaceDir}`,
    };
  } catch (error) {
    return {
      success: false,
      configDir: targetConfigDir,
      sanitized: false,
      message: `Failed to copy OpenClaw config: ${(error as Error).message}`,
      error: error as Error,
    };
  }
}

/**
 * Find OpenClaw-related processes running for a given user.
 * Returns PIDs grouped by process type.
 */
function findOpenClawProcesses(username: string): { daemon: number[]; gateway: number[]; other: number[] } {
  const result: { daemon: number[]; gateway: number[]; other: number[] } = { daemon: [], gateway: [], other: [] };

  try {
    // Find all openclaw processes owned by the user
    const { output } = sudoExec(`ps -u ${username} -o pid,command`);
    if (!output) return result;

    for (const line of output.split('\n')) {
      if (!line.includes('openclaw')) continue;
      const pidMatch = line.match(/^\s*(\d+)/);
      if (!pidMatch) continue;
      const pid = parseInt(pidMatch[1], 10);

      if (line.includes('daemon')) {
        result.daemon.push(pid);
      } else if (line.includes('gateway')) {
        result.gateway.push(pid);
      } else {
        result.other.push(pid);
      }
    }
  } catch {
    // ps failed — no processes found
  }

  return result;
}

/**
 * Stop the host user's OpenClaw daemon and gateway processes.
 *
 * 1. Checks for running OpenClaw processes via `ps`
 * 2. Tries graceful stop via `openclaw daemon/gateway stop`
 * 3. Falls back to `kill` if processes are still alive
 * 4. Never fails — all errors are caught and logged
 */
export async function stopHostOpenClaw(options: {
  /** The original user running OpenClaw (e.g., 'david') */
  originalUser: string;
  verbose?: boolean;
}): Promise<StopHostOpenClawResult> {
  const { originalUser, verbose } = options;
  const log = (msg: string) => verbose && process.stderr.write(`[SETUP] ${msg}\n`);

  let daemonStopped = false;
  let gatewayStopped = false;

  // 1. Check what's running
  const procs = findOpenClawProcesses(originalUser);
  const totalProcs = procs.daemon.length + procs.gateway.length + procs.other.length;
  log(`Found ${totalProcs} OpenClaw process(es) for ${originalUser} (daemon: ${procs.daemon.length}, gateway: ${procs.gateway.length}, other: ${procs.other.length})`);

  if (totalProcs === 0) {
    log('No OpenClaw processes running — nothing to stop');
    return {
      success: true,
      daemonStopped: true,
      gatewayStopped: true,
      message: 'No OpenClaw processes were running',
    };
  }

  // 2. Try graceful stop via openclaw CLI
  if (procs.gateway.length > 0) {
    log(`Stopping OpenClaw gateway for user: ${originalUser}`);
    try {
      await execAsync(
        `sudo -H -u ${originalUser} openclaw gateway stop`,
        { cwd: '/', timeout: 15_000 },
      );
      gatewayStopped = true;
      log('OpenClaw gateway stopped gracefully');
    } catch {
      log('OpenClaw gateway stop command failed, will try kill');
    }
  } else {
    gatewayStopped = true;
  }

  if (procs.daemon.length > 0) {
    log(`Stopping OpenClaw daemon for user: ${originalUser}`);
    try {
      await execAsync(
        `sudo -H -u ${originalUser} openclaw daemon stop`,
        { cwd: '/', timeout: 15_000 },
      );
      daemonStopped = true;
      log('OpenClaw daemon stopped gracefully');
    } catch {
      log('OpenClaw daemon stop command failed, will try kill');
    }
  } else {
    daemonStopped = true;
  }

  // 3. Fallback: kill any remaining processes
  const remaining = findOpenClawProcesses(originalUser);
  const allPids = [...remaining.daemon, ...remaining.gateway, ...remaining.other];
  if (allPids.length > 0) {
    log(`${allPids.length} OpenClaw process(es) still running, sending SIGTERM`);
    for (const pid of allPids) {
      try {
        sudoExec(`kill ${pid}`);
      } catch {
        // Ignore — process may have already exited
      }
    }

    // Brief wait, then SIGKILL any stubborn ones
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const stubborn = findOpenClawProcesses(originalUser);
    const stubbornPids = [...stubborn.daemon, ...stubborn.gateway, ...stubborn.other];
    if (stubbornPids.length > 0) {
      log(`${stubbornPids.length} process(es) survived SIGTERM, sending SIGKILL`);
      for (const pid of stubbornPids) {
        try {
          sudoExec(`kill -9 ${pid}`);
        } catch {
          // Ignore
        }
      }
    }

    daemonStopped = true;
    gatewayStopped = true;
  }

  return {
    success: true,
    daemonStopped,
    gatewayStopped,
    message: `Daemon: stopped, Gateway: stopped`,
  };
}

/**
 * Get the original (host) user who invoked the setup.
 * Uses SUDO_USER env var or falls back to os.userInfo().
 */
export function getOriginalUser(): string {
  return process.env['SUDO_USER'] || os.userInfo().username;
}

/**
 * Get the host user's .openclaw config path.
 */
export function getHostOpenClawConfigPath(username?: string): string | null {
  const user = username || getOriginalUser();
  const configPath = `/Users/${user}/.openclaw`;
  if (fs.existsSync(configPath)) {
    return configPath;
  }
  return null;
}

// ─── Onboard & Gateway ──────────────────────────────────────────────────────

/**
 * Run `openclaw onboard --non-interactive ...` as the agent user to initialize
 * OpenClaw's internal state (session files, local config). Must run after
 * install-openclaw and copy-openclaw-config.
 */
export async function onboardAgentOpenClaw(options: {
  agentHome: string;
  agentUsername: string;
  verbose?: boolean;
}): Promise<{ success: boolean; message: string }> {
  const { agentHome, agentUsername, verbose } = options;
  const nvmDir = `${agentHome}/.nvm`;
  const log = (msg: string) => verbose && process.stderr.write(`[SETUP] ${msg}\n`);

  const onboardCmd = [
    `export HOME="${agentHome}"`,
    `export NVM_DIR="${nvmDir}"`,
    `source "${nvmDir}/nvm.sh"`,
    `openclaw onboard --non-interactive --accept-risk --flow quickstart --mode local --no-install-daemon --daemon-runtime node --skip-channels --skip-skills --skip-health --skip-ui --node-manager npm`,
  ].join(' && ');

  log('Running openclaw onboard as agent user');
  try {
    const { stdout, stderr } = await execAsync(
      `sudo -H -u ${agentUsername} /bin/bash --norc --noprofile -c '${onboardCmd}'`,
      { cwd: '/', timeout: 120_000 },
    );
    if (verbose && stdout.trim()) log(`onboard stdout: ${stdout.trim()}`);
    if (verbose && stderr.trim()) log(`onboard stderr: ${stderr.trim()}`);
    log('OpenClaw onboard completed');
    return { success: true, message: 'OpenClaw onboard completed' };
  } catch (err) {
    const msg = (err as Error).message;
    log(`OpenClaw onboard failed (non-fatal): ${msg}`);
    return { success: false, message: `OpenClaw onboard failed: ${msg}` };
  }
}

/**
 * Start `openclaw gateway` as the agent user in the background.
 * Returns the PID of the spawned process.
 *
 * Uses `spawn` with `detached: true` so the gateway survives the parent
 * process exiting. Logs go to /var/log/agenshield/openclaw-gateway.log.
 */
export async function startAgentOpenClawGateway(options: {
  agentHome: string;
  agentUsername: string;
  verbose?: boolean;
}): Promise<{ success: boolean; pid?: number; message: string }> {
  const { agentHome, agentUsername, verbose } = options;
  const nvmDir = `${agentHome}/.nvm`;
  const log = (msg: string) => verbose && process.stderr.write(`[SETUP] ${msg}\n`);

  const gatewayCmd = [
    `export HOME="${agentHome}"`,
    `export NVM_DIR="${nvmDir}"`,
    `source "${nvmDir}/nvm.sh"`,
    `exec openclaw gateway run`,
  ].join(' && ');

  log('Starting openclaw gateway run in background');
  try {
    // Ensure log directory and files exist
    sudoExec('mkdir -p /var/log/agenshield');
    sudoExec(`touch /var/log/agenshield/openclaw-gateway.log /var/log/agenshield/openclaw-gateway.error.log`);
    sudoExec(`chown ${agentUsername} /var/log/agenshield/openclaw-gateway.log /var/log/agenshield/openclaw-gateway.error.log`);

    const outLog = fs.openSync('/var/log/agenshield/openclaw-gateway.log', 'a');
    const errLog = fs.openSync('/var/log/agenshield/openclaw-gateway.error.log', 'a');

    const child = spawn(
      'sudo',
      ['-H', '-u', agentUsername, '/bin/bash', '--norc', '--noprofile', '-c', gatewayCmd],
      {
        cwd: '/',
        detached: true,
        stdio: ['ignore', outLog, errLog],
      },
    );

    const pid = child.pid;
    child.unref();
    fs.closeSync(outLog);
    fs.closeSync(errLog);

    if (!pid) {
      return { success: false, message: 'Failed to spawn openclaw gateway — no PID returned' };
    }

    // Brief wait to check the process didn't exit immediately
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Verify it's still running
    try {
      process.kill(pid, 0); // signal 0 = check if alive
      log(`OpenClaw gateway started (PID: ${pid})`);
      return { success: true, pid, message: `OpenClaw gateway running (PID: ${pid})` };
    } catch {
      log('OpenClaw gateway process exited immediately — check logs');
      return { success: false, message: 'OpenClaw gateway exited immediately. Check /var/log/agenshield/openclaw-gateway.error.log' };
    }
  } catch (err) {
    const msg = (err as Error).message;
    log(`Failed to start openclaw gateway: ${msg}`);
    return { success: false, message: `Failed to start openclaw gateway: ${msg}` };
  }
}

/**
 * Start `openclaw dashboard` as the agent user in the background.
 * Returns the PID of the spawned process.
 */
export async function startAgentOpenClawDashboard(options: {
  agentHome: string;
  agentUsername: string;
  verbose?: boolean;
}): Promise<{ success: boolean; pid?: number; message: string }> {
  const { agentHome, agentUsername, verbose } = options;
  const nvmDir = `${agentHome}/.nvm`;
  const log = (msg: string) => verbose && process.stderr.write(`[SETUP] ${msg}\n`);

  const dashboardCmd = [
    `export HOME="${agentHome}"`,
    `export NVM_DIR="${nvmDir}"`,
    `source "${nvmDir}/nvm.sh"`,
    `exec openclaw dashboard`,
  ].join(' && ');

  log('Starting openclaw dashboard in background');
  try {
    sudoExec(`touch /var/log/agenshield/openclaw-dashboard.log /var/log/agenshield/openclaw-dashboard.error.log`);
    sudoExec(`chown ${agentUsername} /var/log/agenshield/openclaw-dashboard.log /var/log/agenshield/openclaw-dashboard.error.log`);

    const outLog = fs.openSync('/var/log/agenshield/openclaw-dashboard.log', 'a');
    const errLog = fs.openSync('/var/log/agenshield/openclaw-dashboard.error.log', 'a');

    const child = spawn(
      'sudo',
      ['-H', '-u', agentUsername, '/bin/bash', '--norc', '--noprofile', '-c', dashboardCmd],
      {
        cwd: '/',
        detached: true,
        stdio: ['ignore', outLog, errLog],
      },
    );

    const pid = child.pid;
    child.unref();
    fs.closeSync(outLog);
    fs.closeSync(errLog);

    if (!pid) {
      return { success: false, message: 'Failed to spawn openclaw dashboard — no PID returned' };
    }

    log(`OpenClaw dashboard started (PID: ${pid})`);
    return { success: true, pid, message: `OpenClaw dashboard running (PID: ${pid})` };
  } catch (err) {
    const msg = (err as Error).message;
    log(`Failed to start openclaw dashboard: ${msg}`);
    return { success: false, message: `Failed to start openclaw dashboard: ${msg}` };
  }
}
