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
      target_id TEXT
    )`,
  createIndex: `CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON ${TABLE} (timestamp)`,
  createTargetIndex: `CREATE INDEX IF NOT EXISTS idx_metrics_target_id ON ${TABLE} (target_id, timestamp)`,
  insert: `
    INSERT INTO ${TABLE} (timestamp, cpu_percent, mem_percent, disk_percent, net_up, net_down, target_id)
    VALUES (@timestamp, @cpuPercent, @memPercent, @diskPercent, @netUp, @netDown, @targetId)`,
  selectRecent: `SELECT * FROM ${TABLE} WHERE target_id IS NULL ORDER BY timestamp DESC LIMIT ?`,
  selectSince: `SELECT * FROM ${TABLE} WHERE target_id IS NULL AND timestamp > ? ORDER BY timestamp ASC LIMIT ?`,
  selectRecentForTarget: `SELECT * FROM ${TABLE} WHERE target_id = ? ORDER BY timestamp DESC LIMIT ?`,
  selectSinceForTarget: `SELECT * FROM ${TABLE} WHERE target_id = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?`,
  prune: `DELETE FROM ${TABLE} WHERE timestamp < ?`,
  count: `SELECT COUNT(*) as count FROM ${TABLE}`,
  /** Check if target_id column exists (for migration on existing DBs) */
  checkTargetIdColumn: `PRAGMA table_info(${TABLE})`,
  addTargetIdColumn: `ALTER TABLE ${TABLE} ADD COLUMN target_id TEXT`,
} as const;
