/**
 * Alert domain types
 *
 * Persistent alerts generated from security-relevant events.
 * Alerts are pinned until explicitly acknowledged by the user.
 */

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface Alert {
  id: number;
  activityEventId: number;
  profileId?: string;
  eventType: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  navigationTarget: string;
  details?: unknown;
  acknowledgedAt?: string;
  createdAt: string;
}
