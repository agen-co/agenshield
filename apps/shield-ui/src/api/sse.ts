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
    'security:warning',
    'security:critical',
    'security:alert',
    'broker:request',
    'broker:response',
    'config:changed',
    'exec:monitored',
    'exec:denied',
    'skills:quarantined',
    'skills:approved',
    'skills:analyzed',
    'skills:analysis_failed',
    'skills:installed',
    'skills:install_failed',
    'skills:install_started',
    'skills:install_progress',
    'skills:untrusted_detected',
    'skills:uninstalled',
    'wrappers:installed',
    'wrappers:uninstalled',
    'wrappers:updated',
    'wrappers:custom_added',
    'wrappers:custom_removed',
    'wrappers:synced',
    'wrappers:regenerated',
    'agenco:connected',
    'agenco:disconnected',
    'agenco:auth_required',
    'agenco:auth_completed',
    'agenco:tool_executed',
    'agenco:error',
    'process:started',
    'process:stopped',
    'process:broker_started',
    'process:broker_stopped',
    'process:broker_restarted',
    'process:gateway_started',
    'process:gateway_stopped',
    'process:gateway_restarted',
    'process:daemon_started',
    'process:daemon_stopped',
    'interceptor:event',
    'daemon:status',
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
