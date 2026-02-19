/**
 * Unified valtio store for system metrics and per-component status.
 *
 * Replaces the standalone `systemMetricsStore` with a single proxy that holds:
 *   - `metrics` — live CPU, memory, disk, network, command, and log rates
 *   - `components` — per-component exposed/active state
 *
 * Valtio tracks property access granularly, so a component that reads
 * `snap.metrics.cpuPercent` will NOT re-render when `logRate` changes.
 */

import { proxy } from 'valtio';
import type { SystemComponentType, SystemMetrics } from '../components/canvas/Canvas.types';

export interface ComponentStatus {
  exposed: boolean;
  active: boolean;
}

export interface MetricsSnapshot {
  timestamp: number;
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  netUp: number;
  netDown: number;
}

const MAX_HISTORY = 150; // 150 * 2s = 5 min

export interface SystemStoreState {
  metrics: SystemMetrics;
  metricsHistory: MetricsSnapshot[];
  components: Record<SystemComponentType, ComponentStatus>;
}

export const systemStore = proxy<SystemStoreState>({
  metrics: {
    cpuPercent: 35,
    memPercent: 52,
    diskPercent: 41,
    netUp: 125_000,
    netDown: 340_000,
    cmdRate: 2.5,
    logRate: 18,
  },
  metricsHistory: [] as MetricsSnapshot[],
  components: {
    cpu:        { exposed: false, active: true },
    network:    { exposed: false, active: true },
    command:    { exposed: false, active: true },
    filesystem: { exposed: false, active: true },
    memory:     { exposed: false, active: true },
    monitoring:     { exposed: false, active: true },
    logs:           { exposed: false, active: true },
    secrets:        { exposed: false, active: true },
    'policy-graph': { exposed: false, active: true },
  },
});

/** Set one component's status */
export function setComponentStatus(
  type: SystemComponentType,
  status: Partial<ComponentStatus>,
): void {
  Object.assign(systemStore.components[type], status);
}

/** Set all components' exposed state at once */
export function setAllExposed(exposed: boolean): void {
  for (const key of Object.keys(systemStore.components) as SystemComponentType[]) {
    systemStore.components[key].exposed = exposed;
  }
}

/** Show/hide auxiliary components (monitoring, logs, secrets, policy-graph) based on AgenShield activity */
export function setExtendedComponentsActive(active: boolean): void {
  systemStore.components.monitoring.active = active;
  systemStore.components.logs.active = active;
  systemStore.components.secrets.active = active;
  systemStore.components['policy-graph'].active = active;
}

/** Push a metrics snapshot into the rolling history buffer */
export function pushMetricsSnapshot(snap: MetricsSnapshot): void {
  const h = systemStore.metricsHistory;
  h.push(snap);
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
}

/* ---- Simulation (random walk) ---- */

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function walk(current: number, step: number, min: number, max: number): number {
  const delta = (Math.random() - 0.5) * 2 * step;
  return clamp(current + delta, min, max);
}

let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start simulated metrics for cmdRate and logRate only.
 * CPU/memory/disk/network come from the daemon metrics API.
 * Returns a cleanup function to stop the simulation.
 */
export function startMetricsSimulation(): () => void {
  if (intervalId !== null) return () => stopMetricsSimulation();

  intervalId = setInterval(() => {
    const m = systemStore.metrics;
    m.cmdRate = walk(m.cmdRate, 0.8, 0, 15);
    m.logRate = walk(m.logRate, 4, 0, 80);
  }, 1500);

  return () => stopMetricsSimulation();
}

function stopMetricsSimulation() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
