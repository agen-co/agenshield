/**
 * Configuration path utilities for AgenShield daemon
 */

import * as path from 'node:path';
import * as os from 'node:os';
import { CONFIG_DIR, CONFIG_FILE, PID_FILE, LOG_FILE } from '@agenshield/ipc';

/**
 * Get the configuration directory path
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR);
}

/**
 * Get the configuration file path
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
 * Get the system-level config directory.
 * In dev mode (AGENSHIELD_AGENT_HOME set), uses ~/.agenshield (user-writable).
 * In production, uses /opt/agenshield/config (root-owned).
 */
export function getSystemConfigDir(): string {
  if (process.env['AGENSHIELD_AGENT_HOME']) {
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
  if (process.env['AGENSHIELD_AGENT_HOME']) {
    return path.join(getConfigDir(), 'quarantine', 'skills');
  }
  return '/opt/agenshield/quarantine/skills';
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
