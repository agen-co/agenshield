/**
 * Valtio proxy store for SSE events
 */

import { proxy } from 'valtio';

const MAX_EVENTS = 10_000;

export interface SSEEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export const eventStore = proxy({
  events: [] as SSEEvent[],
  connected: false,
});

const IGNORED_PATHS = ['/api/status', '/api/config'];

export function addEvent(event: SSEEvent) {
  const url = event.data?.url as string | undefined;
  if (url && IGNORED_PATHS.some((p) => url.includes(p))) return;

  eventStore.events.unshift(event);
  if (eventStore.events.length > MAX_EVENTS) {
    eventStore.events.splice(MAX_EVENTS);
  }
}

export function setConnected(connected: boolean) {
  eventStore.connected = connected;
}

export function clearEvents() {
  eventStore.events.splice(0);
}
