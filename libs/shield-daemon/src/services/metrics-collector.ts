/**
 * Metrics collector — periodically stores system metrics to SQLite
 * and prunes old data.
 */

import { getStorage } from '@agenshield/storage';
import { getLogger } from '../logger';

let collectInterval: ReturnType<typeof setInterval> | null = null;
let pruneInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Collect a single metrics snapshot and write it to storage.
 * Dynamically imports the metrics route helpers to avoid circular deps.
 */
async function collectAndStore(): Promise<void> {
  try {
    const os = await import('node:os');
    const { execSync } = await import('node:child_process');

    // CPU (synchronous snapshot — not the 100ms async version; good enough for history)
    const cpus = os.cpus();
    let idle = 0, total = 0;
    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
    }
    const cpuPercent = total === 0 ? 0 : Math.round((1 - idle / total) * 10000) / 100;

    // Memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memPercent = Math.round((1 - freeMem / totalMem) * 10000) / 100;

    // Disk
    let diskPercent = 0;
    try {
      const output = execSync('df -k /', { encoding: 'utf8', timeout: 3000 });
      const match = output.match(/(\d+)%/);
      if (match) diskPercent = Number(match[1]);
    } catch { /* ignore */ }

    const storage = getStorage();
    storage.metrics.create({
      timestamp: Date.now(),
      cpuPercent,
      memPercent,
      diskPercent,
      netUp: 0,
      netDown: 0,
    });
  } catch (err) {
    getLogger().debug({ err }, 'Metrics collection failed');
  }
}

/**
 * Start the background metrics collector.
 * Collects every 2s, prunes entries older than 24h every 5min.
 */
export function startMetricsCollector(): void {
  if (collectInterval) return; // Already running

  collectInterval = setInterval(collectAndStore, 2000);
  pruneInterval = setInterval(() => {
    try {
      const storage = getStorage();
      const pruned = storage.metrics.prune();
      if (pruned > 0) {
        getLogger().debug(`Pruned ${pruned} old metrics snapshots`);
      }
    } catch { /* ignore */ }
  }, 5 * 60 * 1000);

  getLogger().info('Metrics collector started (2s interval, 24h retention)');
}

/** Stop the metrics collector. */
export function stopMetricsCollector(): void {
  if (collectInterval) { clearInterval(collectInterval); collectInterval = null; }
  if (pruneInterval) { clearInterval(pruneInterval); pruneInterval = null; }
}
