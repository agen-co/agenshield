/**
 * Valtio store for alerts (driven by SSE push).
 */

import { proxy } from 'valtio';
import type { Alert } from '@agenshield/ipc';

export const alertsStore = proxy({
  alerts: [] as Alert[],
  unacknowledgedCount: 0,
  loaded: false,
});

export function setAlerts(alerts: Alert[], unacknowledgedCount: number): void {
  alertsStore.alerts = alerts;
  alertsStore.unacknowledgedCount = unacknowledgedCount;
  alertsStore.loaded = true;
}

export function addAlert(alert: Alert): void {
  alertsStore.alerts.unshift(alert);
  if (!alert.acknowledgedAt) {
    alertsStore.unacknowledgedCount++;
  }
}

export function acknowledgeAlertInStore(alertId: number): void {
  const alert = alertsStore.alerts.find((a) => a.id === alertId);
  if (alert && !alert.acknowledgedAt) {
    alert.acknowledgedAt = new Date().toISOString();
    alertsStore.unacknowledgedCount = Math.max(0, alertsStore.unacknowledgedCount - 1);
  }
}

export function acknowledgeAllAlertsInStore(): void {
  const now = new Date().toISOString();
  for (const alert of alertsStore.alerts) {
    if (!alert.acknowledgedAt) {
      alert.acknowledgedAt = now;
    }
  }
  alertsStore.unacknowledgedCount = 0;
}
