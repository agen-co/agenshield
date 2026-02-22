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

export type ComponentHealth = 'ok' | 'warn' | 'danger';

export interface ComponentStatus {
  exposed: boolean;
  active: boolean;
  health: ComponentHealth;
  okCount: number;
  warnCount: number;
  dangerCount: number;
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
  metricsLoaded: boolean;
  metricsHistory: MetricsSnapshot[];
  components: Record<SystemComponentType, ComponentStatus>;
  wingsForceOpen: boolean;
  systemInfo: {
    hostname: string;
    activeUser: string;
    uptime: number;
    platform: string;
    arch: string;
    cpuModel: string;
    totalMemory: number;
    nodeVersion: string;
  } | null;
}

export const systemStore = proxy<SystemStoreState>({
  metrics: {
    cpuPercent: 0,
    memPercent: 0,
    diskPercent: 0,
    netUp: 0,
    netDown: 0,
    cmdRate: 0,
    logRate: 0,
  },
  metricsLoaded: false,
  metricsHistory: [] as MetricsSnapshot[],
  wingsForceOpen: false,
  systemInfo: null,
  components: {
    cpu:        { exposed: false, active: true, health: 'ok', okCount: 0, warnCount: 0, dangerCount: 0 },
    network:    { exposed: false, active: true, health: 'ok', okCount: 0, warnCount: 0, dangerCount: 0 },
    command:    { exposed: false, active: true, health: 'ok', okCount: 0, warnCount: 0, dangerCount: 0 },
    filesystem: { exposed: false, active: true, health: 'ok', okCount: 0, warnCount: 0, dangerCount: 0 },
    memory:     { exposed: false, active: true, health: 'ok', okCount: 0, warnCount: 0, dangerCount: 0 },
    monitoring:     { exposed: false, active: true, health: 'ok', okCount: 0, warnCount: 0, dangerCount: 0 },
    skills:         { exposed: false, active: true, health: 'ok', okCount: 0, warnCount: 0, dangerCount: 0 },
    secrets:        { exposed: false, active: true, health: 'ok', okCount: 0, warnCount: 0, dangerCount: 0 },
    'policy-graph': { exposed: false, active: true, health: 'ok', okCount: 0, warnCount: 0, dangerCount: 0 },
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

/** Update a component's health status and counts */
export function setComponentHealth(
  type: SystemComponentType,
  health: ComponentHealth,
  counts: { ok: number; warn: number; danger: number },
): void {
  const c = systemStore.components[type];
  c.health = health;
  c.okCount = counts.ok;
  c.warnCount = counts.warn;
  c.dangerCount = counts.danger;
}

/** Show/hide auxiliary components (monitoring, skills, secrets, policy-graph) based on AgenShield activity */
export function setExtendedComponentsActive(active: boolean): void {
  systemStore.components.monitoring.active = active;
  systemStore.components.skills.active = active;
  systemStore.components.secrets.active = active;
  systemStore.components['policy-graph'].active = active;
}

/** Mark metrics as loaded (first real data received from daemon) */
export function markMetricsLoaded(): void {
  systemStore.metricsLoaded = true;
}

/** Force wings open (e.g. after passcode setup) */
export function setWingsForceOpen(open: boolean): void {
  systemStore.wingsForceOpen = open;
}

/** Update system info from daemon metrics response */
export function setSystemInfo(info: NonNullable<SystemStoreState['systemInfo']>): void {
  systemStore.systemInfo = info;
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
