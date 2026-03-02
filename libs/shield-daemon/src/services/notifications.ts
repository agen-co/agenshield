/**
 * Daemon Fallback Notifications
 *
 * When no SSE clients are connected (i.e. neither the menu bar app nor the
 * web dashboard is open), the daemon falls back to native macOS notifications
 * via `osascript` for critical security events.
 *
 * This ensures the user is alerted even when the menu bar app isn't installed.
 */

import { execSync } from 'node:child_process';
import { daemonEvents, type DaemonEvent } from '../events/emitter';

// ─── Critical event types that trigger native notifications ─────────────────

const CRITICAL_EVENT_TYPES = new Set([
  'security:critical',
  'security:locked',
  'enforcement:process_killed',
  'skills:quarantined',
  'skills:untrusted_detected',
  'security:config_tampered',
]);

// ─── Rate limiting ──────────────────────────────────────────────────────────

/** Minimum interval between notifications of the same event type (ms). */
const RATE_LIMIT_MS = 10_000;
const lastNotified = new Map<string, number>();

function isRateLimited(eventType: string): boolean {
  const last = lastNotified.get(eventType);
  if (!last) return false;
  return Date.now() - last < RATE_LIMIT_MS;
}

function markNotified(eventType: string): void {
  lastNotified.set(eventType, Date.now());
}

// ─── Event → notification text ──────────────────────────────────────────────

function notificationTitle(event: DaemonEvent): string {
  switch (event.type) {
    case 'security:critical':
      return 'Security Alert';
    case 'security:locked':
      return 'Security Locked';
    case 'enforcement:process_killed':
      return 'Process Killed';
    case 'skills:quarantined':
      return 'Skill Quarantined';
    case 'skills:untrusted_detected':
      return 'Untrusted Skill Detected';
    case 'security:config_tampered':
      return 'Config Tamper Detected';
    default:
      return 'AgenShield Alert';
  }
}

function notificationBody(event: DaemonEvent): string {
  const data = event.data as Record<string, unknown> | undefined;
  switch (event.type) {
    case 'security:critical':
      return (data?.message as string) ?? 'A critical security event occurred.';
    case 'security:locked':
      return `Reason: ${(data?.reason as string) ?? 'unknown'}`;
    case 'enforcement:process_killed':
      return `Process "${(data?.name as string) ?? (data?.command as string) ?? 'unknown'}" was killed by policy enforcement.`;
    case 'skills:quarantined':
      return `Skill "${(data?.name as string) ?? 'unknown'}" was quarantined: ${(data?.reason as string) ?? ''}`;
    case 'skills:untrusted_detected':
      return `Untrusted skill "${(data?.name as string) ?? 'unknown'}" detected: ${(data?.reason as string) ?? ''}`;
    case 'security:config_tampered':
      return 'Configuration integrity check failed. Deny-all policy enforced.';
    default:
      return JSON.stringify(data ?? {});
  }
}

// ─── osascript notification ─────────────────────────────────────────────────

function sendNativeNotification(title: string, body: string): void {
  const escaped = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `display notification "${escaped(body)}" with title "${escaped(title)}" sound name "Funk"`;
  try {
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      stdio: 'pipe',
      timeout: 5_000,
    });
  } catch {
    // osascript may fail in headless / SSH sessions — ignore
  }
}

// ─── Service lifecycle ──────────────────────────────────────────────────────

let unsubscribe: (() => void) | null = null;

/**
 * Start the fallback notification service.
 * Subscribes to daemon events and sends native macOS notifications
 * for critical events when no SSE clients are connected.
 */
export function startFallbackNotifications(): void {
  if (process.platform !== 'darwin') return;
  if (unsubscribe) return; // already running

  unsubscribe = daemonEvents.subscribe((event: DaemonEvent) => {
    if (!CRITICAL_EVENT_TYPES.has(event.type)) return;
    if (daemonEvents.sseClientCount > 0) return;
    if (isRateLimited(event.type)) return;

    markNotified(event.type);
    sendNativeNotification(
      notificationTitle(event),
      notificationBody(event),
    );
  });
}

/**
 * Stop the fallback notification service.
 */
export function stopFallbackNotifications(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  lastNotified.clear();
}
