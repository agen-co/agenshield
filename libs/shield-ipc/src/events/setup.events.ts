/**
 * Setup events — detection, shielding progress, and setup completion.
 */

import type { DetectedTarget, OldInstallation } from '../types/setup';
import { registerEventTypes } from './event-registry';

export interface SetupDetectionPayload {
  targets: DetectedTarget[];
  oldInstallations: OldInstallation[];
}

export interface SetupShieldProgressPayload {
  targetId: string;
  step: string;
  progress: number;
  message?: string;
}

export interface SetupShieldCompletePayload {
  targetId: string;
  profileId: string;
}

export interface SetupCompletePayload {
  /* empty — signals mode transition */
}

export interface SetupErrorPayload {
  error: string;
  targetId?: string;
  step?: string;
}

export interface SetupStateChangePayload {
  state: unknown;
  context: Record<string, unknown>;
  phase: string;
}

export interface SetupScanCompletePayload {
  state: unknown;
  context: Record<string, unknown>;
  scanResult: unknown;
}

export interface SetupLogPayload {
  message: string;
  stepId?: string;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'setup:detection': SetupDetectionPayload;
    'setup:shield_progress': SetupShieldProgressPayload;
    'setup:shield_complete': SetupShieldCompletePayload;
    'setup:complete': SetupCompletePayload;
    'setup:error': SetupErrorPayload;
    'setup:state_change': SetupStateChangePayload;
    'setup:scan_complete': SetupScanCompletePayload;
    'setup:log': SetupLogPayload;
  }
}

export const SETUP_EVENT_TYPES = [
  'setup:detection',
  'setup:shield_progress',
  'setup:shield_complete',
  'setup:complete',
  'setup:error',
  'setup:state_change',
  'setup:scan_complete',
  'setup:log',
] as const;

registerEventTypes(SETUP_EVENT_TYPES);
