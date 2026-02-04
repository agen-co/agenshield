/**
 * Zustand store for SSE events
 */

import { create } from 'zustand';

const MAX_EVENTS = 1000;

export interface SSEEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

interface EventStore {
  events: SSEEvent[];
  connected: boolean;
  addEvent: (event: SSEEvent) => void;
  setConnected: (connected: boolean) => void;
  clear: () => void;
}

export const useEventStore = create<EventStore>((set) => ({
  events: [],
  connected: false,

  addEvent: (event) =>
    set((state) => ({
      events: [event, ...state.events].slice(0, MAX_EVENTS),
    })),

  setConnected: (connected) => set({ connected }),

  clear: () => set({ events: [] }),
}));
