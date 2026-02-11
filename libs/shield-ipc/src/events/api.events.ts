/**
 * API & broker events.
 */

import { registerEventTypes } from './event-registry';

export interface ApiRequestPayload {
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  requestBody?: unknown;
  responseBody?: unknown;
}

export interface ApiOutboundPayload {
  context: string;
  url: string;
  method: string;
  statusCode: number;
  duration: number;
  requestBody?: string;
  responseBody?: string;
  success: boolean;
}

export interface BrokerRequestPayload {
  operation: string;
  args: unknown;
}

export interface BrokerResponsePayload {
  operation: string;
  success: boolean;
  duration: number;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'api:request': ApiRequestPayload;
    'api:outbound': ApiOutboundPayload;
    'broker:request': BrokerRequestPayload;
    'broker:response': BrokerResponsePayload;
  }
}

export const API_EVENT_TYPES = [
  'api:request',
  'api:outbound',
  'broker:request',
  'broker:response',
] as const;

registerEventTypes(API_EVENT_TYPES);
