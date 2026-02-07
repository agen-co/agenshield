/**
 * Centralized notification store (singleton).
 *
 * Manages a queue of toast-style notifications displayed at the bottom-right.
 * Components push notifications via `notify.*()` helpers. The UI component
 * consumes via `useSnapshot(notificationStore)`.
 *
 * Usage:
 *   import { notify } from '../stores/notifications';
 *   notify.error('Installation failed');
 *   notify.success('Skill installed', { action: { label: 'View', onClick: () => navigate('/skills/x') } });
 */

import { proxy } from 'valtio';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type NotificationSeverity = 'success' | 'error' | 'warning' | 'info';

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface Notification {
  id: string;
  message: string;
  severity: NotificationSeverity;
  duration: number; // ms, 0 = persistent
  action?: NotificationAction;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export interface NotificationStore {
  notifications: Notification[];
}

export const notificationStore = proxy<NotificationStore>({
  notifications: [],
});

/* ------------------------------------------------------------------ */
/*  Internal                                                           */
/* ------------------------------------------------------------------ */

let nextId = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const DEFAULT_DURATION: Record<NotificationSeverity, number> = {
  success: 4000,
  info: 5000,
  warning: 6000,
  error: 8000,
};

function addNotification(
  message: string,
  severity: NotificationSeverity,
  options?: { duration?: number; action?: NotificationAction },
): string {
  const id = `notif-${++nextId}`;
  const duration = options?.duration ?? DEFAULT_DURATION[severity];

  notificationStore.notifications.push({
    id,
    message,
    severity,
    duration,
    action: options?.action,
    createdAt: Date.now(),
  });

  if (duration > 0) {
    const timer = setTimeout(() => {
      dismiss(id);
    }, duration);
    timers.set(id, timer);
  }

  return id;
}

/* ------------------------------------------------------------------ */
/*  Actions                                                            */
/* ------------------------------------------------------------------ */

export function dismiss(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const idx = notificationStore.notifications.findIndex((n) => n.id === id);
  if (idx !== -1) {
    notificationStore.notifications.splice(idx, 1);
  }
}

export function clearAll(): void {
  for (const timer of timers.values()) {
    clearTimeout(timer);
  }
  timers.clear();
  notificationStore.notifications.splice(0);
}

/* ------------------------------------------------------------------ */
/*  Public API (singleton)                                             */
/* ------------------------------------------------------------------ */

export const notify = {
  success: (message: string, options?: { duration?: number; action?: NotificationAction }) =>
    addNotification(message, 'success', options),

  error: (message: string, options?: { duration?: number; action?: NotificationAction }) =>
    addNotification(message, 'error', options),

  warning: (message: string, options?: { duration?: number; action?: NotificationAction }) =>
    addNotification(message, 'warning', options),

  info: (message: string, options?: { duration?: number; action?: NotificationAction }) =>
    addNotification(message, 'info', options),

  dismiss,
  clearAll,
};
