/**
 * Secrets model — Row mappers (DB row → domain type)
 */

import type { VaultSecret, SecretScope } from '@agenshield/ipc';
import type { DbSecretRow } from '../../types';

const MASKED_VALUE = '••••••••';

/**
 * Map a DB row + decrypted value + policy IDs to the VaultSecret IPC type.
 */
export function mapSecret(row: DbSecretRow, decryptedValue: string, policyIds: string[]): VaultSecret {
  return {
    id: row.id,
    name: row.name,
    value: decryptedValue,
    policyIds,
    createdAt: row.created_at,
    scope: row.scope as SecretScope,
  };
}

/**
 * Map a DB row to a masked VaultSecret (value is hidden).
 * Does not require decryption — safe to call when vault is locked.
 */
export function mapSecretMasked(row: DbSecretRow, policyIds: string[]): VaultSecret {
  return {
    id: row.id,
    name: row.name,
    value: MASKED_VALUE,
    policyIds,
    createdAt: row.created_at,
    scope: row.scope as SecretScope,
  };
}
