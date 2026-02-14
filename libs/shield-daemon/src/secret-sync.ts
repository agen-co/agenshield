/**
 * Secret Policy Sync
 *
 * Syncs vault secrets to the broker via IPC push over Unix socket.
 * The broker holds secrets in-memory only — no secrets ever touch disk.
 *
 * Flow:
 *   1. Read VaultSecret[] from SQLite storage (requires unlocked vault)
 *   2. Separate global secrets (policyIds=[]) from policy-linked
 *   3. For policy-linked: include the policy's target + patterns
 *   4. Push SyncedSecrets payload to broker via secretsSync()
 */

import type { PolicyConfig, VaultSecret, SyncedSecrets, SecretPolicyBinding, ScopeFilter } from '@agenshield/ipc';
import { getStorage } from '@agenshield/storage';
import { pushSecretsToBroker } from './services/broker-bridge';

interface Logger {
  warn(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
}

const noop: Logger = { warn() { /* no-op */ }, info() { /* no-op */ } };

/**
 * Sync vault secrets to the broker via IPC push.
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
  scope?: ScopeFilter,
): Promise<void> {
  const log = logger ?? noop;

  let secrets: VaultSecret[];
  try {
    const storage = getStorage();
    secrets = scope ? storage.for(scope).secrets.getAll() : storage.secrets.getAll();
  } catch {
    // Vault may be locked — push empty payload so broker has clean state
    const empty: SyncedSecrets = {
      version: '1.0.0',
      syncedAt: new Date().toISOString(),
      globalSecrets: {},
      policyBindings: [],
    };
    await pushSecretsToBroker(empty);
    return;
  }

  if (secrets.length === 0) {
    // Push empty so broker knows there are no secrets
    const empty: SyncedSecrets = {
      version: '1.0.0',
      syncedAt: new Date().toISOString(),
      globalSecrets: {},
      policyBindings: [],
    };
    await pushSecretsToBroker(empty);
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

  await pushSecretsToBroker(synced);
  log.info(
    `[secret-sync] pushed ${Object.keys(globalSecrets).length} global + ${policyBindings.length} policy-bound secret groups to broker`
  );
}
