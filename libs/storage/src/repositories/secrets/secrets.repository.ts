/**
 * Secrets repository — Encrypted secret storage in SQLite
 *
 * Secrets are encrypted at rest using AES-256-GCM via the passcode-derived key.
 * Create/update operations require the vault to be unlocked (StorageLockedError otherwise).
 * getAllMasked() works regardless of lock state — returns masked values.
 */

import type { VaultSecret } from '@agenshield/ipc';
import type { DbSecretRow } from '../../types';
import { StorageLockedError } from '../../errors';
import { BaseRepository } from '../base.repository';
import { CreateSecretSchema, UpdateSecretSchema, UpdateSecretCodec } from './secrets.schema';
import type { CreateSecretInput, UpdateSecretInput } from './secrets.schema';
import { mapSecret, mapSecretMasked } from './secrets.model';
import { Q } from './secrets.query';

export class SecretsRepository extends BaseRepository {
  /**
   * Create a new secret with optional policy links.
   * Requires vault to be unlocked.
   */
  create(input: CreateSecretInput): VaultSecret {
    if (!this.isUnlocked()) throw new StorageLockedError('Cannot create secrets while vault is locked.');

    const data = this.validate(CreateSecretSchema, input);
    const id = this.generateId();
    const now = this.now();
    const policyIds = data.policyIds ?? [];
    const scope = data.scope ?? (policyIds.length > 0 ? 'policed' : 'global');

    const valueEncrypted = this.encrypt(data.value);

    this.db.transaction(() => {
      this.db.prepare(Q.insertSecret).run({
        id,
        name: data.name,
        valueEncrypted,
        scope,
        createdAt: now,
      });

      if (scope !== 'standalone') {
        const insertPolicy = this.db.prepare(Q.insertPolicy);
        for (const policyId of policyIds) {
          insertPolicy.run({ secretId: id, policyId });
        }
      }
    })();

    return {
      id,
      name: data.name,
      value: data.value,
      policyIds: scope === 'standalone' ? [] : policyIds,
      createdAt: now,
      scope,
    };
  }

  /**
   * Get a secret by ID with decrypted value, or null if not found.
   * Requires vault to be unlocked.
   */
  getById(id: string): VaultSecret | null {
    const row = this.db.prepare(Q.selectById).get(id) as DbSecretRow | undefined;
    if (!row) return null;
    const policyIds = this.getPolicyIds(row.id);
    const value = this.decryptRow(row);
    return mapSecret(row, value, policyIds);
  }

  /**
   * Get a secret by name with decrypted value, or null if not found.
   * Requires vault to be unlocked.
   */
  getByName(name: string): VaultSecret | null {
    const row = this.db.prepare(Q.selectByName).get(name) as DbSecretRow | undefined;
    if (!row) return null;
    const policyIds = this.getPolicyIds(row.id);
    const value = this.decryptRow(row);
    return mapSecret(row, value, policyIds);
  }

  /**
   * Get all secrets with decrypted values.
   * Requires vault to be unlocked.
   */
  getAll(): VaultSecret[] {
    const rows = this.db.prepare(Q.selectAll).all() as DbSecretRow[];
    return rows.map((row) => {
      const policyIds = this.getPolicyIds(row.id);
      const value = this.decryptRow(row);
      return mapSecret(row, value, policyIds);
    });
  }

  /**
   * Get all secrets with masked values (never exposes plaintext).
   * Works regardless of lock state — safe for GET /secrets.
   */
  getAllMasked(): VaultSecret[] {
    const rows = this.db.prepare(Q.selectAll).all() as DbSecretRow[];
    return rows.map((row) => {
      const policyIds = this.getPolicyIds(row.id);
      return mapSecretMasked(row, policyIds);
    });
  }

  /**
   * Update a secret's scope, value, and/or policy links.
   * Requires vault to be unlocked if value is being changed.
   */
  update(id: string, input: UpdateSecretInput): VaultSecret | null {
    const data = this.validate(UpdateSecretSchema, input);

    // Need unlocked vault if updating the value
    if (data.value !== undefined && !this.isUnlocked()) {
      throw new StorageLockedError('Cannot update secret value while vault is locked.');
    }

    const existing = this.getById(id);
    if (!existing) return null;

    this.db.transaction(() => {
      // Update scope column if provided
      const encoded = UpdateSecretCodec.encode(data);
      this.buildDynamicUpdate(encoded, 'secrets', 'id = @id', { id }, { skipTimestamp: true });

      // Update encrypted value if provided
      if (data.value !== undefined) {
        const valueEncrypted = this.encrypt(data.value);
        this.db.prepare(Q.updateValueEncrypted).run({ id, valueEncrypted });
      }

      // Determine effective scope
      const effectiveScope = data.scope ?? existing.scope;

      // Update policy links
      if (effectiveScope === 'standalone') {
        this.db.prepare(Q.deletePolicies).run(id);
      } else if (data.policyIds !== undefined) {
        this.db.prepare(Q.deletePolicies).run(id);
        const insertPolicy = this.db.prepare(Q.insertPolicy);
        for (const policyId of data.policyIds) {
          insertPolicy.run({ secretId: id, policyId });
        }
      }
    })();

    return this.getById(id);
  }

  /**
   * Delete a secret by ID. Returns true if deleted.
   * Works regardless of lock state.
   */
  delete(id: string): boolean {
    return this.db.prepare(Q.deleteById).run(id).changes > 0;
  }

  // ---- Private helpers ----

  private getPolicyIds(secretId: string): string[] {
    const rows = this.db.prepare(Q.selectPolicies).all(secretId) as Array<{ policy_id: string }>;
    return rows.map((r) => r.policy_id);
  }

  /**
   * Decrypt a secret row's value. Handles both encrypted and legacy plaintext rows.
   */
  private decryptRow(row: DbSecretRow): string {
    if (row.value_encrypted) {
      return this.decrypt(row.value_encrypted);
    }
    // Legacy: plaintext value column (pre-migration 007 or deferred encryption pending)
    return row.value ?? '';
  }
}
