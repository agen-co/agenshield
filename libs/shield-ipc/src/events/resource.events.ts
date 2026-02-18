/**
 * Resource monitoring events — warnings and enforcement actions.
 */

import { registerEventTypes } from './event-registry';

export interface ResourceWarningPayload {
  pid: number;
  command: string;
  traceId?: string;
  metric: 'memory' | 'cpu' | 'timeout';
  currentValue: number;
  threshold: number;
  unit: 'mb' | 'percent' | 'ms';
}

export interface ResourceLimitEnforcedPayload {
  pid: number;
  command: string;
  traceId?: string;
  metric: 'memory' | 'cpu' | 'timeout';
  currentValue: number;
  threshold: number;
  unit: 'mb' | 'percent' | 'ms';
  signal: 'SIGTERM' | 'SIGKILL';
  gracefulExit: boolean;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'resource:warning': ResourceWarningPayload;
    'resource:limit_enforced': ResourceLimitEnforcedPayload;
  }
}

export const RESOURCE_EVENT_TYPES = [
  'resource:warning',
  'resource:limit_enforced',
] as const;

registerEventTypes(RESOURCE_EVENT_TYPES);
