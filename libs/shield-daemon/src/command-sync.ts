/**
 * Command Policy Sync
 *
 * Syncs daemon command policies to the broker's dynamic allowlist
 * (/opt/agenshield/config/allowed-commands.json) and ensures wrappers
 * are installed in both user bin directories.
 *
 * Flow:
 *   1. Extract command names from `allow` + `target: 'command'` policies
 *   2. Resolve each command name to absolute binary paths
 *   3. Write the allowed-commands.json for the broker to pick up
 *   4. Install all proxied command wrappers in agent + workspace user $HOME/bin
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { PolicyConfig, SystemState } from '@agenshield/ipc';

interface Logger {
  warn(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
}

const noop: Logger = { warn() { /* no-op */ }, info() { /* no-op */ } };

/** Broker's dynamic allowlist file */
const ALLOWED_COMMANDS_PATH = '/opt/agenshield/config/allowed-commands.json';

/** Standard directories to search for real binaries */
const BIN_SEARCH_DIRS = [
  '/usr/bin',
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/sbin',
  '/usr/local/sbin',
  '/opt/homebrew/sbin',
];

/** All proxied commands that get wrapper shims */
const ALL_PROXIED_COMMANDS = [
  'curl', 'wget', 'git', 'ssh', 'scp', 'rsync',
  'brew', 'npm', 'npx', 'pip', 'pip3',
  'open-url', 'shieldctl', 'agenco',
];

interface AllowedCommand {
  name: string;
  paths: string[];
  addedAt: string;
  addedBy: string;
  category?: string;
}

interface AllowedCommandsConfig {
  version: string;
  commands: AllowedCommand[];
}

/**
 * Resolve a command name to absolute binary paths on this system.
 * Returns array of existing paths (ordered by preference).
 */
function resolveCommandPaths(name: string): string[] {
  const paths: string[] = [];

  // Check standard bin dirs
  for (const dir of BIN_SEARCH_DIRS) {
    const candidate = path.join(dir, name);
    try {
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);
        if (stat.isFile() && (stat.mode & 0o111) !== 0) {
          paths.push(candidate);
        }
      }
    } catch {
      // skip unreadable
    }
  }

  // Fallback: `which` (catches PATH entries we didn't scan)
  if (paths.length === 0) {
    try {
      const result = execSync(`which ${name} 2>/dev/null`, { encoding: 'utf-8' }).trim();
      if (result && path.isAbsolute(result)) {
        paths.push(result);
      }
    } catch {
      // not found
    }
  }

  return paths;
}

/**
 * Extract the base command name from a policy pattern.
 *
 * Patterns can be:
 *   - "git" → "git"
 *   - "git push" → "git"
 *   - "npm *" → "npm"
 *   - "curl https://*" → "curl"
 */
function extractCommandName(pattern: string): string {
  return pattern.trim().split(/\s+/)[0];
}

/**
 * Sync command policies to the broker's dynamic allowlist.
 *
 * Reads allowed command policies, resolves binary paths,
 * and writes /opt/agenshield/config/allowed-commands.json.
 */
export function syncCommandPolicies(
  policies: PolicyConfig[],
  logger?: Logger,
): void {
  const log = logger ?? noop;

  // Extract unique command names from allowed command policies
  const commandPolicies = policies.filter(
    (p) => p.target === 'command' && p.action === 'allow' && p.enabled,
  );

  const commandNames = new Set<string>();
  for (const policy of commandPolicies) {
    for (const pattern of policy.patterns) {
      const name = extractCommandName(pattern);
      if (name) commandNames.add(name);
    }
  }

  // Build the allowlist entries
  const commands: AllowedCommand[] = [];
  const now = new Date().toISOString();

  for (const name of commandNames) {
    const paths = resolveCommandPaths(name);
    if (paths.length === 0) {
      log.warn(`[command-sync] command '${name}' not found on system, adding without paths`);
    }
    commands.push({
      name,
      paths,
      addedAt: now,
      addedBy: 'policy',
      category: 'policy-managed',
    });
  }

  // Write the allowlist file
  const config: AllowedCommandsConfig = {
    version: '1.0.0',
    commands,
  };

  try {
    const dir = path.dirname(ALLOWED_COMMANDS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(ALLOWED_COMMANDS_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    log.info(`[command-sync] wrote ${commands.length} commands to allowlist`);
  } catch (err) {
    log.warn(`[command-sync] failed to write allowlist: ${(err as Error).message}`);
  }
}

/**
 * Ensure all proxied command wrappers are installed in a user's bin directory.
 * Uses the sandbox library's installSpecificWrappers if available,
 * or falls back to creating symlinks to shield-exec.
 */
function installWrappersInDir(binDir: string, log: Logger): void {
  const shieldExecPath = '/opt/agenshield/bin/shield-exec';

  if (!fs.existsSync(binDir)) {
    try {
      fs.mkdirSync(binDir, { recursive: true, mode: 0o755 });
    } catch (err) {
      log.warn(`[command-sync] failed to create bin dir ${binDir}: ${(err as Error).message}`);
      return;
    }
  }

  for (const cmd of ALL_PROXIED_COMMANDS) {
    const wrapperPath = path.join(binDir, cmd);
    if (fs.existsSync(wrapperPath)) {
      continue; // Already installed
    }

    // Create symlink to shield-exec
    try {
      if (fs.existsSync(shieldExecPath)) {
        fs.symlinkSync(shieldExecPath, wrapperPath);
      } else {
        // shield-exec not installed yet — skip silently
        log.warn(`[command-sync] shield-exec not found at ${shieldExecPath}, skipping ${cmd} wrapper`);
      }
    } catch (err) {
      log.warn(`[command-sync] failed to create wrapper ${wrapperPath}: ${(err as Error).message}`);
    }
  }
}

/**
 * Ensure wrappers are installed in both the agent user's and
 * the workspace user's bin directories.
 *
 * Both directories are derived from state.json:
 *   - Agent user (type='agent') → homeDir/bin
 *   - If AGENSHIELD_AGENT_HOME is set, also use that
 */
export function ensureWrappersInstalled(
  state: SystemState,
  logger?: Logger,
): void {
  const log = logger ?? noop;

  const agentUser = state.users.find((u) => u.type === 'agent');
  if (!agentUser) {
    log.warn('[command-sync] no agent user in state, skipping wrapper installation');
    return;
  }

  const agentBinDir = path.join(agentUser.homeDir, 'bin');
  log.info(`[command-sync] ensuring wrappers in agent bin: ${agentBinDir}`);
  installWrappersInDir(agentBinDir, log);

  // Also install in AGENSHIELD_AGENT_HOME if set and different
  const agentHomeEnv = process.env['AGENSHIELD_AGENT_HOME'];
  if (agentHomeEnv && agentHomeEnv !== agentUser.homeDir) {
    const envBinDir = path.join(agentHomeEnv, 'bin');
    log.info(`[command-sync] ensuring wrappers in env agent bin: ${envBinDir}`);
    installWrappersInDir(envBinDir, log);
  }
}

/**
 * Full sync: update allowlist + ensure wrappers installed.
 * Called from PUT /config when policies change.
 */
export function syncCommandPoliciesAndWrappers(
  policies: PolicyConfig[],
  state: SystemState,
  logger?: Logger,
): void {
  syncCommandPolicies(policies, logger);
  ensureWrappersInstalled(state, logger);
}
