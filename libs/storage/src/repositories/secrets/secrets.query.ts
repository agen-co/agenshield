/**
 * Secrets SQL queries
 */

const SECRETS = 'secrets';
const POLICIES = 'secret_policies';

export const Q = {
  // ---- Secrets ----
  insertSecret: `
    INSERT INTO ${SECRETS} (id, name, value_encrypted, scope, created_at)
    VALUES (@id, @name, @valueEncrypted, @scope, @createdAt)`,

  selectById: `SELECT * FROM ${SECRETS} WHERE id = ?`,
  selectByName: `SELECT * FROM ${SECRETS} WHERE name = ?`,
  selectAll: `SELECT * FROM ${SECRETS} ORDER BY created_at`,
  deleteById: `DELETE FROM ${SECRETS} WHERE id = ?`,

  updateValueEncrypted: `UPDATE ${SECRETS} SET value_encrypted = @valueEncrypted WHERE id = @id`,

  // ---- Policy junction ----
  insertPolicy: `
    INSERT OR IGNORE INTO ${POLICIES} (secret_id, policy_id)
    VALUES (@secretId, @policyId)`,

  selectPolicies: `SELECT policy_id FROM ${POLICIES} WHERE secret_id = ?`,
  deletePolicies: `DELETE FROM ${POLICIES} WHERE secret_id = ?`,
} as const;
