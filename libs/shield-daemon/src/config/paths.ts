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
