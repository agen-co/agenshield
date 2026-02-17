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

/* ---- Setup Canvas types ---- */

export interface SkillChipData {
  id: string;
  name: string;
  active: boolean;
}

export interface McpChipData {
  id: string;
  name: string;
  active: boolean;
}

export interface ApplicationCardData {
  id: string;
  name: string;
  type: string;
  version?: string;
  binaryPath?: string;
  status: 'unshielded' | 'shielding' | 'shielded';
  icon: string;
  selected?: boolean;
  isRunning?: boolean;
  runAsRoot?: boolean;
  currentUser?: string;
  instanceIndex?: number;
  instanceCount?: number;
  side: 'left' | 'right';
  skills?: SkillChipData[];
  mcpServers?: McpChipData[];
  [key: string]: unknown;
}

export interface SystemBusData {
  width: number;
  status: 'unprotected' | 'protected';
  topHandlePositions?: number[];
  bottomHandlePositions?: number[];
  [key: string]: unknown;
}

export interface PowerSupplyData {
  cardCount: number;
  psuHeight?: number;
  [key: string]: unknown;
}

export interface EmptySlotData {
  [key: string]: unknown;
}

export interface SystemBoardData {
  currentUser: string;
  hostname?: string;
  securityLevel: 'secure' | 'partial' | 'unprotected' | 'critical';
  slotCount: number;
  slotPositions?: number[];
  boardWidth?: number;
  hasShieldDaemon: boolean;
  [key: string]: unknown;
}

export interface BackplaneBusData {
  height: number;
  leftHandleCount: number;
  rightHandleCount: number;
  status: 'unprotected' | 'partial' | 'protected';
  [key: string]: unknown;
}

export interface ShieldChipData {
  profileId: string;
  status: 'inactive' | 'activating' | 'active';
  side: 'left' | 'right';
  [key: string]: unknown;
}

/** Identifies which system component this node represents */
export type SystemComponentType = 'cpu' | 'network' | 'command' | 'filesystem' | 'memory' | 'monitoring' | 'logs';

export interface SystemMetrics {
  cpuPercent: number;    // 0-100
  memPercent: number;    // 0-100
  diskPercent: number;   // 0-100
  netUp: number;         // bytes/s
  netDown: number;       // bytes/s
  cmdRate: number;       // commands/s
  logRate: number;       // lines/s
}

export interface SystemComponentData {
  componentType: SystemComponentType;
  label: string;
  sublabel: string;
  /** Whether any unshielded agent can reach this component */
  exposed: boolean;
  /** How many unshielded agents connect to this component */
  exposedCount: number;
  /** Live system metrics */
  metrics?: SystemMetrics;
  [key: string]: unknown;
}

export interface DangerWireData {
  variant: 'primary' | 'penetration' | 'tendril' | 'shield';
  channelOffset?: number;
  [key: string]: unknown;
}

export interface AgenShieldData {
  height: number;
  leftHandleCount: number;
  rightHandleCount: number;
  status: 'unprotected' | 'partial' | 'protected';
  /** How many total cards are shielded */
  shieldedCount: number;
  /** How many total cards exist */
  totalCount: number;
  /** X positions of component handles relative to node left edge */
  compHandleXs: number[];
  /** Total width of the horizontal crossbar */
  crossbarWidth: number;
  [key: string]: unknown;
}

export interface SetupCanvasData {
  currentUser: string;
  cards: ApplicationCardData[];
  hasDetection: boolean;
  anyShielded: boolean;
  anyUnshielded: boolean;
}
