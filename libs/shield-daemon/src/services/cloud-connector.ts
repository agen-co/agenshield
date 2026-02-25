/**
 * Cloud connector service
 *
 * Manages the connection from the local AgenShield daemon to AgenShield Cloud.
 * Uses WebSocket with Ed25519 AgentSig authentication, falling back to HTTP polling.
 *
 * Auth primitives (AgentSig header, credential loading) come from @agenshield/auth.
 */

import {
  createAgentSigHeader,
  loadCloudCredentials,
} from '@agenshield/auth';
import type { CloudCredentials } from '@agenshield/auth';
import type { PolicyConfig } from '@agenshield/ipc';
import { PolicyConfigSchema } from '@agenshield/ipc';
import { getStorage } from '@agenshield/storage';
import { getLogger } from '../logger';
import { getPolicyManager } from './policy-manager';
import { triggerProcessEnforcement } from './process-enforcer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CloudCommand {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Cloud Connector
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL = 30_000;
const RECONNECT_DELAY = 10_000;
const POLL_INTERVAL = 30_000;

export class CloudConnector {
  private credentials: CloudCredentials | null = null;
  private ws: import('ws').WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private connected = false;
  private stopped = false;
  private lastCommandFetch: string | undefined;

  /**
   * Try to connect to AgenShield Cloud.
   * No-ops if credentials don't exist.
   */
  async connect(): Promise<void> {
    this.stopped = false;
    this.credentials = loadCloudCredentials();

    if (!this.credentials) {
      return;
    }

    const log = getLogger();
    log.info(`[cloud] Connecting to ${this.credentials.cloudUrl} as agent ${this.credentials.agentId}`);

    try {
      await this.connectWebSocket();
    } catch {
      log.warn('[cloud] WebSocket connection failed, falling back to HTTP polling');
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
   * Whether the daemon is currently connected to cloud.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the enrolled company name (or undefined if not enrolled).
   */
  getCompanyName(): string | undefined {
    return this.credentials?.companyName;
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

        const log = getLogger();
        log.info('[cloud] WebSocket connected');
        resolve();

        // Pull policies after connecting
        this.pullPolicies().catch(() => { /* best effort */ });
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
          const log = getLogger();
          log.warn('[cloud] WebSocket disconnected, reconnecting...');
          this.scheduleReconnect();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(connectionTimeout);
        const log = getLogger();
        log.warn(`[cloud] WebSocket error: ${err.message}`);
        reject(err);
      });
    });
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as { jsonrpc: string; id?: string; method: string; params?: Record<string, unknown> };

      const log = getLogger();
      log.debug(`[cloud] Received command: ${msg.method}`);

      this.handleCommand({
        id: msg.id ?? '',
        method: msg.method,
        params: msg.params ?? {},
      });
    } catch {
      const log = getLogger();
      log.warn('[cloud] Invalid message received');
    }
  }

  private handleCommand(command: CloudCommand): void {
    const log = getLogger();

    switch (command.method) {
      case 'push_policy':
        log.info(`[cloud] Received policy push: ${JSON.stringify(command.params).slice(0, 200)}`);
        this.applyPolicyPush(command.params);
        break;

      case 'update_config':
        log.info('[cloud] Received config update');
        // TODO: Apply config update
        break;

      case 'ping':
        // Respond to server ping
        if (this.ws?.readyState === 1) { // WebSocket.OPEN
          this.ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'pong', params: {} }));
        }
        break;

      default:
        log.debug(`[cloud] Unknown command: ${command.method}`);
    }

    // Send acknowledgement
    if (command.id && this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'command_ack',
        params: { commandId: command.id },
      }));
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

    const log = getLogger();
    log.info('[cloud] Starting HTTP polling fallback');

    this.connected = true; // Consider polling as "connected"

    this.pollTimer = setInterval(async () => {
      if (this.stopped) return;
      await this.pollCommands();
    }, POLL_INTERVAL);

    // Initial poll + pull policies
    this.pollCommands();
    this.pullPolicies().catch(() => { /* best effort */ });
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
        this.handleCommand(cmd);

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

  /**
   * Create a fresh AgentSig authorization header using @agenshield/auth.
   */
  private makeAuthHeader(): string {
    if (!this.credentials) return '';
    return createAgentSigHeader(this.credentials.agentId, this.credentials.privateKey);
  }

  // ─── Policy push ─────────────────────────────────────────────

  /**
   * Apply a push_policy command: replace managed policies from a source, then recompile + enforce.
   */
  private applyPolicyPush(params: Record<string, unknown>): void {
    const log = getLogger();
    const source = (params.source as string) ?? 'cloud';
    const rawPolicies = params.policies;

    if (!Array.isArray(rawPolicies)) {
      log.warn('[cloud] push_policy: missing or invalid policies array');
      return;
    }

    try {
      const storage = getStorage();
      const policyRepo = storage.policies;

      // Delete existing managed policies from this source
      policyRepo.deleteManagedBySource(source);

      // Insert new managed policies
      let count = 0;
      for (const raw of rawPolicies) {
        try {
          const parsed = PolicyConfigSchema.parse(raw);
          policyRepo.createManaged(parsed, source);
          count++;
        } catch (err) {
          log.warn({ err, policy: raw }, '[cloud] Skipping invalid policy in push');
        }
      }

      // Recompile the policy engine
      const policyManager = getPolicyManager();
      policyManager.recompile();

      log.info(`[cloud] Applied ${count} managed policies from source "${source}"`);

      // Trigger immediate process enforcement scan
      triggerProcessEnforcement();
    } catch (err) {
      log.error({ err }, '[cloud] Failed to apply policy push');
    }
  }

  /**
   * Pull policies from cloud after connecting.
   * Called after WebSocket connect and after first HTTP poll.
   */
  async pullPolicies(): Promise<void> {
    if (!this.credentials) return;

    const log = getLogger();
    try {
      const url = new URL(
        `/api/agents/${this.credentials.agentId}/policies`,
        this.credentials.cloudUrl,
      );

      const authHeader = this.makeAuthHeader();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(url.toString(), {
        headers: { Authorization: authHeader },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        log.warn(`[cloud] Failed to pull policies: ${res.status}`);
        return;
      }

      const body = await res.json() as { source?: string; policies?: PolicyConfig[] };
      if (body.policies && Array.isArray(body.policies)) {
        this.applyPolicyPush({
          source: body.source ?? 'cloud',
          policies: body.policies,
        });
        log.info(`[cloud] Pulled ${body.policies.length} policies from cloud`);
      }
    } catch (err) {
      log.debug({ err }, '[cloud] Failed to pull policies');
    }
  }
}

// Singleton
let cloudConnector: CloudConnector | null = null;

export function getCloudConnector(): CloudConnector {
  if (!cloudConnector) {
    cloudConnector = new CloudConnector();
  }
  return cloudConnector;
}
