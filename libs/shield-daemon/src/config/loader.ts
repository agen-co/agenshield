/**
 * Configuration loader for AgenShield daemon
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ShieldConfig } from '@agenshield/ipc';
import { ShieldConfigSchema, DEFAULT_PORT } from '@agenshield/ipc';
import { getConfigDir, getConfigPath } from './paths';
import { getDefaultConfig } from './defaults';

/**
 * Ensure the configuration directory exists
 */
export function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Load configuration from disk
 * @returns The loaded configuration, or default if not found
 */
export function loadConfig(): ShieldConfig {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return getDefaultConfig();
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const validated = ShieldConfigSchema.parse(parsed);

    // Migrate old port 6969 to new default 5200
    if (validated.daemon.port === 6969) {
      validated.daemon.port = DEFAULT_PORT;
    }

    return validated;
  } catch (error) {
    console.error('Failed to load config, using defaults:', error);
    return getDefaultConfig();
  }
}

/**
 * Save configuration to disk
 * @param config The configuration to save
 */
export function saveConfig(config: ShieldConfig): void {
  ensureConfigDir();
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Update configuration on disk (merge with existing)
 * @param updates Partial configuration to merge
 * @returns The updated configuration
 */
export function updateConfig(updates: Partial<ShieldConfig>): ShieldConfig {
  const current = loadConfig();
  const updated: ShieldConfig = {
    ...current,
    ...updates,
    daemon: {
      ...current.daemon,
      ...(updates.daemon || {}),
    },
    policies: updates.policies ?? current.policies,
    vault: updates.vault ?? current.vault,
  };
  saveConfig(updated);
  return updated;
}
