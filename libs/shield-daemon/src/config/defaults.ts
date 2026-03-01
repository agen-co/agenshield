/**
 * Default configuration for AgenShield daemon
 */

import { createRequire } from 'node:module';

import { DEFAULT_PORT, DEFAULT_HOST, getSEAVersion } from '@agenshield/ipc';
import type { ShieldConfig } from '@agenshield/ipc';

function resolveVersion(): string {
  const seaVersion = getSEAVersion();
  if (seaVersion) return seaVersion;
  const require = createRequire(import.meta.url);
  const pkg = require('./package.json') as { version: string };
  return pkg.version;
}

export const VERSION = resolveVersion();

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
      enforcerIntervalMs: 1000,
    },
    policies: [],
    vault: {
      enabled: false,
      provider: 'local',
    },
  };
}
