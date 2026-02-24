/**
 * Metrics collector — periodically stores system metrics to SQLite,
 * prunes old data, and emits SSE push events on significant changes.
 */

import { getStorage } from '@agenshield/storage';
import { getLogger } from '../logger';
import { emitMetricsSnapshot } from '../events/emitter';
import { buildSyncSnapshot, collectTargetMetrics, type FullMetricsSnapshot, type TargetMetricsEntry } from './metrics-utils';
import { getLastTargetStatuses } from '../watchers/targets';

let collectInterval: ReturnType<typeof setInterval> | null = null;
let pruneInterval: ReturnType<typeof setInterval> | null = null;

// Hybrid push state
let lastEmitted: FullMetricsSnapshot | null = null;
let lastEmitTime = 0;

const HEARTBEAT_INTERVAL_MS = 10_000; // Always emit at least every 10s
const CPU_MEM_DISK_THRESHOLD = 1;     // Emit if CPU/mem/disk changed by >1pp
const NET_RELATIVE_THRESHOLD = 0.1;   // Emit if net throughput changed by >10%

/**
 * Check if a snapshot differs enough from the last emitted one to warrant a push.
 */
function shouldEmit(snap: FullMetricsSnapshot): boolean {
  if (!lastEmitted) return true;
  if (Date.now() - lastEmitTime >= HEARTBEAT_INTERVAL_MS) return true;

  if (Math.abs(snap.cpuPercent - lastEmitted.cpuPercent) > CPU_MEM_DISK_THRESHOLD) return true;
  if (Math.abs(snap.memPercent - lastEmitted.memPercent) > CPU_MEM_DISK_THRESHOLD) return true;
  if (Math.abs(snap.diskPercent - lastEmitted.diskPercent) > CPU_MEM_DISK_THRESHOLD) return true;

  // Network: relative change (avoid noise from tiny absolute differences)
  const prevNet = Math.max(lastEmitted.netUp + lastEmitted.netDown, 1);
  const currNet = snap.netUp + snap.netDown;
  if (Math.abs(currNet - prevNet) / prevNet > NET_RELATIVE_THRESHOLD) return true;

  return false;
}

/**
 * Collect a single metrics snapshot, write to storage, and emit SSE if thresholds met.
 */
async function collectAndStore(): Promise<void> {
  try {
    const snap = buildSyncSnapshot();
    const now = Date.now();

    const storage = getStorage();
    storage.metrics.create({
      timestamp: now,
      cpuPercent: snap.cpuPercent,
      memPercent: snap.memPercent,
      diskPercent: snap.diskPercent,
      netUp: snap.netUp,
      netDown: snap.netDown,
    });

    // Collect per-target metrics (CPU/memory only)
    let targetEntries: TargetMetricsEntry[] = [];
    try {
      const targets = getLastTargetStatuses();
      const runningShielded = targets.filter((t) => t.shielded && t.running);
      if (runningShielded.length > 0) {
        const profiles = storage.profiles.getAll();
        targetEntries = collectTargetMetrics(runningShielded, profiles);

        // Store per-target snapshots
        for (const entry of targetEntries) {
          storage.metrics.create({
            timestamp: now,
            cpuPercent: entry.cpuPercent,
            memPercent: entry.memPercent,
            diskPercent: 0,
            netUp: 0,
            netDown: 0,
            targetId: entry.targetId,
          });
        }
      }
    } catch (err) {
      getLogger().debug({ err }, 'Per-target metrics collection failed');
    }

    // Hybrid push: emit via SSE only when thresholds are exceeded
    if (shouldEmit(snap)) {
      emitMetricsSnapshot({
        ...snap,
        ...(targetEntries.length > 0 && { targets: targetEntries }),
      });
      lastEmitted = snap;
      lastEmitTime = Date.now();
    }
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

  getLogger().info('Metrics collector started (2s interval, 24h retention, hybrid SSE push)');
}

/** Stop the metrics collector. */
export function stopMetricsCollector(): void {
  if (collectInterval) { clearInterval(collectInterval); collectInterval = null; }
  if (pruneInterval) { clearInterval(pruneInterval); pruneInterval = null; }
  lastEmitted = null;
  lastEmitTime = 0;
}
