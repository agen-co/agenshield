/**
 * MetricsRepository — CRUD for system metrics snapshots.
 *
 * Append-only time-series data with automatic pruning.
 */

import type { Database } from 'better-sqlite3';
import { MetricsSnapshotSchema, type MetricsSnapshotInput } from './metrics.schema';
import { mapMetricsSnapshot, type MetricsSnapshot, type DbMetricsRow } from './metrics.model';
import { Q } from './metrics.query';

export class MetricsRepository {
  constructor(private db: Database) {
    this.db.exec(Q.createTable);
    this.db.exec(Q.createIndex);
    this.db.exec(Q.createTargetIndex);
    this.ensureTargetIdColumn();
  }

  /**
   * Ensure target_id column exists on existing databases.
   * New databases get it from CREATE TABLE; this handles migration for old ones.
   */
  private ensureTargetIdColumn(): void {
    const columns = this.db.prepare(Q.checkTargetIdColumn).all() as Array<{ name: string }>;
    const hasTargetId = columns.some((c) => c.name === 'target_id');
    if (!hasTargetId) {
      this.db.exec(Q.addTargetIdColumn);
      this.db.exec(Q.createTargetIndex);
    }
  }

  /** Insert a metrics snapshot. */
  create(input: MetricsSnapshotInput): void {
    const data = MetricsSnapshotSchema.parse(input);
    this.db.prepare(Q.insert).run({
      timestamp: data.timestamp,
      cpuPercent: data.cpuPercent,
      memPercent: data.memPercent,
      diskPercent: data.diskPercent,
      netUp: data.netUp,
      netDown: data.netDown,
      targetId: data.targetId ?? null,
    });
  }

  /** Get the most recent N system-wide snapshots, ordered oldest→newest. */
  getRecent(limit = 150): MetricsSnapshot[] {
    const rows = this.db.prepare(Q.selectRecent).all(limit) as DbMetricsRow[];
    return rows.reverse().map(mapMetricsSnapshot);
  }

  /** Get system-wide snapshots since a timestamp, ordered oldest→newest. */
  getSince(since: number, limit = 150): MetricsSnapshot[] {
    const rows = this.db.prepare(Q.selectSince).all(since, limit) as DbMetricsRow[];
    return rows.map(mapMetricsSnapshot);
  }

  /** Get the most recent N snapshots for a specific target, ordered oldest→newest. */
  getRecentForTarget(targetId: string, limit = 150): MetricsSnapshot[] {
    const rows = this.db.prepare(Q.selectRecentForTarget).all(targetId, limit) as DbMetricsRow[];
    return rows.reverse().map(mapMetricsSnapshot);
  }

  /** Get snapshots for a specific target since a timestamp, ordered oldest→newest. */
  getSinceForTarget(targetId: string, since: number, limit = 150): MetricsSnapshot[] {
    const rows = this.db.prepare(Q.selectSinceForTarget).all(targetId, since, limit) as DbMetricsRow[];
    return rows.map(mapMetricsSnapshot);
  }

  /** Delete snapshots older than maxAgeMs. Returns number of deleted rows. */
  prune(maxAgeMs = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db.prepare(Q.prune).run(cutoff);
    return result.changes;
  }

  /** Total number of stored snapshots. */
  count(): number {
    const row = this.db.prepare(Q.count).get() as { count: number };
    return row.count;
  }
}
