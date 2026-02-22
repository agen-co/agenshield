/**
 * OsascriptExecutor — PrivilegeExecutor backed by the macOS privilege helper.
 *
 * Shows the native macOS password dialog on first use, then routes all
 * privileged commands through a Unix socket to a root helper process.
 */

import * as net from 'node:net';
import type { PrivilegeExecutor, ExecResult } from './privilege-executor.js';
import { launchPrivilegeHelper, type PrivilegeHelperHandle } from '../privilege-helper/index.js';

interface RpcResponse {
  id: number;
  result?: { success?: boolean; output?: string; ok?: boolean };
  error?: { code: number; message: string };
}

export class OsascriptExecutor implements PrivilegeExecutor {
  private handle: PrivilegeHelperHandle | null = null;
  private nextId = 1;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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
   * Send a JSON-RPC request to the helper and wait for a response.
   */
  private async rpc(method: string, params?: Record<string, unknown>): Promise<RpcResponse> {
    const handle = await this.ensureHelper();
    const id = this.nextId++;

    return new Promise<RpcResponse>((resolve, reject) => {
      const client = net.connect(handle.socketPath);
      let buffer = '';

      client.on('data', (data) => {
        buffer += data.toString();
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx);
          client.end();
          try {
            resolve(JSON.parse(line) as RpcResponse);
          } catch (err) {
            reject(new Error(`Failed to parse helper response: ${(err as Error).message}`));
          }
        }
      });

      client.on('error', (err) => {
        reject(new Error(`Privilege helper connection error: ${err.message}`));
      });

      client.on('connect', () => {
        client.write(JSON.stringify({ id, method, params }) + '\n');
      });

      // Timeout for the RPC call itself
      const timeout = (params?.timeout as number | undefined) ?? 300_000;
      setTimeout(() => {
        client.destroy();
        reject(new Error(`Privilege helper RPC timeout after ${timeout}ms`));
      }, timeout + 5000); // Extra 5s for RPC overhead
    });
  }

  async execAsRoot(command: string, options?: { timeout?: number }): Promise<ExecResult> {
    const res = await this.rpc('exec', { command, timeout: options?.timeout });
    if (res.error) {
      return { success: false, output: '', error: res.error.message };
    }
    return {
      success: res.result?.success ?? true,
      output: (res.result?.output as string) ?? '',
    };
  }

  async execAsUser(user: string, command: string, options?: { timeout?: number }): Promise<ExecResult> {
    const res = await this.rpc('execAsUser', { user, command, timeout: options?.timeout });
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
    if (this.handle) {
      await this.handle.cleanup();
      this.handle = null;
    }
  }
}
