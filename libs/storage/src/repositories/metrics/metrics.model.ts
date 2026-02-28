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
  el_min: number | null;
  el_max: number | null;
  el_mean: number | null;
  el_p50: number | null;
  el_p99: number | null;
}

export interface MetricsSnapshot {
  timestamp: number;
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  netUp: number;
  netDown: number;
  targetId?: string;
  elMin?: number;
  elMax?: number;
  elMean?: number;
  elP50?: number;
  elP99?: number;
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
    ...(row.el_min != null && { elMin: row.el_min }),
    ...(row.el_max != null && { elMax: row.el_max }),
    ...(row.el_mean != null && { elMean: row.el_mean }),
    ...(row.el_p50 != null && { elP50: row.el_p50 }),
    ...(row.el_p99 != null && { elP99: row.el_p99 }),
  };
}
