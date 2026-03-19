/**
 * Cloud Identity queries — SQL prepared statement factories
 */

export const Q = {
  createTable: `
    CREATE TABLE IF NOT EXISTS cloud_identity (
      agent_id TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      private_key_encrypted TEXT NOT NULL,
      cloud_url TEXT NOT NULL,
      company_id TEXT,
      company_name TEXT,
      enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
      claim_status TEXT NOT NULL DEFAULT 'unclaimed',
      claimed_user_id TEXT,
      claimed_user_name TEXT,
      claimed_user_email TEXT,
      last_bundle_revision TEXT
    )
  `,

  /** Add claimed_user_name and claimed_user_email columns for existing installs */
  migrateAddClaimUserFields: [
    `ALTER TABLE cloud_identity ADD COLUMN claimed_user_name TEXT`,
    `ALTER TABLE cloud_identity ADD COLUMN claimed_user_email TEXT`,
  ],

  upsert: `
    INSERT OR REPLACE INTO cloud_identity
      (agent_id, public_key, private_key_encrypted, cloud_url, company_id, company_name, enrolled_at, claim_status)
    VALUES
      (@agent_id, @public_key, @private_key_encrypted, @cloud_url, @company_id, @company_name, @enrolled_at, @claim_status)
  `,

  get: `SELECT * FROM cloud_identity LIMIT 1`,

  updateClaimStatus: `
    UPDATE cloud_identity SET claim_status = @claim_status, claimed_user_id = @claimed_user_id, claimed_user_name = @claimed_user_name, claimed_user_email = @claimed_user_email
  `,

  updateBundleRevision: `
    UPDATE cloud_identity SET last_bundle_revision = @last_bundle_revision
  `,

  delete: `DELETE FROM cloud_identity`,
} as const;
