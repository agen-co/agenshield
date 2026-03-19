/**
 * Approved Skill Hashes repository
 *
 * Stores SHA256 hashes of CISO-approved skills synced from cloud.
 * Used for SHA256-only skill enforcement: matching hash = allowed,
 * name match without hash match = denied.
 */

import { BaseRepository } from '../base.repository';

export interface ApprovedSkillHash {
  sha256: string;
  displayName: string | null;
  targetSelector: string | null;
  enabled: boolean;
}

interface DbApprovedSkillHashRow {
  sha256: string;
  display_name: string | null;
  target_selector: string | null;
  enabled: number;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS approved_skill_hashes (
    sha256 TEXT PRIMARY KEY,
    display_name TEXT,
    target_selector TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
  )
`;

export class ApprovedSkillHashesRepository extends BaseRepository {

  ensureTable(): void {
    this.db.exec(CREATE_TABLE);
  }

  /**
   * Check if a SHA256 hash is in the approved list.
   */
  isApproved(sha256: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM approved_skill_hashes WHERE sha256 = ? AND enabled = 1',
    ).get(sha256);
    return !!row;
  }

  /**
   * Get all approved hashes.
   */
  getAll(): ApprovedSkillHash[] {
    const rows = this.db.prepare(
      'SELECT * FROM approved_skill_hashes WHERE enabled = 1',
    ).all() as DbApprovedSkillHashRow[];

    return rows.map(r => ({
      sha256: r.sha256,
      displayName: r.display_name,
      targetSelector: r.target_selector,
      enabled: r.enabled === 1,
    }));
  }

  /**
   * Replace all approved hashes with a new set from cloud.
   * Called when a new bundle is received.
   */
  replaceAll(hashes: Array<{ sha256: string; displayName?: string; targetSelector?: string }>): void {
    this.db.transaction(() => {
      this.db.exec('DELETE FROM approved_skill_hashes');
      const insert = this.db.prepare(
        'INSERT INTO approved_skill_hashes (sha256, display_name, target_selector, enabled) VALUES (?, ?, ?, 1)',
      );
      for (const h of hashes) {
        insert.run(h.sha256, h.displayName ?? null, h.targetSelector ?? null);
      }
    })();
  }

  /**
   * Insert or update a single approved hash without wiping existing entries.
   * Used when cloud reports back an individual approval decision.
   */
  upsert(sha256: string, displayName?: string, targetSelector?: string): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO approved_skill_hashes (sha256, display_name, target_selector, enabled) VALUES (?, ?, ?, 1)',
    ).run(sha256, displayName ?? null, targetSelector ?? null);
  }

  /**
   * Find approved hash entry by SHA256.
   */
  findByHash(sha256: string): ApprovedSkillHash | null {
    const row = this.db.prepare(
      'SELECT * FROM approved_skill_hashes WHERE sha256 = ?',
    ).get(sha256) as DbApprovedSkillHashRow | undefined;

    if (!row) return null;
    return {
      sha256: row.sha256,
      displayName: row.display_name,
      targetSelector: row.target_selector,
      enabled: row.enabled === 1,
    };
  }
}
