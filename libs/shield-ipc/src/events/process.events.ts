/**
 * Process lifecycle events.
 */

import { registerEventTypes } from './event-registry';

export interface ProcessEventPayload {
  process: string;
  action: string;
  pid?: number;
  previousPid?: number;
  lastExitStatus?: number;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'process:started': ProcessEventPayload;
    'process:stopped': ProcessEventPayload;
    'process:broker_started': ProcessEventPayload;
    'process:broker_stopped': ProcessEventPayload;
    'process:broker_restarted': ProcessEventPayload;
    'process:gateway_started': ProcessEventPayload;
    'process:gateway_stopped': ProcessEventPayload;
    'process:gateway_restarted': ProcessEventPayload;
    'process:daemon_started': ProcessEventPayload;
    'process:daemon_stopped': ProcessEventPayload;
  }
}

export const PROCESS_EVENT_TYPES = [
  'process:started',
  'process:stopped',
  'process:broker_started',
  'process:broker_stopped',
  'process:broker_restarted',
  'process:gateway_started',
  'process:gateway_stopped',
  'process:gateway_restarted',
  'process:daemon_started',
  'process:daemon_stopped',
] as const;

registerEventTypes(PROCESS_EVENT_TYPES);
