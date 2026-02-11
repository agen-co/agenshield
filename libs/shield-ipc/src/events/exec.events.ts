/**
 * Execution monitoring, interceptor, and endpoint security events.
 */

import { registerEventTypes } from './event-registry';

export interface ExecMonitoredPayload {
  command: string;
  args: string[];
  cwd?: string;
  exitCode: number;
  allowed: boolean;
  duration: number;
}

export interface ExecDeniedPayload {
  command: string;
  reason: string;
}

export interface InterceptorEventPayload {
  type: string;
  operation: string;
  target: string;
  timestamp: string;
  duration?: number;
  policyId?: string;
  error?: string;
}

export interface ESExecPayload {
  binary: string;
  args: string;
  pid: number;
  ppid: number;
  sessionId: number;
  user: string;
  allowed: boolean;
  policyId?: string;
  reason?: string;
  sourceLayer: 'es-extension';
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'exec:monitored': ExecMonitoredPayload;
    'exec:denied': ExecDeniedPayload;
    'interceptor:event': InterceptorEventPayload;
    'es:exec': ESExecPayload;
  }
}

export const EXEC_EVENT_TYPES = [
  'exec:monitored',
  'exec:denied',
  'interceptor:event',
  'es:exec',
] as const;

registerEventTypes(EXEC_EVENT_TYPES);
