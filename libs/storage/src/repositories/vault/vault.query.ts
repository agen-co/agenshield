/**
 * Vault SQL queries
 */

const SECRETS = 'vault_secrets';
const SECRET_POLICIES = 'vault_secret_policies';
const KV = 'vault_kv';

export const Q = {
  // ---- Secrets ----
  insertSecret: `
    INSERT INTO ${SECRETS} (id, target_id, user_username, name, value_encrypted, scope, created_at)
    VALUES (@id, @targetId, @userUsername, @name, @valueEncrypted, @scope, @createdAt)`,

  selectSecretById: `SELECT * FROM ${SECRETS} WHERE id = ?`,

  selectSecretsByNameAndScope: (scopeClause: string) => `
    SELECT * FROM ${SECRETS} WHERE name = @name AND (${scopeClause})`,

  selectAllSecretsByScope: (scopeClause: string) => `
    SELECT * FROM ${SECRETS} WHERE ${scopeClause} ORDER BY name`,

  deleteSecret: `DELETE FROM ${SECRETS} WHERE id = ?`,

  // ---- Secret-Policy links ----
  insertSecretPolicy: `
    INSERT INTO ${SECRET_POLICIES} (secret_id, policy_id)
    VALUES (@secretId, @policyId)`,

  deleteSecretPolicies: `DELETE FROM ${SECRET_POLICIES} WHERE secret_id = ?`,

  selectSecretPolicies: `SELECT policy_id FROM ${SECRET_POLICIES} WHERE secret_id = ?`,

  // ---- Key-Value ----
  upsertKv: `
    INSERT INTO ${KV} (key, target_id, user_username, value_encrypted, updated_at)
    VALUES (@key, @targetId, @userUsername, @valueEncrypted, @updatedAt)
    ON CONFLICT(key, target_id, user_username) DO UPDATE SET
      value_encrypted = @valueEncrypted, updated_at = @updatedAt`,

  selectKvByKeyAndScope: (scopeClause: string) => `
    SELECT * FROM ${KV} WHERE key = @key AND (${scopeClause})`,

  deleteKv: `
    DELETE FROM ${KV} WHERE key = @key AND target_id IS @targetId AND user_username IS @userUsername`,
} as const;
