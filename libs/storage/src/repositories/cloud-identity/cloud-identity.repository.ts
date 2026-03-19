/**
 * Cloud Identity repository — Encrypted cloud registration in SQLite
 *
 * Stores the Ed25519 keypair, cloud URL, agent ID, and org metadata.
 * The private key is encrypted at rest using AES-256-GCM via the vault key.
 * All other fields are plaintext.
 *
 * Only one identity record exists at a time (single device = single enrollment).
 */

import { StorageLockedError } from '../../errors';
import { BaseRepository } from '../base.repository';
import type { CloudIdentity, DbCloudIdentityRow } from './cloud-identity.model';
import { mapCloudIdentity } from './cloud-identity.model';
import { Q } from './cloud-identity.query';

export interface SaveCloudIdentityInput {
  agentId: string;
  publicKey: string;
  privateKey: string;
  cloudUrl: string;
  companyId?: string;
  companyName?: string;
}

export class CloudIdentityRepository extends BaseRepository {

  /**
   * Ensure the cloud_identity table exists and is up-to-date.
   * Called during storage initialization.
   */
  ensureTable(): void {
    this.db.exec(Q.createTable);

    // Migrate: add claimed_user_name and claimed_user_email for existing installs
    for (const sql of Q.migrateAddClaimUserFields) {
      try { this.db.exec(sql); } catch { /* column already exists */ }
    }
  }

  /**
   * Save or replace the cloud identity.
   * Requires vault to be unlocked (encrypts private key).
   */
  save(input: SaveCloudIdentityInput): CloudIdentity {
    if (!this.isUnlocked()) throw new StorageLockedError('Cannot save cloud identity while vault is locked.');

    const privateKeyEncrypted = this.encrypt(input.privateKey);
    const now = this.now();

    this.db.prepare(Q.upsert).run({
      agent_id: input.agentId,
      public_key: input.publicKey,
      private_key_encrypted: privateKeyEncrypted,
      cloud_url: input.cloudUrl,
      company_id: input.companyId ?? null,
      company_name: input.companyName ?? null,
      enrolled_at: now,
      claim_status: 'unclaimed',
    });

    return {
      agentId: input.agentId,
      publicKey: input.publicKey,
      privateKey: input.privateKey,
      cloudUrl: input.cloudUrl,
      companyId: input.companyId ?? null,
      companyName: input.companyName ?? null,
      enrolledAt: now,
      claimStatus: 'unclaimed',
      claimedUserId: null,
      claimedUserName: null,
      claimedUserEmail: null,
      lastBundleRevision: null,
    };
  }

  /**
   * Load the cloud identity.
   * Returns null if not enrolled or vault is locked.
   */
  get(): CloudIdentity | null {
    const row = this.db.prepare(Q.get).get() as DbCloudIdentityRow | undefined;
    if (!row) return null;

    if (!this.isUnlocked()) {
      // Return identity without private key when locked
      return mapCloudIdentity(row, '');
    }

    try {
      const privateKey = this.decrypt(row.private_key_encrypted);
      return mapCloudIdentity(row, privateKey);
    } catch {
      // Decryption failed — return without private key
      return mapCloudIdentity(row, '');
    }
  }

  /**
   * Check if a cloud identity exists (enrolled).
   * Works regardless of lock state.
   */
  isEnrolled(): boolean {
    const row = this.db.prepare(Q.get).get();
    return !!row;
  }

  /**
   * Update the claim status and optionally the claimed user info.
   */
  updateClaimStatus(
    status: CloudIdentity['claimStatus'],
    userId?: string,
    userName?: string,
    userEmail?: string,
  ): void {
    this.db.prepare(Q.updateClaimStatus).run({
      claim_status: status,
      claimed_user_id: userId ?? null,
      claimed_user_name: userName ?? null,
      claimed_user_email: userEmail ?? null,
    });
  }

  /**
   * Update the last applied bundle revision.
   */
  updateBundleRevision(revision: string): void {
    this.db.prepare(Q.updateBundleRevision).run({
      last_bundle_revision: revision,
    });
  }

  /**
   * Remove the cloud identity (unenroll).
   */
  delete(): void {
    this.db.prepare(Q.delete).run();
  }
}
