/**
 * Event Loop Lag Monitor
 *
 * Two complementary measurement methods:
 * A) perf_hooks.monitorEventLoopDelay() — histogram with 11ms resolution
 * B) setTimeout-based lag detector — coarse signal for large stalls
 *
 * Emits 'metrics:eventloop' SSE events and exposes stats for the health endpoint.
 */

import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { getLogger } from '../logger';
import { emitEvent } from '../events/emitter';

// ── State ────────────────────────────────────────────────────────

let histogram: IntervalHistogram | null = null;
let sampleInterval: NodeJS.Timeout | null = null;
let lagInterval: NodeJS.Timeout | null = null;

interface EventLoopStats {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p99: number;
  timestamp: number;
}

let lastStats: EventLoopStats | null = null;

// ── Configuration ────────────────────────────────────────────────

const SAMPLE_INTERVAL_MS = 5_000;
const LAG_CHECK_INTERVAL_MS = 200;
const WARN_P99_MS = 50;
const CRITICAL_P99_MS = 200;
const LAG_WARN_MS = 50;

// ── Helpers ──────────────────────────────────────────────────────

/** Convert nanoseconds to milliseconds with 2 decimal places */
function nsToMs(ns: number): number {
  return Math.round(ns / 1e6 * 100) / 100;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Start the event loop monitor.
 * Should be called early in the daemon lifecycle, before watchers.
 */
export function startEventLoopMonitor(): void {
  if (histogram) return; // Already running

  const log = getLogger();

  // A) perf_hooks histogram (11ms resolution)
  histogram = monitorEventLoopDelay({ resolution: 11 });
  histogram.enable();

  sampleInterval = setInterval(() => {
    if (!histogram) return;

    const stats: EventLoopStats = {
      min: nsToMs(histogram.min),
      max: nsToMs(histogram.max),
      mean: nsToMs(histogram.mean),
      p50: nsToMs(histogram.percentile(50)),
      p99: nsToMs(histogram.percentile(99)),
      timestamp: Date.now(),
    };

    lastStats = stats;

    // Log warnings based on p99
    if (stats.p99 > CRITICAL_P99_MS) {
      log.error({ ...stats }, `[event-loop] CRITICAL: p99 event loop delay ${stats.p99}ms (threshold: ${CRITICAL_P99_MS}ms)`);
    } else if (stats.p99 > WARN_P99_MS) {
      log.warn({ ...stats }, `[event-loop] WARNING: p99 event loop delay ${stats.p99}ms (threshold: ${WARN_P99_MS}ms)`);
    }

    // Emit SSE event
    emitEvent('metrics:eventloop', stats);

    // Reset histogram for next window
    histogram.reset();
  }, SAMPLE_INTERVAL_MS);

  // B) setTimeout-based lag detector
  let expectedTime = Date.now() + LAG_CHECK_INTERVAL_MS;

  function checkLag(): void {
    const now = Date.now();
    const drift = now - expectedTime;
    if (drift > LAG_WARN_MS) {
      log.warn(`[event-loop] setTimeout drift: ${drift}ms (expected interval: ${LAG_CHECK_INTERVAL_MS}ms)`);
    }
    expectedTime = now + LAG_CHECK_INTERVAL_MS;
    lagInterval = setTimeout(checkLag, LAG_CHECK_INTERVAL_MS);
  }

  lagInterval = setTimeout(checkLag, LAG_CHECK_INTERVAL_MS);

  log.info(`[event-loop] Monitor started (sample: ${SAMPLE_INTERVAL_MS}ms, lag check: ${LAG_CHECK_INTERVAL_MS}ms)`);
}

/**
 * Stop the event loop monitor.
 */
export function stopEventLoopMonitor(): void {
  if (histogram) {
    histogram.disable();
    histogram = null;
  }
  if (sampleInterval) {
    clearInterval(sampleInterval);
    sampleInterval = null;
  }
  if (lagInterval) {
    clearTimeout(lagInterval);
    lagInterval = null;
  }
  lastStats = null;
}

/**
 * Get the most recent event loop stats.
 * Returns null if the monitor hasn't collected any data yet.
 */
export function getEventLoopStats(): EventLoopStats | null {
  return lastStats;
}
