/**
 * Metrics SQL queries
 */

const TABLE = 'metrics_snapshots';

export const Q = {
  createTable: `
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      cpu_percent REAL NOT NULL,
      mem_percent REAL NOT NULL,
      disk_percent REAL NOT NULL,
      net_up REAL NOT NULL,
      net_down REAL NOT NULL,
      target_id TEXT,
      el_min REAL,
      el_max REAL,
      el_mean REAL,
      el_p50 REAL,
      el_p99 REAL
    )`,
  createIndex: `CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON ${TABLE} (timestamp)`,
  createTargetIndex: `CREATE INDEX IF NOT EXISTS idx_metrics_target_id ON ${TABLE} (target_id, timestamp)`,
  insert: `
    INSERT INTO ${TABLE} (timestamp, cpu_percent, mem_percent, disk_percent, net_up, net_down, target_id, el_min, el_max, el_mean, el_p50, el_p99)
    VALUES (@timestamp, @cpuPercent, @memPercent, @diskPercent, @netUp, @netDown, @targetId, @elMin, @elMax, @elMean, @elP50, @elP99)`,
  selectRecent: `SELECT * FROM ${TABLE} WHERE target_id IS NULL ORDER BY timestamp DESC LIMIT ?`,
  selectSince: `SELECT * FROM ${TABLE} WHERE target_id IS NULL AND timestamp > ? ORDER BY timestamp ASC LIMIT ?`,
  selectRecentForTarget: `SELECT * FROM ${TABLE} WHERE target_id = ? ORDER BY timestamp DESC LIMIT ?`,
  selectSinceForTarget: `SELECT * FROM ${TABLE} WHERE target_id = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?`,
  prune: `DELETE FROM ${TABLE} WHERE timestamp < ?`,
  count: `SELECT COUNT(*) as count FROM ${TABLE}`,
  /** Check if columns exist (for migration on existing DBs) */
  checkColumns: `PRAGMA table_info(${TABLE})`,
  addTargetIdColumn: `ALTER TABLE ${TABLE} ADD COLUMN target_id TEXT`,
  addElMinColumn: `ALTER TABLE ${TABLE} ADD COLUMN el_min REAL`,
  addElMaxColumn: `ALTER TABLE ${TABLE} ADD COLUMN el_max REAL`,
  addElMeanColumn: `ALTER TABLE ${TABLE} ADD COLUMN el_mean REAL`,
  addElP50Column: `ALTER TABLE ${TABLE} ADD COLUMN el_p50 REAL`,
  addElP99Column: `ALTER TABLE ${TABLE} ADD COLUMN el_p99 REAL`,
} as const;
