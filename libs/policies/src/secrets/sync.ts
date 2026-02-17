/**
 * Secret Policy Sync
 *
 * Builds a SyncedSecrets payload from vault secrets and policies.
 * Takes a push callback instead of importing broker-bridge directly,
 * so this module stays daemon-agnostic.
 *
 * Flow:
 *   1. Read VaultSecret[] from storage (requires unlocked vault)
 *   2. Separate global secrets (policyIds=[]) from policy-linked
 *   3. For policy-linked: include the policy's target + patterns
 *   4. Push SyncedSecrets payload via the provided callback
 */

import type {
  PolicyConfig,
  VaultSecret,
  SyncedSecrets,
  SecretPolicyBinding,
  ScopeFilter,
} from '@agenshield/ipc';
import type { Storage } from '@agenshield/storage';

export type PushSecretsFn = (payload: SyncedSecrets) => Promise<void>;

interface Logger {
  warn(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
}

const noop: Logger = { warn() { /* no-op */ }, info() { /* no-op */ } };

/**
 * Build the SyncedSecrets payload from storage and policies.
 * Does NOT push — returns the payload for the caller to handle.
 */
export function buildSyncPayload(
  policies: PolicyConfig[],
  secrets: VaultSecret[],
  logger?: Logger,
): SyncedSecrets {
  const log = logger ?? noop;

  if (secrets.length === 0) {
    return {
      version: '1.0.0',
      syncedAt: new Date().toISOString(),
      globalSecrets: {},
      policyBindings: [],
    };
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

  return {
    version: '1.0.0',
    syncedAt: new Date().toISOString(),
    globalSecrets,
    policyBindings,
  };
}

/**
 * Sync vault secrets to the broker via the provided push callback.
 *
 * Groups secrets into:
 * 1. Global secrets (policyIds=[]) — always injected into every exec
 * 2. Policy-bound secrets — injected when the policy's patterns match
 */
export async function syncSecrets(
  storage: Storage,
  policies: PolicyConfig[],
  pushSecrets: PushSecretsFn,
  logger?: Logger,
  scope?: ScopeFilter,
): Promise<void> {
  const log = logger ?? noop;

  let secrets: VaultSecret[];
  try {
    secrets = scope ? storage.for(scope).secrets.getAll() : storage.secrets.getAll();
  } catch {
    // Vault may be locked — push empty payload so broker has clean state
    const empty: SyncedSecrets = {
      version: '1.0.0',
      syncedAt: new Date().toISOString(),
      globalSecrets: {},
      policyBindings: [],
    };
    await pushSecrets(empty);
    return;
  }

  const synced = buildSyncPayload(policies, secrets, logger);
  await pushSecrets(synced);

  log.info(
    `[secret-sync] pushed ${Object.keys(synced.globalSecrets).length} global + ${synced.policyBindings.length} policy-bound secret groups to broker`,
  );
}
