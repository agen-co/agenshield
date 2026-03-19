/**
 * Cloud Identity model — DB row mapping and types
 */

export interface DbCloudIdentityRow {
  agent_id: string;
  public_key: string;
  private_key_encrypted: string;
  cloud_url: string;
  company_id: string | null;
  company_name: string | null;
  enrolled_at: string;
  claim_status: string;
  claimed_user_id: string | null;
  claimed_user_name: string | null;
  claimed_user_email: string | null;
  last_bundle_revision: string | null;
}

export interface CloudIdentity {
  agentId: string;
  publicKey: string;
  privateKey: string;         // decrypted
  cloudUrl: string;
  companyId: string | null;
  companyName: string | null;
  enrolledAt: string;
  claimStatus: 'unclaimed' | 'pending' | 'claimed';
  claimedUserId: string | null;
  claimedUserName: string | null;
  claimedUserEmail: string | null;
  lastBundleRevision: string | null;
}

export function mapCloudIdentity(row: DbCloudIdentityRow, privateKey: string): CloudIdentity {
  return {
    agentId: row.agent_id,
    publicKey: row.public_key,
    privateKey,
    cloudUrl: row.cloud_url,
    companyId: row.company_id,
    companyName: row.company_name,
    enrolledAt: row.enrolled_at,
    claimStatus: row.claim_status as CloudIdentity['claimStatus'],
    claimedUserId: row.claimed_user_id,
    claimedUserName: row.claimed_user_name,
    claimedUserEmail: row.claimed_user_email,
    lastBundleRevision: row.last_bundle_revision,
  };
}
