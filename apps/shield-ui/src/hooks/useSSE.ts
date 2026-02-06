/**
 * Hook to connect to SSE events and update the valtio event store
 */

import { useEffect, useRef } from 'react';
import { useSnapshot } from 'valtio';
import { eventStore, addEvent, setConnected, setEvents, type SSEEvent } from '../state/events';
import { createSSEClient, type SSEClient } from '../api/sse';
import { api } from '../api/client';

export function useSSE(enabled = true, token?: string | null) {
  const { connected } = useSnapshot(eventStore);
  const clientRef = useRef<SSEClient | null>(null);
  const historyLoaded = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    historyLoaded.current = false;

    const client = createSSEClient(
      (type, data) => {
        const event: SSEEvent = {
          id: crypto.randomUUID(),
          type,
          data,
          timestamp: Date.now(),
        };
        addEvent(event);
      },
      (isConnected) => {
        setConnected(isConnected);
        // Load history once on first successful connection
        if (isConnected && !historyLoaded.current) {
          historyLoaded.current = true;
          api.getActivity().then((res) => {
            const historical: SSEEvent[] = res.data.map((e) => ({
              id: crypto.randomUUID(),
              type: e.type,
              data: (e.data ?? {}) as Record<string, unknown>,
              timestamp: new Date(e.timestamp).getTime(),
            }));
            setEvents(historical);
          }).catch(() => {
            // Non-fatal: history load failed, SSE events still work
          });
        }
      },
      token,
    );

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [enabled, token]);

  return { connected };
}
