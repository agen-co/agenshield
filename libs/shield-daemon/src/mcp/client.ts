/**
 * MCP Client with SSE transport
 *
 * Connects to Frontegg's MCP gateway using Server-Sent Events for
 * real-time communication and standard HTTP POST for JSON-RPC requests.
 * Zero npm dependencies — uses built-in fetch() and ReadableStream parsing.
 */

export type MCPConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface MCPClientConfig {
  /** MCP gateway URL, e.g. https://mcp.marketplace.frontegg.com/mcp */
  gatewayUrl: string;
  /** Async function that returns a valid access token */
  getAccessToken: () => Promise<string>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  integration?: string;
}

export interface MCPToolResult {
  content: Array<{ type: string; text?: string; data?: unknown }>;
  isError?: boolean;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT = 30_000;
const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_RECONNECT_DELAY = 1_000;

export class MCPClient {
  private config: MCPClientConfig;
  private state: MCPConnectionState = 'disconnected';
  private abortController: AbortController | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;

  /** Called when the connection state changes */
  onStateChange?: (state: MCPConnectionState) => void;
  /** Called when a server notification is received */
  onNotification?: (method: string, params: unknown) => void;

  constructor(config: MCPClientConfig) {
    this.config = config;
  }

  /** Connect to the MCP gateway via SSE */
  async activate(): Promise<void> {
    if (this.active) return;
    this.active = true;
    await this.connectSSE();
  }

  /** Disconnect from the MCP gateway */
  async deactivate(): Promise<void> {
    this.active = false;
    this.clearReconnectTimer();
    this.disconnectSSE();
    this.rejectAllPending('Client deactivated');
    this.setState('disconnected');
  }

  /** Whether the client has been activated */
  isActive(): boolean {
    return this.active;
  }

  /** Current connection state */
  getState(): MCPConnectionState {
    return this.state;
  }

  /** List all available tools from the MCP gateway */
  async listTools(): Promise<MCPTool[]> {
    const result = await this.sendRequest('tools/list', {});
    const tools = (result as { tools?: MCPTool[] })?.tools || [];
    return tools;
  }

  /** Call a tool on the MCP gateway */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const result = await this.sendRequest('tools/call', { name, arguments: args });
    return result as MCPToolResult;
  }

  // ─── Internal SSE connection ─────────────────────────────────────────────

  private async connectSSE(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'connected') return;
    this.setState('connecting');

    try {
      const token = await this.config.getAccessToken();
      this.abortController = new AbortController();

      const response = await fetch(this.config.gatewayUrl, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token might be stale — let caller handle re-auth
          this.setState('error');
          return;
        }
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('SSE response has no body');
      }

      this.setState('connected');
      this.reconnectDelay = INITIAL_RECONNECT_DELAY;

      // Process the SSE stream
      this.processSSEStream(response.body).catch(() => {
        // Stream ended or errored
        if (this.active) {
          this.setState('disconnected');
          this.scheduleReconnect();
        }
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      this.setState('error');
      if (this.active) {
        this.scheduleReconnect();
      }
    }
  }

  private async processSSEStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            eventData += line.slice(6);
          } else if (line === '') {
            // End of event
            if (eventData) {
              this.handleSSEEvent(eventType, eventData);
            }
            eventType = '';
            eventData = '';
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private handleSSEEvent(eventType: string, data: string): void {
    try {
      const parsed = JSON.parse(data);

      if (eventType === 'message' || eventType === '') {
        // JSON-RPC response to a pending request
        const id = parsed.id as string | undefined;
        if (id && this.pendingRequests.has(id)) {
          const pending = this.pendingRequests.get(id)!;
          this.pendingRequests.delete(id);
          clearTimeout(pending.timer);

          if (parsed.error) {
            pending.reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          } else {
            pending.resolve(parsed.result);
          }
          return;
        }
      }

      // Server notification
      if (parsed.method && !parsed.id) {
        this.onNotification?.(parsed.method, parsed.params);
      }
    } catch {
      // Ignore non-JSON SSE events (heartbeats etc.)
    }
  }

  // ─── JSON-RPC request via HTTP POST ──────────────────────────────────────

  private async sendRequest(method: string, params: unknown): Promise<unknown> {
    // If not connected via SSE, do a direct HTTP POST
    const id = String(++this.requestCounter);
    const token = await this.config.getAccessToken();

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    const response = await fetch(this.config.gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body,
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Authentication required');
      }
      const text = await response.text();
      throw new Error(`MCP request failed (${response.status}): ${text}`);
    }

    const result = (await response.json()) as { result?: unknown; error?: { message?: string; code?: number } };

    if (result.error) {
      throw new Error(result.error.message || `MCP error ${result.error.code}`);
    }

    return result.result;
  }

  // ─── Reconnection ───────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectSSE();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private disconnectSSE(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private setState(newState: MCPConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.onStateChange?.(newState);
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingRequests.delete(id);
    }
  }
}
