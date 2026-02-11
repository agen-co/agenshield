/**
 * Core protocol events — heartbeat, config, daemon status.
 */

import type { DaemonStatus } from '../types/daemon';
import { registerEventTypes } from './event-registry';

export interface HeartbeatPayload {
  connected?: boolean;
  ping?: boolean;
  message?: string;
  filter?: string;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'heartbeat': HeartbeatPayload;
    'config:changed': Record<string, unknown>;
    'daemon:status': DaemonStatus;
  }
}

export const CORE_EVENT_TYPES = [
  'heartbeat',
  'config:changed',
  'daemon:status',
] as const;

registerEventTypes(CORE_EVENT_TYPES);
