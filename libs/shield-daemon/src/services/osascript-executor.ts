/**
 * OsascriptExecutor — PrivilegeExecutor backed by the macOS privilege helper.
 *
 * Shows the native macOS password dialog on first use, then routes all
 * privileged commands through a Unix socket to a root helper process.
 *
 * Uses a **persistent connection** with request multiplexing to avoid
 * the overhead of creating a new socket per command (~44+ during shield).
 * Auto-reconnects on connection drop.
 */

import * as net from 'node:net';
import type { PrivilegeExecutor, ExecResult } from './privilege-executor.js';
import { launchPrivilegeHelper, type PrivilegeHelperHandle } from '../privilege-helper/index.js';

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

export class OsascriptExecutor implements PrivilegeExecutor {
  private handle: PrivilegeHelperHandle | null = null;
  private nextId = 1;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // ── Persistent connection state ──────────────────────────────
  private connection: net.Socket | null = null;
  private pendingRequests = new Map<number, PendingRequest>();
  private buffer = '';
  /** Guard to prevent concurrent getConnection() races */
  private connectingPromise: Promise<net.Socket> | null = null;

  /**
   * Lazily launch the privilege helper on first exec call.
   */
  private async ensureHelper(): Promise<PrivilegeHelperHandle> {
    if (!this.handle) {
      this.handle = await launchPrivilegeHelper({ timeout: 60_000 });
    }
    return this.handle;
  }

  /**
   * Get or create a persistent socket connection.
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
    const handle = await this.ensureHelper();

    return new Promise<net.Socket>((resolve, reject) => {
      const socket = net.connect(handle.socketPath);
      const CONNECT_TIMEOUT = 10_000;

      const connectTimer = setTimeout(() => {
        socket.destroy();
        this.handle = null; // force re-launch on next call
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
        // If we're still connecting, reject the promise
        if (!this.connection || this.connection === socket) {
          this.rejectAll(new Error(`Privilege helper connection error: ${err.message}`));
          this.connection = null;
          this.handle = null; // force re-launch on next call
        }
        reject(new Error(`Privilege helper connection error: ${err.message}`));
      });

      socket.on('close', () => {
        if (this.connection === socket) {
          this.rejectAll(new Error('Privilege helper connection closed'));
          this.connection = null;
          this.handle = null; // force re-launch on next call
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
   * When `onOutput` is provided, the helper is asked to stream notifications
   * and the callback is invoked for each output chunk received.
   */
  private async rpc(
    method: string,
    params?: Record<string, unknown>,
    onOutput?: (stream: 'stdout' | 'stderr', data: string) => void,
  ): Promise<RpcResponse> {
    const socket = await this.getConnection();
    const id = this.nextId++;

    // Ask the helper to stream notifications when we have an output callback
    const rpcParams = onOutput ? { ...params, stream: true } : params;

    return new Promise<RpcResponse>((resolve, reject) => {
      const timeout = (params?.timeout as number | undefined) ?? 300_000;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Privilege helper RPC timeout after ${timeout}ms`));
      }, timeout + 5000); // Extra 5s for RPC overhead

      this.pendingRequests.set(id, { resolve, reject, timer, onOutput });

      try {
        socket.write(JSON.stringify({ id, method, params: rpcParams }) + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        // Connection may have died between getConnection() and write — clear it
        this.connection = null;
        reject(new Error(`Failed to write to privilege helper: ${(err as Error).message}`));
      }
    });
  }

  async execAsRoot(command: string, options?: { timeout?: number; onOutput?: (stream: 'stdout' | 'stderr', data: string) => void }): Promise<ExecResult> {
    const res = await this.rpc('exec', { command, timeout: options?.timeout }, options?.onOutput);
    if (res.error) {
      return { success: false, output: '', error: res.error.message };
    }
    return {
      success: res.result?.success ?? true,
      output: (res.result?.output as string) ?? '',
    };
  }

  async execAsUser(user: string, command: string, options?: { timeout?: number; onOutput?: (stream: 'stdout' | 'stderr', data: string) => void }): Promise<ExecResult> {
    const res = await this.rpc('execAsUser', { user, command, timeout: options?.timeout }, options?.onOutput);
    if (res.error) {
      return { success: false, output: '', error: res.error.message };
    }
    return {
      success: res.result?.success ?? true,
      output: (res.result?.output as string) ?? '',
    };
  }

  async execAsUserDirect(user: string, command: string, options?: { timeout?: number; onOutput?: (stream: 'stdout' | 'stderr', data: string) => void }): Promise<ExecResult> {
    const res = await this.rpc('execAsUserDirect', { user, command, timeout: options?.timeout }, options?.onOutput);
    if (res.error) {
      return { success: false, output: '', error: res.error.message };
    }
    return {
      success: res.result?.success ?? true,
      output: (res.result?.output as string) ?? '',
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.handle) return false;
    try {
      const res = await this.rpc('ping');
      return !!res.result?.ok;
    } catch {
      return false;
    }
  }

  /**
   * Start a periodic heartbeat ping to keep the privilege helper alive.
   * Call this when the executor should persist for the daemon's lifetime.
   */
  startHeartbeat(intervalMs = 30_000): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.rpc('ping');
      } catch {
        // Helper may have died — clear handle so ensureHelper relaunches
        this.handle = null;
        this.connection = null;
      }
    }, intervalMs);
    // Don't prevent process exit
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

  async shutdown(): Promise<void> {
    this.stopHeartbeat();
    this.rejectAll(new Error('Executor shutting down'));
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }
    if (this.handle) {
      await this.handle.cleanup();
      this.handle = null;
    }
  }
}
