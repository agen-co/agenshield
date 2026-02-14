/**
 * Pure event classification logic for dot animations and activity panel categorization.
 */

import type { SSEEvent } from '../../../state/events';
import { BLOCKED_EVENT_TYPES } from '../../../utils/eventDisplay';

export type FirewallPiece = 'network' | 'system' | 'filesystem';
export type EventCategory = 'filesystem' | 'network' | 'bash';

const NETWORK_OPERATIONS = new Set(['http_request', 'open_url']);
const SYSTEM_OPERATIONS = new Set(['exec', 'command_execute']);
const FILESYSTEM_OPERATIONS = new Set(['file_read', 'file_write', 'file_list']);

/**
 * Maps an SSE event to the firewall piece it should flow through.
 * Returns null if the event doesn't map to any firewall piece.
 */
export function classifyEventToFirewall(event: SSEEvent): FirewallPiece | null {
  if (event.type === 'api:outbound') return 'network';
  if (event.type === 'exec:denied' || event.type === 'exec:monitored') return 'system';

  if (event.type === 'interceptor:event') {
    const d = event.data as Record<string, unknown>;
    const operation = String(d.operation ?? '');
    if (NETWORK_OPERATIONS.has(operation)) return 'network';
    if (SYSTEM_OPERATIONS.has(operation)) return 'system';
    if (FILESYSTEM_OPERATIONS.has(operation)) return 'filesystem';
  }

  return null;
}

/**
 * Categorizes an event for the activity panel "By Type" tab.
 * Returns null if the event doesn't fit any category.
 */
export function classifyEventCategory(event: SSEEvent): EventCategory | null {
  if (event.type === 'api:outbound') return 'network';
  if (event.type === 'exec:denied' || event.type === 'exec:monitored') return 'bash';

  if (event.type === 'interceptor:event') {
    const d = event.data as Record<string, unknown>;
    const operation = String(d.operation ?? '');
    if (NETWORK_OPERATIONS.has(operation)) return 'network';
    if (SYSTEM_OPERATIONS.has(operation)) return 'bash';
    if (FILESYSTEM_OPERATIONS.has(operation)) return 'filesystem';
  }

  return null;
}

/** Returns true if the event represents a denied/blocked action */
export function isEventDenied(event: SSEEvent): boolean {
  if (BLOCKED_EVENT_TYPES.has(event.type)) return true;
  if (event.type === 'interceptor:event') {
    const d = event.data as Record<string, unknown>;
    const dtype = String(d.type ?? '');
    return dtype === 'denied' || dtype === 'deny';
  }
  return false;
}

/** Returns true if the event should appear in the alerts section (critical/warning/blocked) */
export function isAlertEvent(event: SSEEvent): boolean {
  if (BLOCKED_EVENT_TYPES.has(event.type)) return true;
  if (
    event.type === 'security:warning' ||
    event.type === 'security:critical' ||
    event.type === 'security:alert'
  ) return true;
  if (event.type === 'interceptor:event') {
    const d = event.data as Record<string, unknown>;
    const dtype = String(d.type ?? '');
    return dtype === 'denied' || dtype === 'deny';
  }
  return false;
}
