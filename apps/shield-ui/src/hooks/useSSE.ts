/**
 * Hook to connect to SSE events and update the valtio event store
 */

import { useEffect, useRef } from 'react';
import { useSnapshot } from 'valtio';
import { eventStore, addEvent, setConnected, type SSEEvent } from '../state/events';
import { createSSEClient, type SSEClient } from '../api/sse';

export function useSSE() {
  const { connected } = useSnapshot(eventStore);
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
  }, []);

  return { connected };
}
