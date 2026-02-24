/**
 * Target lifecycle events.
 */

import { registerEventTypes } from './event-registry';

export interface TargetStatusInfo {
  id: string;
  name: string;
  type: string;
  shielded: boolean;
  running: boolean;
  version?: string;
  binaryPath?: string;
  gatewayPort?: number;
  pid?: number;
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
