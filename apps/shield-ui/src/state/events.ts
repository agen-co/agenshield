/**
 * Valtio proxy store for SSE events
 */

import { proxy } from 'valtio';
import type { EventType } from '@agenshield/ipc';

const MAX_EVENTS = 10_000;

export interface SSEEvent {
  id: string;
  type: EventType | (string & {});
  data: Record<string, unknown>;
  timestamp: number;
}

export const eventStore = proxy({
  events: [] as SSEEvent[],
  connected: false,
});

const IGNORED_PATHS = ['/api/config'];

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

export function setEvents(historical: SSEEvent[]) {
  // Merge: keep existing SSE events (newer), append historical that aren't duplicates
  const existing = new Set(
    eventStore.events.map((e) => `${e.type}:${e.timestamp}`),
  );
  const toAdd = historical.filter(
    (e) => !existing.has(`${e.type}:${e.timestamp}`),
  );
  eventStore.events.push(...toAdd);
  // Sort newest first
  eventStore.events.sort((a, b) => b.timestamp - a.timestamp);
  if (eventStore.events.length > MAX_EVENTS) {
    eventStore.events.splice(MAX_EVENTS);
  }
}

export function clearEvents() {
  eventStore.events.splice(0);
}
