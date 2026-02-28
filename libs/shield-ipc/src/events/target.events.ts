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
}

export interface TargetStatusPayload {
  targets: TargetStatusInfo[];
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'targets:status': TargetStatusPayload;
  }
}

export const TARGET_EVENT_TYPES = ['targets:status'] as const;
registerEventTypes(TARGET_EVENT_TYPES);
