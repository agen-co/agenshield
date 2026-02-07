/**
 * Secret Policy Sync
 *
 * Syncs vault secrets to the broker's synced-secrets.json file.
 * The broker reads this file to automatically inject secrets as
 * environment variables into spawned processes.
 *
 * Flow:
 *   1. Read VaultSecret[] from the daemon vault
 *   2. Separate global secrets (policyIds=[]) from policy-linked
 *   3. For policy-linked: include the policy's target + patterns
 *   4. Write synced-secrets.json for the broker to pick up
 *
 * Follows the same pattern as command-sync.ts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PolicyConfig, VaultSecret, SyncedSecrets, SecretPolicyBinding } from '@agenshield/ipc';
import { SYNCED_SECRETS_FILE } from '@agenshield/ipc';
import { getVault } from './vault';
import { getSystemConfigDir } from './config/paths';

interface Logger {
  warn(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
}

const noop: Logger = { warn() { /* no-op */ }, info() { /* no-op */ } };

/** Broker's synced secrets file (dev-aware via getSystemConfigDir) */
function getSyncedSecretsPath(): string {
  return path.join(getSystemConfigDir(), SYNCED_SECRETS_FILE);
}

/**
 * Sync vault secrets to the broker's synced-secrets.json file.
 *
 * Groups secrets into:
 * 1. Global secrets (policyIds=[]) — always injected into every exec
 * 2. Policy-bound secrets — injected when the policy's patterns match
 *
 * For policy-bound secrets, the corresponding policy's target and patterns
 * are included so the broker can do its own matching without an RPC call.
 */
export async function syncSecrets(
  policies: PolicyConfig[],
  logger?: Logger,
): Promise<void> {
  const log = logger ?? noop;
  const vault = getVault();
  const secrets: VaultSecret[] = (await vault.get('secrets')) ?? [];

  if (secrets.length === 0) {
    // Write empty sync file so broker knows there are no secrets
    writeSyncFile({
      version: '1.0.0',
      syncedAt: new Date().toISOString(),
      globalSecrets: {},
      policyBindings: [],
    }, log);
    return;
  }

  // Build policy lookup map: policyId -> PolicyConfig
  const policyMap = new Map<string, PolicyConfig>();
  for (const p of policies) {
    policyMap.set(p.id, p);
  }

  // Separate global vs policy-linked
  const globalSecrets: Record<string, string> = {};
  // Accumulate per-policy secrets: policyId -> Record<name, value>
  const policySecretsMap = new Map<string, Record<string, string>>();

  for (const secret of secrets) {
    // Skip standalone secrets — stored-only, never injected
    const scope = secret.scope ?? (secret.policyIds.length === 0 ? 'global' : 'policed');
    if (scope === 'standalone') continue;

    if (secret.policyIds.length === 0) {
      // Global secret — use secret.name as env var name
      globalSecrets[secret.name] = secret.value;
    } else {
      // Policy-linked — add to each linked policy
      for (const pid of secret.policyIds) {
        if (!policySecretsMap.has(pid)) {
          policySecretsMap.set(pid, {});
        }
        policySecretsMap.get(pid)![secret.name] = secret.value;
      }
    }
  }

  // Build policy bindings with patterns for broker-side matching
  const policyBindings: SecretPolicyBinding[] = [];
  for (const [policyId, secretsMap] of policySecretsMap) {
    const policy = policyMap.get(policyId);
    if (!policy) {
      log.warn(`[secret-sync] policy ${policyId} referenced by secret but not found, skipping`);
      continue;
    }
    // Only sync url and command policies (filesystem policies don't apply to exec)
    if (policy.target !== 'url' && policy.target !== 'command') {
      continue;
    }
    if (!policy.enabled) {
      continue; // Skip disabled policies
    }
    policyBindings.push({
      policyId,
      target: policy.target as 'url' | 'command',
      patterns: policy.patterns,
      secrets: secretsMap,
    });
  }

  const synced: SyncedSecrets = {
    version: '1.0.0',
    syncedAt: new Date().toISOString(),
    globalSecrets,
    policyBindings,
  };

  writeSyncFile(synced, log);
  log.info(
    `[secret-sync] synced ${Object.keys(globalSecrets).length} global + ${policyBindings.length} policy-bound secret groups`
  );
}

function writeSyncFile(synced: SyncedSecrets, log: Logger): void {
  const filePath = getSyncedSecretsPath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(synced, null, 2) + '\n', { mode: 0o600 });
  } catch {
    log.warn(`[secret-sync] cannot write to ${filePath}`);
  }
}
