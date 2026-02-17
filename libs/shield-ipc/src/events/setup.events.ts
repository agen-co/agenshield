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
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'setup:detection': SetupDetectionPayload;
    'setup:shield_progress': SetupShieldProgressPayload;
    'setup:shield_complete': SetupShieldCompletePayload;
    'setup:complete': SetupCompletePayload;
    'setup:error': SetupErrorPayload;
  }
}

export const SETUP_EVENT_TYPES = [
  'setup:detection',
  'setup:shield_progress',
  'setup:shield_complete',
  'setup:complete',
  'setup:error',
] as const;

registerEventTypes(SETUP_EVENT_TYPES);
