/**
 * LaunchdExecutor — PrivilegeExecutor backed by the launchd-managed privilege helper.
 *
 * Connects to the well-known Unix socket at ~/.agenshield/run/privilege-helper.sock.
 * The helper process is managed by launchd (KeepAlive: true), so this executor
 * never launches or shuts down the helper — it only manages the local connection.
 *
 * Reuses the persistent connection + RPC multiplexing pattern from OsascriptExecutor.
 */

import * as fs from 'node:fs';
import * as net from 'node:net';
import { privilegeHelperSocket } from '@agenshield/ipc';
import type { PrivilegeExecutor, ExecResult, PrivilegeExecOptions } from './privilege-executor.js';

interface RpcResponse {
  id: number;
  result?: { success?: boolean; output?: string; ok?: boolean };
  error?: { code: number; message: string };
}

/** Notification message streamed mid-execution (no `id`, has `notify`). */
interface RpcNotification {
  notify: number;
  stream: 'stdout' | 'stderr';
  data: string;
}

interface PendingRequest {
  resolve: (value: RpcResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  onOutput?: (stream: 'stdout' | 'stderr', data: string) => void;
}

export class LaunchdExecutor implements PrivilegeExecutor {
  private nextId = 1;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // ── Persistent connection state ──────────────────────────────
  private connection: net.Socket | null = null;
  private pendingRequests = new Map<number, PendingRequest>();
  private buffer = '';
  /** Guard to prevent concurrent getConnection() races */
  private connectingPromise: Promise<net.Socket> | null = null;

  /**
   * Get or create a persistent socket connection to the privilege helper.
   * Deduplicates concurrent callers via connectingPromise.
   */
  private async getConnection(): Promise<net.Socket> {
    if (this.connection && !this.connection.destroyed) {
      return this.connection;
    }

    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = this.createConnection();
    try {
      const socket = await this.connectingPromise;
      return socket;
    } finally {
      this.connectingPromise = null;
    }
  }

  private async createConnection(): Promise<net.Socket> {
    const socketPath = privilegeHelperSocket();

    return new Promise<net.Socket>((resolve, reject) => {
      const socket = net.connect(socketPath);
      const CONNECT_TIMEOUT = 10_000;

      const connectTimer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Privilege helper connect timeout after ${CONNECT_TIMEOUT}ms`));
      }, CONNECT_TIMEOUT);

      socket.on('connect', () => {
        clearTimeout(connectTimer);
        this.connection = socket;
        this.buffer = '';
        resolve(socket);
      });

      socket.on('data', (data) => {
        this.processBuffer(data.toString());
      });

      socket.on('error', (err) => {
        clearTimeout(connectTimer);
        if (!this.connection || this.connection === socket) {
          this.rejectAll(new Error(`Privilege helper connection error: ${err.message}`));
          this.connection = null;
        }
        reject(new Error(`Privilege helper connection error: ${err.message}`));
      });

      socket.on('close', () => {
        if (this.connection === socket) {
          this.rejectAll(new Error('Privilege helper connection closed'));
          this.connection = null;
        }
      });
    });
  }

  /**
   * Parse newline-delimited JSON messages and dispatch to pending requests.
   * Handles both final responses (`id` field) and mid-execution notifications (`notify` field).
   */
  private processBuffer(chunk: string): void {
    this.buffer += chunk;

    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (!line.trim()) continue;

      try {
        const msg = JSON.parse(line);

        // Notification — streamed output chunk (no `id`, has `notify`)
        if ('notify' in msg) {
          const notification = msg as RpcNotification;
          const pending = this.pendingRequests.get(notification.notify);
          pending?.onOutput?.(notification.stream, notification.data);
          continue;
        }

        // Final response
        const response = msg as RpcResponse;
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(response.id);
          pending.resolve(response);
        }
      } catch {
        // Malformed message — skip
      }
    }
  }

  /**
   * Reject all pending requests (e.g. on connection drop).
   * Next rpc() call will auto-reconnect.
   */
  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
      pending.reject(error);
    }
  }

  /**
   * Send a JSON-RPC request over the persistent connection.
   */
  private async rpc(
    method: string,
    params?: Record<string, unknown>,
    onOutput?: (stream: 'stdout' | 'stderr', data: string) => void,
  ): Promise<RpcResponse> {
    const socket = await this.getConnection();
    const id = this.nextId++;

    const rpcParams = onOutput ? { ...params, stream: true } : params;

    return new Promise<RpcResponse>((resolve, reject) => {
      const timeout = (params?.timeout as number | undefined) ?? 300_000;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Privilege helper RPC timeout after ${timeout}ms`));
      }, timeout + 5000);

      this.pendingRequests.set(id, { resolve, reject, timer, onOutput });

      try {
        socket.write(JSON.stringify({ id, method, params: rpcParams }) + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        this.connection = null;
        reject(new Error(`Failed to write to privilege helper: ${(err as Error).message}`));
      }
    });
  }

  async execAsRoot(command: string, options?: PrivilegeExecOptions): Promise<ExecResult> {
    const res = await this.rpc('exec', { command, timeout: options?.timeout }, options?.onOutput);
    if (res.error) {
      return { success: false, output: (res.result?.output as string) ?? '', error: res.error.message };
    }
    return {
      success: res.result?.success ?? true,
      output: (res.result?.output as string) ?? '',
    };
  }

  async execAsUser(user: string, command: string, options?: PrivilegeExecOptions): Promise<ExecResult> {
    const res = await this.rpc('execAsUser', { user, command, timeout: options?.timeout }, options?.onOutput);
    if (res.error) {
      return { success: false, output: (res.result?.output as string) ?? '', error: res.error.message };
    }
    return {
      success: res.result?.success ?? true,
      output: (res.result?.output as string) ?? '',
    };
  }

  async execAsUserDirect(user: string, command: string, options?: PrivilegeExecOptions): Promise<ExecResult> {
    const res = await this.rpc('execAsUserDirect', { user, command, timeout: options?.timeout }, options?.onOutput);
    if (res.error) {
      return { success: false, output: (res.result?.output as string) ?? '', error: res.error.message };
    }
    return {
      success: res.result?.success ?? true,
      output: (res.result?.output as string) ?? '',
    };
  }

  async isAvailable(): Promise<boolean> {
    // First check if socket file exists
    const socketPath = privilegeHelperSocket();
    try {
      fs.accessSync(socketPath);
    } catch {
      return false;
    }

    // Then try to ping the helper
    try {
      const res = await this.rpc('ping');
      return !!res.result?.ok;
    } catch {
      return false;
    }
  }

  /**
   * Start a periodic heartbeat ping to keep the connection alive.
   */
  startHeartbeat(intervalMs = 30_000): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.rpc('ping');
      } catch {
        // Connection may have died — clear it so getConnection() reconnects
        this.connection = null;
      }
    }, intervalMs);
    if (this.heartbeatTimer && typeof this.heartbeatTimer === 'object' && 'unref' in this.heartbeatTimer) {
      this.heartbeatTimer.unref();
    }
  }

  /**
   * Stop the heartbeat timer.
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Shut down the local connection only.
   * Does NOT send a shutdown RPC — launchd manages the helper's lifecycle.
   */
  async shutdown(): Promise<void> {
    this.stopHeartbeat();
    this.rejectAll(new Error('Executor shutting down'));
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }
  }
}
