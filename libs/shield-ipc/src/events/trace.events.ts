/**
 * Trace execution events — traceable execution graph lifecycle.
 */

import { registerEventTypes } from './event-registry';

export interface TraceStartedPayload {
  traceId: string;
  parentTraceId?: string;
  command: string;
  depth: number;
  policyId?: string;
  graphNodeId?: string;
  allowed: boolean;
}

export interface TraceCompletedPayload {
  traceId: string;
  durationMs: number;
  childCount: number;
}

export interface TraceAnomalyPayload {
  traceId: string;
  parentTraceId?: string;
  command: string;
  reason: string;
  severity: 'warning' | 'critical';
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'trace:started': TraceStartedPayload;
    'trace:completed': TraceCompletedPayload;
    'trace:anomaly': TraceAnomalyPayload;
  }
}

export const TRACE_EVENT_TYPES = [
  'trace:started',
  'trace:completed',
  'trace:anomaly',
] as const;

registerEventTypes(TRACE_EVENT_TYPES);
