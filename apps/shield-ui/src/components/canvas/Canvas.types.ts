/**
 * Shared types for the Canvas dashboard
 */

import type { SSEEvent } from '../../state/events';

export type CanvasStatus = 'ok' | 'warning' | 'error';

export interface TargetInfo {
  id: string;
  name: string;
  type: string;
  shielded: boolean;
  users: string[];
  pid?: number;
  createdAt?: number;
}

export interface TargetWithCounts extends TargetInfo {
  skillCount: number;
  policyCount: number;
  secretCount: number;
}

export interface CanvasData {
  targets: TargetWithCounts[];
  coreStatus: CanvasStatus;
  daemonRunning: boolean;
  daemonVersion: string;
  daemonUptime: string;
  daemonPid?: number;
  cloudConnected: boolean;
  sseConnected: boolean;
  authLocked: boolean;
  recentEvents: SSEEvent[];
  totalEvents: number;
  deniedEvents: number;
  allowedEvents: number;
  warningCount: number;
  // Policy graph
  activePolicyCount: number;
  // Security component status
  sandboxUserExists: boolean;
  isIsolated: boolean;
  guardedShellInstalled: boolean;
  securityLevel: 'secure' | 'partial' | 'unprotected' | 'critical';
  currentUser: string;
  // System metrics
  cpuPercent: number;
  memPercent: number;
}

export interface PulseData {
  severity: 'success' | 'error' | 'warning';
  timestamp: number;
}

export interface TargetNodeData {
  target: TargetWithCounts;
  pulse?: PulseData;
  [key: string]: unknown;
}

export interface TargetStatsNodeData {
  targetId: string;
  skillCount: number;
  policyCount: number;
  secretCount: number;
  [key: string]: unknown;
}

export interface HudIndicatorData {
  type: 'connectivity' | 'auth' | 'alerts' | 'throughput' | 'cloud';
  label: string;
  status: 'ok' | 'warning' | 'error';
  value?: string;
  [key: string]: unknown;
}

export interface ShieldCoreData {
  status: CanvasStatus;
  version: string;
  uptime: string;
  activePolicies: number;
  targetCount: number;
  width?: number;
  topHandlePositions?: number[];
  bottomHandlePositions?: number[];
  [key: string]: unknown;
}

export interface CloudNodeData {
  connected: boolean;
  [key: string]: unknown;
}

export interface LogoNodeData {
  running: boolean;
  pid?: number;
  version: string;
  [key: string]: unknown;
}

export interface ActivityPanelData {
  events: SSEEvent[];
  [key: string]: unknown;
}

export interface TrafficOverlayData {
  events: SSEEvent[];
  width: number;
  [key: string]: unknown;
}

export interface FirewallPieceData {
  id: 'network' | 'system' | 'filesystem';
  label: string;
  sublabel: string;
  active: boolean;
  [key: string]: unknown;
}

export interface ComputerNodeData {
  currentUser: string;
  securityLevel: 'secure' | 'partial' | 'unprotected' | 'critical';
  [key: string]: unknown;
}

export interface DeniedBucketData {
  [key: string]: unknown;
}

export interface PolicyGraphData {
  activePolicies: number;
  targetCount: number;
  width?: number;
  topHandlePositions?: number[];
  bottomHandlePositions?: number[];
  [key: string]: unknown;
}

export interface ControllerNodeData {
  label: string;
  sublabel?: string;
  active: boolean;
  [key: string]: unknown;
}

export interface SystemMetricsNodeData {
  cpuPercent: number;
  memPercent: number;
  [key: string]: unknown;
}

export interface HudPanelNodeData {
  indicators: HudIndicatorData[];
  [key: string]: unknown;
}

export interface PcbBackgroundData {
  width: number;
  height: number;
  [key: string]: unknown;
}
