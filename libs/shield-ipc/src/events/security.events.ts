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

export interface AclFailurePayload {
  path: string;
  userName: string;
  action: 'allow' | 'deny';
  reason: string;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'security:status': SecurityStatusPayload;
    'security:warning': MessagePayload;
    'security:critical': MessagePayload;
    'security:alert': MessagePayload;
    'security:config_tampered': ConfigTamperedPayload;
    'security:locked': SecurityLockedPayload;
    'security:acl_failure': AclFailurePayload;
  }
}

export const SECURITY_EVENT_TYPES = [
  'security:status',
  'security:warning',
  'security:critical',
  'security:alert',
  'security:config_tampered',
  'security:locked',
  'security:acl_failure',
] as const;

registerEventTypes(SECURITY_EVENT_TYPES);
