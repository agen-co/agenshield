/**
 * Enrollment events — MDM org-based device enrollment lifecycle.
 */

import { registerEventTypes } from './event-registry';

export interface EnrollmentPendingPayload {
  verificationUri: string;
  userCode: string;
  expiresAt: string;
}

export interface EnrollmentCompletePayload {
  agentId: string;
  companyName: string;
}

export interface EnrollmentFailedPayload {
  error: string;
  retryAt?: string;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'enrollment:pending': EnrollmentPendingPayload;
    'enrollment:complete': EnrollmentCompletePayload;
    'enrollment:failed': EnrollmentFailedPayload;
  }
}

export const ENROLLMENT_EVENT_TYPES = [
  'enrollment:pending',
  'enrollment:complete',
  'enrollment:failed',
] as const;

registerEventTypes(ENROLLMENT_EVENT_TYPES);
