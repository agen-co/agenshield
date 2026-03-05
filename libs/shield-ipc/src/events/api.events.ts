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

export interface OpenUrlRequestPayload {
  requestId: string;
  url: string;
  browser?: string;
  profileId?: string;
  expiresAt: string;
}

export interface OpenUrlApprovedPayload {
  requestId: string;
  url: string;
}

export interface OpenUrlDeniedPayload {
  requestId: string;
  url: string;
  reason: string;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'api:request': ApiRequestPayload;
    'api:outbound': ApiOutboundPayload;
    'broker:request': BrokerRequestPayload;
    'broker:response': BrokerResponsePayload;
    'api:open_url_request': OpenUrlRequestPayload;
    'api:open_url_approved': OpenUrlApprovedPayload;
    'api:open_url_denied': OpenUrlDeniedPayload;
  }
}

export const API_EVENT_TYPES = [
  'api:request',
  'api:outbound',
  'broker:request',
  'broker:response',
  'api:open_url_request',
  'api:open_url_approved',
  'api:open_url_denied',
] as const;

registerEventTypes(API_EVENT_TYPES);
