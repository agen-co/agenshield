/**
 * Default configuration for AgenShield daemon
 */

import { DEFAULT_PORT, DEFAULT_HOST, OPENCLAW_PRESET } from '@agenshield/ipc';
import type { ShieldConfig } from '@agenshield/ipc';

export const VERSION = '0.1.0';

/**
 * Get default configuration
 */
export function getDefaultConfig(): ShieldConfig {
  return {
    version: VERSION,
    daemon: {
      port: DEFAULT_PORT,
      host: DEFAULT_HOST,
      logLevel: 'info',
      enableHostsEntry: false,
    },
    policies: [...OPENCLAW_PRESET.policies],
    vault: {
      enabled: false,
      provider: 'local',
    },
  };
}
