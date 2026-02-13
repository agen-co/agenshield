/**
 * AgenCo integration events.
 */

import { registerEventTypes } from './event-registry';

export interface AgenCoAuthRequiredPayload {
  authUrl: string;
  integration?: string;
}

export interface AgenCoErrorPayload {
  code: string;
  message: string;
}

export interface AgenCoToolExecutedPayload {
  tool: string;
  integration?: string;
  success: boolean;
  duration?: number;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'agenco:connected': Record<string, never>;
    'agenco:disconnected': Record<string, never>;
    'agenco:auth_required': AgenCoAuthRequiredPayload;
    'agenco:auth_completed': Record<string, never>;
    'agenco:tool_executed': AgenCoToolExecutedPayload;
    'agenco:error': AgenCoErrorPayload;
  }
}

export const AGENCO_EVENT_TYPES = [
  'agenco:connected',
  'agenco:disconnected',
  'agenco:auth_required',
  'agenco:auth_completed',
  'agenco:tool_executed',
  'agenco:error',
] as const;

registerEventTypes(AGENCO_EVENT_TYPES);
