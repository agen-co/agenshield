/**
 * Metrics snapshot model — DB row types and mappers.
 */

export interface DbMetricsRow {
  id: number;
  timestamp: number;
  cpu_percent: number;
  mem_percent: number;
  disk_percent: number;
  net_up: number;
  net_down: number;
}

export interface MetricsSnapshot {
  timestamp: number;
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  netUp: number;
  netDown: number;
}

export function mapMetricsSnapshot(row: DbMetricsRow): MetricsSnapshot {
  return {
    timestamp: row.timestamp,
    cpuPercent: row.cpu_percent,
    memPercent: row.mem_percent,
    diskPercent: row.disk_percent,
    netUp: row.net_up,
    netDown: row.net_down,
  };
}
