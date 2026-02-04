/**
 * Hook to connect to SSE events and update the event store
 */

import { useEffect, useRef } from 'react';
import { useEventStore, type SSEEvent } from '../state/events';
import { createSSEClient, type SSEClient } from '../api/sse';

export function useSSE() {
  const addEvent = useEventStore((s) => s.addEvent);
  const setConnected = useEventStore((s) => s.setConnected);
  const connected = useEventStore((s) => s.connected);
  const clientRef = useRef<SSEClient | null>(null);

  useEffect(() => {
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
      },
    );

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [addEvent, setConnected]);

  return { connected };
}
