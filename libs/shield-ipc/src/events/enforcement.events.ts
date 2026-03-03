/**
 * Process enforcement events.
 *
 * Emitted when the daemon's process enforcer detects or acts on
 * running processes that violate process-target policies.
 */

import { registerEventTypes } from './event-registry';

export interface EnforcementProcessPayload {
  pid: number;
  user: string;
  command: string;
  commandPreview?: string;
  policyId: string;
  policyName?: string;
  enforcement: 'alert' | 'kill';
  reason: string;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'enforcement:process_violation': EnforcementProcessPayload;
    'enforcement:process_killed': EnforcementProcessPayload;
  }
}

export const ENFORCEMENT_EVENT_TYPES = [
  'enforcement:process_violation',
  'enforcement:process_killed',
] as const;

registerEventTypes(ENFORCEMENT_EVENT_TYPES);
