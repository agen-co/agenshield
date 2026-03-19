/**
 * CloudClient — transport layer
 *
 * Manages the WebSocket/HTTP connection from the local AgenShield daemon to
 * AgenShield Cloud. Handles auth headers, heartbeat, reconnect, and HTTP
 * polling fallback. Business logic (what to DO with commands) is provided
 * by the caller via setCommandHandler().
 */

import { createAgentSigHeader } from './auth';
import { loadCloudCredentials } from './credentials';
import type {
  CloudCredentials,
  CloudCommand,
  CloudCommandHandler,
  CloudClientOptions,
  CloudLogger,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL = 30_000;
const RECONNECT_DELAY = 10_000;
const POLL_INTERVAL = 30_000;

// ---------------------------------------------------------------------------
// Noop logger
// ---------------------------------------------------------------------------

const noopLogger: CloudLogger = {
  info() { /* noop */ },
  warn() { /* noop */ },
  error() { /* noop */ },
  debug() { /* noop */ },
};

// ---------------------------------------------------------------------------
// CloudClient
// ---------------------------------------------------------------------------

export class CloudClient {
  private credentials: CloudCredentials | null = null;
  private ws: import('ws').WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private connected = false;
  private stopped = false;
  private lastCommandFetch: string | undefined;
  private commandHandler: CloudCommandHandler | null = null;
  private onConnectHandler: (() => Promise<void>) | null = null;
  private logger: CloudLogger;

  constructor(options?: CloudClientOptions) {
    this.logger = options?.logger ?? noopLogger;
  }

  /**
   * Register a handler for incoming cloud commands.
   */
  setCommandHandler(handler: CloudCommandHandler): void {
    this.commandHandler = handler;
  }

  /**
   * Register a handler called after successful connection.
   */
  setOnConnect(handler: () => Promise<void>): void {
    this.onConnectHandler = handler;
  }

  /**
   * Set credentials directly (e.g. from SQLite storage).
   * If set before connect(), the file-based lookup is skipped.
   */
  setCredentials(creds: CloudCredentials): void {
    this.credentials = creds;
  }

  /**
   * Try to connect to AgenShield Cloud.
   * No-ops if credentials don't exist.
   */
  async connect(): Promise<void> {
    this.stopped = false;
    if (!this.credentials) {
      this.credentials = loadCloudCredentials();
    }

    if (!this.credentials) {
      return;
    }

    this.logger.info(`[cloud] Connecting to ${this.credentials.cloudUrl} as agent ${this.credentials.agentId}`);

    try {
      await this.connectWebSocket();
    } catch {
      this.logger.warn('[cloud] WebSocket connection failed, falling back to HTTP polling');
      this.startPolling();
    }
  }

  /**
   * Disconnect from AgenShield Cloud.
   */
  disconnect(): void {
    this.stopped = true;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, 'Daemon shutting down');
      } catch { /* ignore */ }
      this.ws = null;
    }

    this.connected = false;
  }

  /**
   * Whether the client is currently connected to cloud.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the current cloud credentials (or null if not enrolled).
   */
  getCredentials(): CloudCredentials | null {
    return this.credentials;
  }

  /**
   * Make an authenticated GET request to the cloud API.
   */
  async agentGet<T>(path: string, timeoutMs = 10_000): Promise<T> {
    if (!this.credentials) {
      throw new Error('Not connected to cloud');
    }

    const url = new URL(
      `/api/agents/${this.credentials.agentId}${path}`,
      this.credentials.cloudUrl,
    );

    const authHeader = this.makeAuthHeader();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: authHeader },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} GET ${path}`);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Make an authenticated POST request to the cloud API (agent-scoped).
   * URL: {cloudUrl}/api/agents/{agentId}{path}
   */
  async agentPost<T>(path: string, body: unknown, timeoutMs = 10_000): Promise<T> {
    if (!this.credentials) {
      throw new Error('Not connected to cloud');
    }

    const url = `${this.credentials.cloudUrl}/api/agents/${this.credentials.agentId}${path}`;
    return this._post<T>(url, path, body, timeoutMs);
  }

  /**
   * Make an authenticated POST request to a non-agent-scoped cloud endpoint.
   * URL: {cloudUrl}/api{path}
   */
  async post<T>(path: string, body: unknown, timeoutMs = 10_000): Promise<T> {
    if (!this.credentials) {
      throw new Error('Not connected to cloud');
    }

    const url = `${this.credentials.cloudUrl}/api${path}`;
    return this._post<T>(url, path, body, timeoutMs);
  }

  private async _post<T>(url: string, path: string, body: unknown, timeoutMs: number): Promise<T> {
    const authHeader = this.makeAuthHeader();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} POST ${path}`);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── WebSocket connection ──────────────────────────────────

  private async connectWebSocket(): Promise<void> {
    if (!this.credentials || this.stopped) return;

    const { WebSocket } = await import('ws');

    const wsUrl = this.credentials.cloudUrl
      .replace(/^https:/, 'wss:')
      .replace(/^http:/, 'ws:');

    const authHeader = this.makeAuthHeader();

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${wsUrl}/ws/agents`, {
        headers: { Authorization: authHeader },
      });

      const connectionTimeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timed out'));
      }, 10_000);

      ws.on('open', () => {
        clearTimeout(connectionTimeout);
        this.ws = ws;
        this.connected = true;
        this.startHeartbeat();

        this.logger.info('[cloud] WebSocket connected');
        resolve();

        // Notify caller of successful connection
        if (this.onConnectHandler) {
          this.onConnectHandler().catch((err) => {
            this.logger.warn(`[cloud] onConnect handler failed: ${(err as Error).message}`);
          });
        }
      });

      ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      ws.on('close', () => {
        clearTimeout(connectionTimeout);
        this.connected = false;
        this.ws = null;
        this.stopHeartbeat();

        if (!this.stopped) {
          this.logger.warn('[cloud] WebSocket disconnected, reconnecting...');
          this.scheduleReconnect();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(connectionTimeout);
        this.logger.warn(`[cloud] WebSocket error: ${err.message}`);
        reject(err);
      });
    });
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as { jsonrpc: string; id?: string; method: string; params?: Record<string, unknown> };

      this.logger.debug(`[cloud] Received command: ${msg.method}`);

      const command: CloudCommand = {
        id: msg.id ?? '',
        method: msg.method,
        params: msg.params ?? {},
      };

      if (this.commandHandler) {
        this.commandHandler(command).catch(err => {
          this.logger.error(`[cloud] Error handling command: ${(err as Error).message}`);
        });
      }

      // Send acknowledgement
      if (command.id && this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'command_ack',
          params: { commandId: command.id },
        }));
      }

      // Respond to server ping
      if (command.method === 'ping' && this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'pong', params: {} }));
      }
    } catch {
      this.logger.warn('[cloud] Invalid message received');
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === 1) {
        this.ws.ping();
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.stopped) return;

      try {
        await this.connectWebSocket();
      } catch {
        // Fall back to polling if WS keeps failing
        this.startPolling();
      }
    }, RECONNECT_DELAY);
  }

  // ─── HTTP polling fallback ─────────────────────────────────

  private startPolling(): void {
    if (this.stopped || this.pollTimer) return;

    this.logger.info('[cloud] Starting HTTP polling fallback');

    this.connected = true; // Consider polling as "connected"

    this.pollTimer = setInterval(async () => {
      if (this.stopped) return;
      await this.pollCommands();
    }, POLL_INTERVAL);

    // Initial poll + notify onConnect
    this.pollCommands();
    if (this.onConnectHandler) {
      this.onConnectHandler().catch((err) => {
        this.logger.warn(`[cloud] onConnect handler failed (polling): ${(err as Error).message}`);
      });
    }
  }

  private async pollCommands(): Promise<void> {
    if (!this.credentials) return;

    try {
      const url = new URL(
        `/api/agents/${this.credentials.agentId}/commands`,
        this.credentials.cloudUrl,
      );
      if (this.lastCommandFetch) {
        url.searchParams.set('since', this.lastCommandFetch);
      }

      const authHeader = this.makeAuthHeader();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(url.toString(), {
        headers: { Authorization: authHeader },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) return;

      const commands = (await res.json()) as CloudCommand[];
      this.lastCommandFetch = new Date().toISOString();

      for (const cmd of commands) {
        if (this.commandHandler) {
          await this.commandHandler(cmd);
        }

        // Acknowledge via HTTP
        try {
          await fetch(
            `${this.credentials.cloudUrl}/api/agents/${this.credentials.agentId}/ack`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: authHeader,
              },
              body: JSON.stringify({ commandId: cmd.id }),
            },
          );
        } catch { /* best effort */ }
      }
    } catch {
      // Polling failed — will retry next interval
    }
  }

  // ─── Authentication ────────────────────────────────────────

  private makeAuthHeader(): string {
    if (!this.credentials) return '';
    return createAgentSigHeader(this.credentials.agentId, this.credentials.privateKey);
  }
}
