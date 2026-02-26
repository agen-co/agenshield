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
import type { EventLoopPayload } from '@agenshield/ipc';
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

export interface TargetMetricsSnapshot {
  timestamp: number;
  cpuPercent: number;
  memPercent: number;
}

export interface EventLoopSnapshot {
  timestamp: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p99: number;
}

const MAX_HISTORY = 900; // 900 * 2s = 30 min

export interface SystemStoreState {
  metrics: SystemMetrics;
  metricsLoaded: boolean;
  metricsHistory: MetricsSnapshot[];
  targetMetricsHistory: Record<string, TargetMetricsSnapshot[]>;
  eventLoopHistory: EventLoopSnapshot[];
  eventLoopPulseCount: number;
  components: Record<SystemComponentType, ComponentStatus>;
  wingsForceOpen: boolean;
  panToShield: boolean;
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
  targetMetricsHistory: {} as Record<string, TargetMetricsSnapshot[]>,
  eventLoopHistory: [] as EventLoopSnapshot[],
  eventLoopPulseCount: 0,
  wingsForceOpen: false,
  panToShield: false,
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

/** Force wings open (e.g. during setup) */
export function setWingsForceOpen(open: boolean): void {
  systemStore.wingsForceOpen = open;
}

/** Request panning to the shield node */
export function setPanToShield(pan: boolean): void {
  systemStore.panToShield = pan;
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

/**
 * Handle a metrics:snapshot SSE event — update live metrics, push to history,
 * and populate system info. This replaces the polling bridge in useSetupCanvasData.
 */
/** Push a per-target metrics snapshot into the rolling history buffer */
export function pushTargetMetricsSnapshot(targetId: string, snap: TargetMetricsSnapshot): void {
  if (!systemStore.targetMetricsHistory[targetId]) {
    systemStore.targetMetricsHistory[targetId] = [];
  }
  const h = systemStore.targetMetricsHistory[targetId];
  h.push(snap);
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
}

/** Push an event loop snapshot into the rolling history buffer */
export function pushEventLoopSnapshot(snap: EventLoopSnapshot): void {
  const h = systemStore.eventLoopHistory;
  h.push(snap);
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
}

/** Handle a metrics:eventloop SSE event — push to history and bump pulse counter */
export function handleEventLoopSnapshot(payload: EventLoopPayload): void {
  pushEventLoopSnapshot({
    timestamp: payload.timestamp || Date.now(),
    min: payload.min,
    max: payload.max,
    mean: payload.mean,
    p50: payload.p50,
    p99: payload.p99,
  });
  systemStore.eventLoopPulseCount++;
}

export function handleMetricsSnapshot(m: {
  cpuPercent: number; memPercent: number; diskPercent: number;
  netUp: number; netDown: number;
  hostname?: string; activeUser?: string; uptime?: number;
  platform?: string; arch?: string; cpuModel?: string;
  totalMemory?: number; nodeVersion?: string;
  targets?: Array<{ targetId: string; targetName: string; cpuPercent: number; memPercent: number }>;
}): void {
  systemStore.metrics.cpuPercent = m.cpuPercent ?? 0;
  systemStore.metrics.memPercent = m.memPercent ?? 0;
  systemStore.metrics.diskPercent = m.diskPercent ?? 0;
  systemStore.metrics.netUp = m.netUp ?? 0;
  systemStore.metrics.netDown = m.netDown ?? 0;
  if (!systemStore.metricsLoaded) markMetricsLoaded();
  const now = Date.now();
  pushMetricsSnapshot({
    timestamp: now,
    cpuPercent: m.cpuPercent ?? 0,
    memPercent: m.memPercent ?? 0,
    diskPercent: m.diskPercent ?? 0,
    netUp: m.netUp ?? 0,
    netDown: m.netDown ?? 0,
  });
  // Process per-target metrics from SSE
  if (m.targets) {
    for (const t of m.targets) {
      pushTargetMetricsSnapshot(t.targetId, {
        timestamp: now,
        cpuPercent: t.cpuPercent,
        memPercent: t.memPercent,
      });
    }
  }
  if (m.hostname) {
    setSystemInfo({
      hostname: m.hostname,
      activeUser: m.activeUser ?? 'unknown',
      uptime: m.uptime ?? 0,
      platform: m.platform ?? 'unknown',
      arch: m.arch ?? 'unknown',
      cpuModel: m.cpuModel ?? 'unknown',
      totalMemory: m.totalMemory ?? 0,
      nodeVersion: m.nodeVersion ?? 'unknown',
    });
  }
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
