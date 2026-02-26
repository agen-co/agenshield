/**
 * Default configuration for AgenShield daemon
 */

import { createRequire } from 'node:module';

import { DEFAULT_PORT, DEFAULT_HOST } from '@agenshield/ipc';
import type { ShieldConfig } from '@agenshield/ipc';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { version: string };

export const VERSION = pkg.version;

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
    policies: [],
    vault: {
      enabled: false,
      provider: 'local',
    },
  };
}
