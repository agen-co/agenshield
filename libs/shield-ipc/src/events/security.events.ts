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

export interface ConfigTamperedPayload {
  detectedAt: string;
  action: 'deny_all';
}

export interface SecurityLockedPayload {
  reason: 'idle_timeout' | 'manual' | 'session_expired';
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'security:status': SecurityStatusPayload;
    'security:warning': MessagePayload;
    'security:critical': MessagePayload;
    'security:alert': MessagePayload;
    'security:config_tampered': ConfigTamperedPayload;
    'security:locked': SecurityLockedPayload;
  }
}

export const SECURITY_EVENT_TYPES = [
  'security:status',
  'security:warning',
  'security:critical',
  'security:alert',
  'security:config_tampered',
  'security:locked',
] as const;

registerEventTypes(SECURITY_EVENT_TYPES);
