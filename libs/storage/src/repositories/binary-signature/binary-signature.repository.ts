/**
 * Binary signature repository
 *
 * Manages SHA256 fingerprints of known binaries for anti-rename
 * process detection. Signatures can be synced from cloud or added locally.
 */

import type { BinarySignature } from '@agenshield/ipc';
import type { DbBinarySignatureRow } from '../../types';
import { BaseRepository } from '../base.repository';
import { mapSignature } from './binary-signature.model';
import { Q } from './binary-signature.query';
import { CreateSignatureSchema, UpsertBatchSchema } from './binary-signature.schema';
import type { CreateSignatureInput } from './binary-signature.schema';

export class BinarySignatureRepository extends BaseRepository {
  /**
   * Create a new binary signature entry.
   */
  create(input: CreateSignatureInput): BinarySignature {
    const data = this.validate(CreateSignatureSchema, input);
    const id = this.generateId();
    const now = this.now();

    this.db.prepare(Q.insert).run({
      id,
      sha256: data.sha256,
      packageName: data.packageName,
      version: data.version ?? null,
      platform: data.platform ?? null,
      source: data.source ?? 'cloud',
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      sha256: data.sha256,
      packageName: data.packageName,
      version: data.version,
      platform: data.platform,
      source: data.source ?? 'cloud',
      metadata: data.metadata,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Lookup a signature by SHA256 hash. Optionally filter by platform.
   */
  lookupBySha256(sha256: string, platform?: string): BinarySignature | null {
    let row: DbBinarySignatureRow | undefined;

    if (platform) {
      row = this.db.prepare(Q.selectBySha256Platform).get({ sha256, platform }) as DbBinarySignatureRow | undefined;
    }

    // Fallback: try without platform filter
    if (!row) {
      row = this.db.prepare(Q.selectBySha256).get({ sha256 }) as DbBinarySignatureRow | undefined;
    }

    return row ? mapSignature(row) : null;
  }

  /**
   * Find all signatures for a given package name.
   */
  getByPackage(packageName: string): BinarySignature[] {
    const rows = this.db.prepare(Q.selectByPackage).all({ packageName }) as DbBinarySignatureRow[];
    return rows.map(mapSignature);
  }

  /**
   * Get a single signature by ID.
   */
  getById(id: string): BinarySignature | null {
    const row = this.db.prepare(Q.selectById).get(id) as DbBinarySignatureRow | undefined;
    return row ? mapSignature(row) : null;
  }

  /**
   * Get all signatures.
   */
  getAll(): BinarySignature[] {
    const rows = this.db.prepare(Q.selectAll).all() as DbBinarySignatureRow[];
    return rows.map(mapSignature);
  }

  /**
   * Bulk upsert signatures. Uses INSERT ... ON CONFLICT to avoid duplicates.
   * Returns the number of signatures processed.
   */
  upsertBatch(signatures: CreateSignatureInput[]): number {
    const validated = this.validate(UpsertBatchSchema, { signatures });
    const now = this.now();
    const stmt = this.db.prepare(Q.upsert);

    const runBatch = this.db.transaction(() => {
      for (const sig of validated.signatures) {
        stmt.run({
          id: this.generateId(),
          sha256: sig.sha256,
          packageName: sig.packageName,
          version: sig.version ?? null,
          platform: sig.platform ?? null,
          source: sig.source ?? 'cloud',
          metadata: sig.metadata ? JSON.stringify(sig.metadata) : null,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    runBatch();
    return validated.signatures.length;
  }

  /**
   * Delete all signatures from a given source.
   * Returns the number of deleted rows.
   */
  deleteBySource(source: 'cloud' | 'local'): number {
    const result = this.db.prepare(Q.deleteBySource).run({ source });
    return result.changes;
  }

  /**
   * Delete a single signature by ID.
   */
  delete(id: string): boolean {
    const result = this.db.prepare(Q.deleteById).run(id);
    return result.changes > 0;
  }

  /**
   * Get the total count of signatures.
   */
  count(): number {
    const row = this.db.prepare(Q.count).get() as { count: number };
    return row.count;
  }
}
