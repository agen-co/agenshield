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

export interface EventLoopPayload {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p99: number;
  timestamp: number;
}

export interface ConfigPoliciesUpdatedPayload {
  source: string;
  count: number;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'heartbeat': HeartbeatPayload;
    'config:changed': Record<string, unknown>;
    'config:policies_updated': ConfigPoliciesUpdatedPayload;
    'daemon:status': DaemonStatus;
    'metrics:eventloop': EventLoopPayload;
  }
}

export const CORE_EVENT_TYPES = [
  'heartbeat',
  'config:changed',
  'config:policies_updated',
  'daemon:status',
  'metrics:eventloop',
] as const;

registerEventTypes(CORE_EVENT_TYPES);
