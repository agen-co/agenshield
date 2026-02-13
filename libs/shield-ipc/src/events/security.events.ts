/**
 * Security domain events.
 */

import { registerEventTypes } from './event-registry';

export interface SecurityStatusPayload {
  runningAsRoot: boolean;
  currentUser: string;
  sandboxUserExists: boolean;
  isIsolated: boolean;
  guardedShellInstalled: boolean;
  exposedSecrets: string[];
  warnings: string[];
  critical: string[];
  recommendations: string[];
  level: 'secure' | 'partial' | 'unprotected' | 'critical';
}

export interface MessagePayload {
  message: string;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'security:status': SecurityStatusPayload;
    'security:warning': MessagePayload;
    'security:critical': MessagePayload;
    'security:alert': MessagePayload;
  }
}

export const SECURITY_EVENT_TYPES = [
  'security:status',
  'security:warning',
  'security:critical',
  'security:alert',
] as const;

registerEventTypes(SECURITY_EVENT_TYPES);
