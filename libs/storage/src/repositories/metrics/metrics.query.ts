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
      net_down REAL NOT NULL
    )`,
  createIndex: `CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON ${TABLE} (timestamp)`,
  insert: `
    INSERT INTO ${TABLE} (timestamp, cpu_percent, mem_percent, disk_percent, net_up, net_down)
    VALUES (@timestamp, @cpuPercent, @memPercent, @diskPercent, @netUp, @netDown)`,
  selectRecent: `SELECT * FROM ${TABLE} ORDER BY timestamp DESC LIMIT ?`,
  selectSince: `SELECT * FROM ${TABLE} WHERE timestamp > ? ORDER BY timestamp ASC LIMIT ?`,
  prune: `DELETE FROM ${TABLE} WHERE timestamp < ?`,
  count: `SELECT COUNT(*) as count FROM ${TABLE}`,
} as const;
