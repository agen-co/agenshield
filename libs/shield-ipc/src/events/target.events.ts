/**
 * Target lifecycle events.
 */

import type { TargetType } from '../types/setup';
import { registerEventTypes } from './event-registry';

export interface AgentProcessInfo {
  pid: number;
  elapsed: string;
  command: string;
  startedAtMs?: number;
}

export interface TargetStatusInfo {
  id: string;
  name: string;
  type: TargetType;
  shielded: boolean;
  running: boolean;
  version?: string;
  binaryPath?: string;
  gatewayPort?: number;
  pid?: number;
  processes?: AgentProcessInfo[];
  /** True when the target's embedded node binary no longer matches the shielded hash */
  binaryDrifted?: boolean;
}

export interface TargetStatusPayload {
  targets: TargetStatusInfo[];
}

export interface TargetBinaryDriftedPayload {
  targetId: string;
  expectedHash: string;
  currentHash: string;
  nodePath: string;
}

export interface TargetRePatchedPayload {
  targetId: string;
  previousHash: string;
  newHash: string;
  nodePath: string;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'targets:status': TargetStatusPayload;
    'target:binary-drifted': TargetBinaryDriftedPayload;
    'target:re-patched': TargetRePatchedPayload;
  }
}

export const TARGET_EVENT_TYPES = [
  'targets:status',
  'target:binary-drifted',
  'target:re-patched',
] as const;
registerEventTypes(TARGET_EVENT_TYPES);
