/**
 * Valtio proxy store for SSE events
 */

import { proxy } from 'valtio';

const MAX_EVENTS = 1000;

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

export function addEvent(event: SSEEvent) {
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
