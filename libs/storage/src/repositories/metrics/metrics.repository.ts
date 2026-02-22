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
    });
  }

  /** Get the most recent N snapshots, ordered oldest→newest. */
  getRecent(limit = 150): MetricsSnapshot[] {
    const rows = this.db.prepare(Q.selectRecent).all(limit) as DbMetricsRow[];
    return rows.reverse().map(mapMetricsSnapshot);
  }

  /** Get snapshots since a timestamp, ordered oldest→newest. */
  getSince(since: number, limit = 150): MetricsSnapshot[] {
    const rows = this.db.prepare(Q.selectSince).all(since, limit) as DbMetricsRow[];
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
