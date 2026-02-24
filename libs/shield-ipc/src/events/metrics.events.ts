/**
 * Metrics domain events.
 */

import { registerEventTypes } from './event-registry';

export interface TargetMetricsEntry {
  targetId: string;
  targetName: string;
  cpuPercent: number;
  memPercent: number;
}

export interface MetricsSnapshotPayload {
  cpuPercent: number;
  memPercent: number;
  diskPercent: number;
  netUp: number;
  netDown: number;
  hostname: string;
  platform: string;
  arch: string;
  uptime: number;
  activeUser: string;
  cpuModel: string;
  totalMemory: number;
  nodeVersion: string;
  targets?: TargetMetricsEntry[];
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'metrics:snapshot': MetricsSnapshotPayload;
  }
}

export const METRICS_EVENT_TYPES = ['metrics:snapshot'] as const;
registerEventTypes(METRICS_EVENT_TYPES);
