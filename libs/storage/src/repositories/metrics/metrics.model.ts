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
  target_id: string | null;
}

export interface MetricsSnapshot {
  timestamp: number;
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  netUp: number;
  netDown: number;
  targetId?: string;
}

export function mapMetricsSnapshot(row: DbMetricsRow): MetricsSnapshot {
  return {
    timestamp: row.timestamp,
    cpuPercent: row.cpu_percent,
    memPercent: row.mem_percent,
    diskPercent: row.disk_percent,
    netUp: row.net_up,
    netDown: row.net_down,
    ...(row.target_id != null && { targetId: row.target_id }),
  };
}
