/**
 * Vault repository — Encrypted secrets and key-value store
 *
 * All operations throw StorageLockedError when vault is locked.
 * Scoped: base -> target -> target+user (most specific wins per name).
 */

import type { DbVaultSecretRow, DbVaultKvRow } from '../../types';
import { StorageLockedError } from '../../errors';
import { buildPolicyScopeWhere, resolveSecretScope } from '../../scoping';
import { BaseRepository } from '../base.repository';
import { CreateSecretSchema, UpdateSecretSchema, UpdateSecretCodec } from './vault.schema';
import type { CreateSecretInput, UpdateSecretInput, SetKvParams, GetKvParams, DeleteKvParams, GetSecretByNameParams } from './vault.schema';
import { mapSecret } from './vault.model';
import type { VaultSecret } from './vault.model';
import { Q } from './vault.query';

export class VaultRepository extends BaseRepository {
  // ---- Secrets ----

  createSecret(input: CreateSecretInput): VaultSecret {
    if (!this.isUnlocked()) throw new StorageLockedError();

    const data = this.validate(CreateSecretSchema, input);
    const id = this.generateId();
    const now = this.now();
    const encrypted = this.encrypt(data.value);
    const scope = data.scope ?? 'global';

    this.db.prepare(Q.insertSecret).run({
      id,
      targetId: data.targetId ?? null,
      userUsername: data.userUsername ?? null,
      name: data.name,
      valueEncrypted: encrypted,
      scope,
      createdAt: now,
    });

    // Link policies
    if (data.policyIds?.length) {
      const linkStmt = this.db.prepare(Q.insertSecretPolicy);
      for (const policyId of data.policyIds) {
        linkStmt.run({ secretId: id, policyId });
      }
    }

    return {
      id,
      targetId: data.targetId,
      userUsername: data.userUsername,
      name: data.name,
      value: data.value,
      scope,
      policyIds: data.policyIds ?? [],
      createdAt: now,
    };
  }

  getSecret(id: string): VaultSecret | null {
    if (!this.isUnlocked()) throw new StorageLockedError();

    const row = this.db.prepare(Q.selectSecretById).get(id) as DbVaultSecretRow | undefined;
    if (!row) return null;

    return this.toSecret(row);
  }

  getSecretByName(params: GetSecretByNameParams): VaultSecret | null {
    if (!this.isUnlocked()) throw new StorageLockedError();

    const { clause, params: scopeParams } = buildPolicyScopeWhere(this.scope);
    const rows = this.db.prepare(
      Q.selectSecretsByNameAndScope(clause),
    ).all({ name: params.name, ...scopeParams }) as DbVaultSecretRow[];

    const resolved = resolveSecretScope(rows);
    return resolved.length > 0 ? this.toSecret(resolved[0]) : null;
  }

  getAllSecrets(): VaultSecret[] {
    if (!this.isUnlocked()) throw new StorageLockedError();

    const { clause, params } = buildPolicyScopeWhere(this.scope);
    const rows = this.db.prepare(
      Q.selectAllSecretsByScope(clause),
    ).all(params) as DbVaultSecretRow[];

    return resolveSecretScope(rows).map((r) => this.toSecret(r));
  }

  updateSecret(id: string, input: UpdateSecretInput): VaultSecret | null {
    if (!this.isUnlocked()) throw new StorageLockedError();

    const data = this.validate(UpdateSecretSchema, input);

    const existing = this.db.prepare(Q.selectSecretById).get(id) as DbVaultSecretRow | undefined;
    if (!existing) return null;

    const encoded: Record<string, unknown> = UpdateSecretCodec.encode(data);
    // Handle encrypted value separately (needs encryption)
    if (data.value !== undefined) {
      encoded.value_encrypted = this.encrypt(data.value);
    }

    this.buildDynamicUpdate(encoded, 'vault_secrets', 'id = @id', { id }, { skipTimestamp: true });

    // Handle policyIds separately (separate table)
    if (data.policyIds !== undefined) {
      this.db.prepare(Q.deleteSecretPolicies).run(id);
      const linkStmt = this.db.prepare(Q.insertSecretPolicy);
      for (const policyId of data.policyIds) {
        linkStmt.run({ secretId: id, policyId });
      }
    }

    return this.getSecret(id);
  }

  deleteSecret(id: string): boolean {
    return this.db.prepare(Q.deleteSecret).run(id).changes > 0;
  }

  // ---- Key-Value ----

  setKv(params: SetKvParams): void {
    if (!this.isUnlocked()) throw new StorageLockedError();

    const encrypted = this.encrypt(params.value);
    const now = this.now();

    this.db.prepare(Q.upsertKv).run({
      key: params.key,
      targetId: this.scope?.targetId ?? null,
      userUsername: this.scope?.userUsername ?? null,
      valueEncrypted: encrypted,
      updatedAt: now,
    });
  }

  getKv(params: GetKvParams): string | null {
    if (!this.isUnlocked()) throw new StorageLockedError();

    const { clause, params: scopeParams } = buildPolicyScopeWhere(this.scope);
    const rows = this.db.prepare(
      Q.selectKvByKeyAndScope(clause),
    ).all({ key: params.key, ...scopeParams }) as DbVaultKvRow[];

    if (rows.length === 0) return null;

    // Most specific scope wins
    const sorted = rows.sort((a, b) => {
      const scoreA = (a.target_id ? 1 : 0) + (a.user_username ? 1 : 0);
      const scoreB = (b.target_id ? 1 : 0) + (b.user_username ? 1 : 0);
      return scoreB - scoreA;
    });

    return this.decrypt(sorted[0].value_encrypted);
  }

  deleteKv(params: DeleteKvParams): boolean {
    const targetId = this.scope?.targetId ?? null;
    const userUsername = this.scope?.userUsername ?? null;
    const result = this.db.prepare(Q.deleteKv).run({ key: params.key, targetId, userUsername });
    return result.changes > 0;
  }

  // ---- Private helpers ----

  private get secretsTable(): string {
    return 'vault_secrets';
  }

  /**
   * Convert a DB row to a VaultSecret, decrypting the value and loading policy links.
   */
  private toSecret(row: DbVaultSecretRow): VaultSecret {
    const policyLinks = this.db.prepare(Q.selectSecretPolicies).all(row.id) as Array<{ policy_id: string }>;
    const policyIds = policyLinks.map((l) => l.policy_id);
    const decryptedValue = this.decrypt(row.value_encrypted);

    return mapSecret(row, decryptedValue, policyIds);
  }
}
