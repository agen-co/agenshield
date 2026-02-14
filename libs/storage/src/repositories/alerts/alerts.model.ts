/**
 * Alerts model — Row mapper
 */

import type { Alert } from '@agenshield/ipc';
import type { DbAlertRow } from '../../types';

export function mapAlert(row: DbAlertRow): Alert {
  return {
    id: row.id,
    activityEventId: row.activity_event_id,
    profileId: row.profile_id ?? undefined,
    eventType: row.event_type,
    severity: row.severity as Alert['severity'],
    title: row.title,
    description: row.description,
    navigationTarget: row.navigation_target,
    details: row.details ? JSON.parse(row.details) : undefined,
    acknowledgedAt: row.acknowledged_at ?? undefined,
    createdAt: row.created_at,
  };
}
