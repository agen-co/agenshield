/**
 * Configuration path utilities for AgenShield daemon
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CONFIG_DIR, CONFIG_FILE, PID_FILE, LOG_FILE, SKILL_BACKUP_DIR } from '@agenshield/ipc';

/**
 * Get the configuration directory path.
 * Respects AGENSHIELD_CONFIG_DIR env var for dev/test isolation.
 */
export function getConfigDir(): string {
  const override = process.env['AGENSHIELD_CONFIG_DIR'];
  if (override) return path.resolve(override);
  return path.join(os.homedir(), CONFIG_DIR);
}

/**
 * Ensure the config directory exists (creates with 0o700 if missing).
 */
export function ensureConfigDir(): void {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/**
 * @deprecated Config is now stored in SQLite. Use getConfigDir() for the DB directory.
 */
export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE);
}

/**
 * Get the PID file path
 */
export function getPidPath(): string {
  return path.join(getConfigDir(), PID_FILE);
}

/**
 * Get the log file path
 */
export function getLogPath(): string {
  return path.join(getConfigDir(), LOG_FILE);
}

/**
 * Whether the daemon is running in dev mode.
 * Dev mode is signaled by setting AGENSHIELD_AGENT_HOME (e.g. `./tmp/dev-agent`).
 */
export function isDevMode(): boolean {
  return !!process.env['AGENSHIELD_AGENT_HOME'];
}

/**
 * Get the system-level config directory.
 * In dev mode (AGENSHIELD_AGENT_HOME set), uses ~/.agenshield (user-writable).
 * In production, uses /opt/agenshield/config (root-owned).
 */
export function getSystemConfigDir(): string {
  if (isDevMode()) {
    return getConfigDir();
  }
  return '/opt/agenshield/config';
}

/**
 * Get the quarantine directory for unapproved skills.
 * In dev mode, uses ~/.agenshield/quarantine/skills.
 * In production, uses /opt/agenshield/quarantine/skills.
 */
export function getQuarantineDir(): string {
  if (isDevMode()) {
    return path.join(getConfigDir(), 'quarantine', 'skills');
  }
  return '/opt/agenshield/quarantine/skills';
}

/**
 * Get the skill backup directory path (under CONFIG_DIR).
 */
export function getSkillBackupDir(): string {
  return path.join(getConfigDir(), SKILL_BACKUP_DIR);
}

/**
 * Get the agent's skills directory path.
 * Returns empty string if AGENSHIELD_AGENT_HOME is not set.
 */
export function getSkillsDir(): string {
  const agentHome = process.env['AGENSHIELD_AGENT_HOME'];
  if (agentHome) return path.join(agentHome, '.openclaw', 'workspace', 'skills');
  return '';
}
