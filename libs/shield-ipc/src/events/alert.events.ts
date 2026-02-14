/**
 * Alert lifecycle events.
 */

import { registerEventTypes } from './event-registry';
import type { Alert } from '../alerts/alert.types';

export interface AlertCreatedPayload {
  alert: Alert;
}

export interface AlertAcknowledgedPayload {
  alertId: number;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'alerts:created': AlertCreatedPayload;
    'alerts:acknowledged': AlertAcknowledgedPayload;
  }
}

export const ALERT_EVENT_TYPES = [
  'alerts:created',
  'alerts:acknowledged',
] as const;

registerEventTypes(ALERT_EVENT_TYPES);
