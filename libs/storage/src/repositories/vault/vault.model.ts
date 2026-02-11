/**
 * Vault model — Interfaces and DB row mappers
 */

import type { DbVaultSecretRow, DbVaultKvRow } from '../../types';

// ---- Domain interfaces ----

export interface VaultSecret {
  id: string;
  targetId?: string;
  userUsername?: string;
  name: string;
  value: string;
  scope: string;
  policyIds: string[];
  createdAt: string;
}

export interface VaultKvEntry {
  key: string;
  targetId?: string;
  userUsername?: string;
  value: string;
  updatedAt: string;
}

// ---- Row mappers ----

/**
 * Map a DB vault secret row to a VaultSecret domain object.
 * Requires decrypted value and policy IDs to be provided externally
 * since decryption is handled by the repository layer.
 */
export function mapSecret(
  row: DbVaultSecretRow,
  decryptedValue: string,
  policyIds: string[],
): VaultSecret {
  return {
    id: row.id,
    targetId: row.target_id ?? undefined,
    userUsername: row.user_username ?? undefined,
    name: row.name,
    value: decryptedValue,
    scope: row.scope,
    policyIds,
    createdAt: row.created_at,
  };
}

/**
 * Map a DB vault KV row to a VaultKvEntry domain object.
 * Requires decrypted value to be provided externally.
 */
export function mapKvEntry(
  row: DbVaultKvRow,
  decryptedValue: string,
): VaultKvEntry {
  return {
    key: row.key,
    targetId: row.target_id ?? undefined,
    userUsername: row.user_username ?? undefined,
    value: decryptedValue,
    updatedAt: row.updated_at,
  };
}
