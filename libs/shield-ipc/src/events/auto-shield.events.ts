/**
 * Auto-shield events — automatic shielding of detected targets after enrollment.
 */

import { registerEventTypes } from './event-registry';

export interface AutoShieldStartedPayload {
  total: number;
  targetIds: string[];
}

export interface AutoShieldTargetStartedPayload {
  targetId: string;
  targetName: string;
  current: number;
  total: number;
}

export interface AutoShieldTargetCompletePayload {
  targetId: string;
  targetName: string;
  current: number;
  total: number;
}

export interface AutoShieldTargetFailedPayload {
  targetId: string;
  targetName: string;
  error: string;
  current: number;
  total: number;
}

export interface AutoShieldCompletePayload {
  shielded: number;
  failed: number;
  skipped: number;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'auto-shield:started': AutoShieldStartedPayload;
    'auto-shield:target_started': AutoShieldTargetStartedPayload;
    'auto-shield:target_complete': AutoShieldTargetCompletePayload;
    'auto-shield:target_failed': AutoShieldTargetFailedPayload;
    'auto-shield:complete': AutoShieldCompletePayload;
  }
}

export const AUTO_SHIELD_EVENT_TYPES = [
  'auto-shield:started',
  'auto-shield:target_started',
  'auto-shield:target_complete',
  'auto-shield:target_failed',
  'auto-shield:complete',
] as const;

registerEventTypes(AUTO_SHIELD_EVENT_TYPES);
