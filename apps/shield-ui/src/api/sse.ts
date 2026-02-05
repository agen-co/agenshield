/**
 * SSE client with automatic reconnection
 */

const SSE_URL = '/sse/events';
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;

export type SSEEventHandler = (type: string, data: Record<string, unknown>) => void;

export interface SSEClient {
  connect: () => void;
  disconnect: () => void;
  isConnected: () => boolean;
}

export function createSSEClient(
  onEvent: SSEEventHandler,
  onConnectionChange: (connected: boolean) => void,
  token?: string | null,
): SSEClient {
  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = RECONNECT_DELAY;
  let intentionalClose = false;

  const eventTypes = [
    'api:request',
    'api:outbound',
    'security:status',
    'broker:request',
    'config:changed',
    'security:alert',
    'broker:response',
    'skills:quarantined',
    'skills:approved',
    'exec:monitored',
    'exec:denied',
    'agentlink:connected',
    'agentlink:disconnected',
    'agentlink:auth_required',
    'agentlink:auth_completed',
    'agentlink:tool_executed',
    'agentlink:error',
  ];

  function connect() {
    intentionalClose = false;
    cleanup();

    try {
      const url = token ? `${SSE_URL}?token=${encodeURIComponent(token)}` : SSE_URL;
      eventSource = new EventSource(url);

      eventSource.onopen = () => {
        reconnectDelay = RECONNECT_DELAY;
        onConnectionChange(true);
      };

      eventSource.onerror = () => {
        onConnectionChange(false);
        cleanup();
        if (!intentionalClose) {
          scheduleReconnect();
        }
      };

      for (const type of eventTypes) {
        eventSource.addEventListener(type, (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            onEvent(type, data);
          } catch {
            // ignore parse errors
          }
        });
      }

      // Also listen for generic messages
      eventSource.onmessage = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          onEvent('message', data);
        } catch {
          // ignore
        }
      };
    } catch {
      onConnectionChange(false);
      scheduleReconnect();
    }
  }

  function cleanup() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
      connect();
    }, reconnectDelay);
  }

  function disconnect() {
    intentionalClose = true;
    cleanup();
    onConnectionChange(false);
  }

  function isConnected() {
    return eventSource?.readyState === EventSource.OPEN;
  }

  return { connect, disconnect, isConnected };
}
