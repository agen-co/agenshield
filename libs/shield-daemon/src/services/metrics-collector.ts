/**
 * Metrics collector — periodically stores system metrics to SQLite,
 * prunes old data, emits SSE push events on significant changes,
 * and detects resource spikes.
 */

import { getStorage } from '@agenshield/storage';
import { getLogger } from '../logger';
import { emitMetricsSnapshot, emitEvent } from '../events/emitter';
import { buildSnapshot, collectTargetMetrics, type FullMetricsSnapshot, type TargetMetricsEntry } from './metrics-utils';
import { getEventLoopStats } from './event-loop-monitor';
import { getLastTargetStatuses } from '../watchers/targets';

let collectInterval: ReturnType<typeof setInterval> | null = null;
let pruneInterval: ReturnType<typeof setInterval> | null = null;

// Hybrid push state
let lastEmitted: FullMetricsSnapshot | null = null;
let lastEmitTime = 0;

const HEARTBEAT_INTERVAL_MS = 10_000; // Always emit at least every 10s
const CPU_MEM_DISK_THRESHOLD = 1;     // Emit if CPU/mem/disk changed by >1pp
const NET_RELATIVE_THRESHOLD = 0.1;   // Emit if net throughput changed by >10%

/* ---- Spike detection state ---- */

interface SpikeThresholds {
  sustained: number;        // percent threshold for sustained spike
  sustainedReadings: number; // consecutive readings needed
  jumpDelta: number;         // percent jump between consecutive readings
}

const SPIKE_CONFIG: Record<'cpu' | 'memory' | 'disk', SpikeThresholds> = {
  cpu:    { sustained: 90, sustainedReadings: 3, jumpDelta: 30 },
  memory: { sustained: 90, sustainedReadings: 3, jumpDelta: 25 },
  disk:   { sustained: 95, sustainedReadings: 3, jumpDelta: 0 }, // No jump detection for disk
};

const SPIKE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between re-alerts

// Rolling counters for sustained threshold detection
const sustainedCounters: Record<'cpu' | 'memory' | 'disk', number> = { cpu: 0, memory: 0, disk: 0 };
// Last snapshot for jump detection
let previousSnap: FullMetricsSnapshot | null = null;
// Cooldown timestamps per metric+type
const lastSpikeAlert: Record<string, number> = {};

function checkSpikes(snap: FullMetricsSnapshot): void {
  const now = Date.now();
  const values: Record<'cpu' | 'memory' | 'disk', number> = {
    cpu: snap.cpuPercent,
    memory: snap.memPercent,
    disk: snap.diskPercent,
  };

  for (const metric of ['cpu', 'memory', 'disk'] as const) {
    const cfg = SPIKE_CONFIG[metric];
    const value = values[metric];

    // --- Sustained threshold detection ---
    if (value > cfg.sustained) {
      sustainedCounters[metric]++;
    } else {
      sustainedCounters[metric] = 0;
    }

    if (sustainedCounters[metric] >= cfg.sustainedReadings) {
      const cooldownKey = `${metric}:sustained`;
      if (!lastSpikeAlert[cooldownKey] || now - lastSpikeAlert[cooldownKey] >= SPIKE_COOLDOWN_MS) {
        lastSpikeAlert[cooldownKey] = now;
        sustainedCounters[metric] = 0; // Reset after alert
        const message = `${metric.charAt(0).toUpperCase() + metric.slice(1)} usage sustained above ${cfg.sustained}% (current: ${value.toFixed(1)}%)`;
        getLogger().warn({ metric, value, threshold: cfg.sustained }, message);
        emitEvent('metrics:spike', {
          metric,
          value,
          threshold: cfg.sustained,
          type: 'sustained',
          message,
        });
      }
    }

    // --- Sudden jump detection ---
    if (cfg.jumpDelta > 0 && previousSnap) {
      const prevValues: Record<'cpu' | 'memory' | 'disk', number> = {
        cpu: previousSnap.cpuPercent,
        memory: previousSnap.memPercent,
        disk: previousSnap.diskPercent,
      };
      const delta = value - prevValues[metric];
      if (delta > cfg.jumpDelta) {
        const cooldownKey = `${metric}:sudden_jump`;
        if (!lastSpikeAlert[cooldownKey] || now - lastSpikeAlert[cooldownKey] >= SPIKE_COOLDOWN_MS) {
          lastSpikeAlert[cooldownKey] = now;
          const message = `${metric.charAt(0).toUpperCase() + metric.slice(1)} spiked by ${delta.toFixed(1)} percentage points (${prevValues[metric].toFixed(1)}% -> ${value.toFixed(1)}%)`;
          getLogger().warn({ metric, value, delta, threshold: cfg.jumpDelta }, message);
          emitEvent('metrics:spike', {
            metric,
            value,
            threshold: cfg.jumpDelta,
            type: 'sudden_jump',
            message,
          });
        }
      }
    }
  }

  previousSnap = snap;
}

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
    const snap = await buildSnapshot();
    const now = Date.now();

    const storage = getStorage();
    const elStats = getEventLoopStats();
    storage.metrics.create({
      timestamp: now,
      cpuPercent: snap.cpuPercent,
      memPercent: snap.memPercent,
      diskPercent: snap.diskPercent,
      netUp: snap.netUp,
      netDown: snap.netDown,
      ...(elStats && {
        elMin: elStats.min,
        elMax: elStats.max,
        elMean: elStats.mean,
        elP50: elStats.p50,
        elP99: elStats.p99,
      }),
    });

    // Spike detection — check thresholds and jumps
    checkSpikes(snap);

    // Collect per-target metrics (CPU/memory only)
    let targetEntries: TargetMetricsEntry[] = [];
    try {
      const targets = getLastTargetStatuses();
      const runningShielded = targets.filter((t) => t.shielded && t.running);
      if (runningShielded.length > 0) {
        const profiles = storage.profiles.getAll();
        targetEntries = await collectTargetMetrics(runningShielded, profiles);

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
 * Collects every 2s, prunes entries older than 15min every 2min.
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
  }, 2 * 60 * 1000);

  getLogger().info('Metrics collector started (2s interval, 15min retention, hybrid SSE push)');
}

/** Stop the metrics collector. */
export function stopMetricsCollector(): void {
  if (collectInterval) { clearInterval(collectInterval); collectInterval = null; }
  if (pruneInterval) { clearInterval(pruneInterval); pruneInterval = null; }
  lastEmitted = null;
  lastEmitTime = 0;
  // Reset spike detection state
  previousSnap = null;
  sustainedCounters.cpu = 0;
  sustainedCounters.memory = 0;
  sustainedCounters.disk = 0;
}
