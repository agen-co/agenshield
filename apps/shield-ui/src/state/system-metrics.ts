/**
 * Valtio proxy store for live system metrics.
 * Initially uses simulated data via random walk; later fed by SSE events.
 */

import { proxy } from 'valtio';
import type { SystemMetrics } from '../components/canvas/Canvas.types';

export const systemMetricsStore = proxy<SystemMetrics>({
  cpuPercent: 35,
  memPercent: 52,
  diskPercent: 41,
  netUp: 125_000,
  netDown: 340_000,
  cmdRate: 2.5,
  logRate: 18,
});

/** Clamp a value between min and max */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Smooth random walk: value drifts by up to ±step, clamped to [min, max] */
function walk(current: number, step: number, min: number, max: number): number {
  const delta = (Math.random() - 0.5) * 2 * step;
  return clamp(current + delta, min, max);
}

let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start simulated metrics updates. Call once on mount.
 * Returns a cleanup function to stop the simulation.
 */
export function startMetricsSimulation(): () => void {
  if (intervalId !== null) return () => stopMetricsSimulation();

  intervalId = setInterval(() => {
    systemMetricsStore.cpuPercent = walk(systemMetricsStore.cpuPercent, 4, 5, 95);
    systemMetricsStore.memPercent = walk(systemMetricsStore.memPercent, 2, 20, 90);
    systemMetricsStore.diskPercent = walk(systemMetricsStore.diskPercent, 1, 10, 85);
    systemMetricsStore.netUp = walk(systemMetricsStore.netUp, 20_000, 0, 1_000_000);
    systemMetricsStore.netDown = walk(systemMetricsStore.netDown, 30_000, 0, 2_000_000);
    systemMetricsStore.cmdRate = walk(systemMetricsStore.cmdRate, 0.8, 0, 15);
    systemMetricsStore.logRate = walk(systemMetricsStore.logRate, 4, 0, 80);
  }, 1500);

  return () => stopMetricsSimulation();
}

function stopMetricsSimulation() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
