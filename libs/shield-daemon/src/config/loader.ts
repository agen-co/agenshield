/**
 * Configuration loader for AgenShield daemon
 *
 * Reads config from SQLite (ConfigRepository + PolicyRepository).
 * Uses an in-memory cache to prevent repeated DB reads.
 * Config is loaded from DB once (with HMAC verification), then
 * served from cache. Only saveConfig/updateConfig mutate the cache.
 */

import type { ShieldConfig, PolicyConfig } from '@agenshield/ipc';
import { DEFAULT_PORT } from '@agenshield/ipc';
import { getStorage } from '@agenshield/storage';
import type { ConfigData } from '@agenshield/storage';
import { getDefaultConfig } from './defaults';
import { computeConfigHmac, verifyConfigHmac } from './integrity';
import { getVault } from '../vault';
import { ConfigTamperError } from './errors';

/** In-memory config cache — eliminates repeated DB reads. */
let cachedConfig: ShieldConfig | null = null;

/**
 * Assemble a ShieldConfig from ConfigData + policies.
 */
function assembleConfig(data: ConfigData, policies: PolicyConfig[]): ShieldConfig {
  const defaults = getDefaultConfig();

  return {
    version: data.version ?? defaults.version,
    daemon: {
      port: data.daemonPort ?? defaults.daemon.port,
      host: data.daemonHost ?? defaults.daemon.host,
      logLevel: (data.daemonLogLevel as ShieldConfig['daemon']['logLevel']) ?? defaults.daemon.logLevel,
      enableHostsEntry: data.daemonEnableHostsEntry ?? defaults.daemon.enableHostsEntry,
    },
    policies,
    defaultAction: (data.defaultAction as ShieldConfig['defaultAction']) ?? defaults.defaultAction,
    vault: {
      enabled: data.vaultEnabled ?? defaults.vault?.enabled ?? false,
      provider: (data.vaultProvider ?? defaults.vault?.provider ?? 'local') as 'local' | 'env',
    },
    skills: data.skillsJson ? JSON.parse(data.skillsJson) : defaults.skills,
    soul: data.soulJson ? JSON.parse(data.soulJson) : defaults.soul,
    broker: data.brokerJson ? JSON.parse(data.brokerJson) : defaults.broker,
  };
}

/**
 * Load configuration from DB (or cache).
 *
 * On first load, reads from ConfigRepository + PolicyRepository.
 * Subsequent calls return the cached config without re-reading DB.
 */
export function loadConfig(): ShieldConfig {
  if (cachedConfig) return cachedConfig;

  try {
    const storage = getStorage();
    const configData = storage.config.get();
    const policies = storage.policies.getAll();

    if (!configData) {
      const defaults = getDefaultConfig();
      cachedConfig = defaults;
      return defaults;
    }

    const config = assembleConfig(configData, policies);

    // Migrate old port 6969 to new default 5200
    if (config.daemon.port === 6969) {
      config.daemon.port = DEFAULT_PORT;
    }

    cachedConfig = config;
    return config;
  } catch (error) {
    console.error('Failed to load config from DB, using defaults:', error);
    return getDefaultConfig(); // Don't cache — allow retry on next call
  }
}

/**
 * Verify the config HMAC from the vault.
 * Must be called after the vault is initialized (async).
 *
 * - No stored HMAC → trust-on-first-use: compute and store
 * - HMAC matches → no-op
 * - HMAC mismatch → replace cache with deny-all, emit event
 */
export async function verifyConfigIntegrity(): Promise<void> {
  const config = loadConfig();
  const vault = getVault();

  const storedHmac = await vault.get('configHmac');
  if (!storedHmac) {
    // Trust-on-first-use: compute and store
    const hmac = computeConfigHmac(config.policies);
    await vault.set('configHmac', hmac);
    return;
  }

  if (!verifyConfigHmac(config.policies, storedHmac)) {
    console.error('[SECURITY] Config tamper detected — HMAC mismatch. Enforcing deny-all.');

    // Emit security event (lazy import to avoid circular dependency)
    try {
      const { emitEvent } = await import('../events/emitter');
      emitEvent('security:config_tampered', {
        detectedAt: new Date().toISOString(),
        action: 'deny_all',
      });
    } catch {
      // Event emission is best-effort
    }

    // Replace cached config with deny-all fallback
    cachedConfig = {
      ...config,
      policies: [],
      defaultAction: 'deny',
    };

    throw new ConfigTamperError();
  }
}

/**
 * Save configuration to DB and update cache + HMAC.
 */
export function saveConfig(config: ShieldConfig): void {
  const storage = getStorage();

  // Save config data (non-policy fields)
  storage.config.set({
    version: config.version,
    daemonPort: config.daemon.port,
    daemonHost: config.daemon.host,
    daemonLogLevel: config.daemon.logLevel,
    daemonEnableHostsEntry: config.daemon.enableHostsEntry,
    defaultAction: config.defaultAction ?? null,
    vaultEnabled: config.vault?.enabled ?? null,
    vaultProvider: config.vault?.provider ?? null,
    skillsJson: config.skills ? JSON.stringify(config.skills) : null,
    soulJson: config.soul ? JSON.stringify(config.soul) : null,
    brokerJson: config.broker ? JSON.stringify(config.broker) : null,
  });

  // Sync policies: delete all base-scope policies, re-insert
  const existingPolicies = storage.policies.getAll();
  for (const p of existingPolicies) {
    storage.policies.delete(p.id);
  }
  for (const p of config.policies) {
    storage.policies.create(p);
  }

  cachedConfig = config;

  // Recompute HMAC asynchronously (fire-and-forget)
  storeConfigHmac(config.policies).catch((err) => {
    console.error('[config] Failed to store config HMAC:', err);
  });
}

/**
 * Update configuration in DB (merge with existing)
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

/**
 * Clear the config cache (for testing or forced reload).
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * Compute and store config HMAC in the vault.
 */
async function storeConfigHmac(policies: ShieldConfig['policies']): Promise<void> {
  const hmac = computeConfigHmac(policies);
  const vault = getVault();
  await vault.set('configHmac', hmac);
}
