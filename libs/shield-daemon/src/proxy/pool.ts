/**
 * ProxyPool — manages per-run proxy instances for seatbelt-wrapped commands.
 *
 * Each exec'd command that needs network access gets its own localhost proxy.
 * The proxy enforces URL policies while the seatbelt profile restricts the child
 * to only connect to localhost (preventing direct network bypass).
 *
 * Exported as a singleton so rpc.ts can acquire proxies during policy_check.
 */

import * as http from 'node:http';
import type { PolicyConfig } from '@agenshield/ipc';
import { createPerRunProxy } from './server';
import { emitInterceptorEvent } from '../events/emitter';

interface ProxyInstance {
  execId: string;
  command: string;
  port: number;
  server: http.Server;
  urlPolicies: PolicyConfig[];
  lastActivity: number;
  idleTimer: NodeJS.Timeout;
}

export interface ProxyPoolOptions {
  maxConcurrent?: number;
  idleTimeoutMs?: number;
}

export class ProxyPool {
  private proxies = new Map<string, ProxyInstance>();
  private maxConcurrent: number;
  private idleTimeoutMs: number;

  constructor(options: ProxyPoolOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 50;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60 * 1000;
  }

  /**
   * Acquire a per-run proxy for a command execution.
   * Returns the localhost port the child should use as its proxy.
   */
  async acquire(
    execId: string,
    command: string,
    urlPolicies: PolicyConfig[]
  ): Promise<{ port: number }> {
    if (this.proxies.size >= this.maxConcurrent) {
      // Evict the oldest idle proxy
      let oldest: ProxyInstance | undefined;
      for (const inst of this.proxies.values()) {
        if (!oldest || inst.lastActivity < oldest.lastActivity) {
          oldest = inst;
        }
      }
      if (oldest) {
        console.log(`[proxy-pool] evicting oldest proxy (exec_id=${oldest.execId}) to make room`);
        this.release(oldest.execId);
      }
    }

    const onActivity = () => {
      const inst = this.proxies.get(execId);
      if (inst) {
        inst.lastActivity = Date.now();
        // Reset idle timer
        clearTimeout(inst.idleTimer);
        inst.idleTimer = setTimeout(() => {
          console.log(`[proxy-pool] idle timeout, releasing port ${inst.port} (exec_id=${execId})`);
          this.release(execId);
        }, this.idleTimeoutMs);
      }
    };

    const logger = (msg: string) => {
      console.log(`[proxy:${execId.slice(0, 8)}] ${msg}`);
    };

    const onBlock = (method: string, target: string, protocol: 'http' | 'https') => {
      emitInterceptorEvent({
        type: 'denied',
        operation: 'http_request',
        target: protocol === 'https' ? `https://${target}` : target,
        timestamp: new Date().toISOString(),
        error: `Blocked by URL policy (${method})`,
      });
    };

    const server = createPerRunProxy(urlPolicies, onActivity, logger, onBlock);

    // Listen on port 0 — OS picks a free port
    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          resolve(addr.port);
        } else {
          reject(new Error('Failed to bind proxy server'));
        }
      });
      server.on('error', reject);
    });

    const idleTimer = setTimeout(() => {
      console.log(`[proxy-pool] idle timeout, releasing port ${port} (exec_id=${execId})`);
      this.release(execId);
    }, this.idleTimeoutMs);

    this.proxies.set(execId, {
      execId,
      command,
      port,
      server,
      urlPolicies,
      lastActivity: Date.now(),
      idleTimer,
    });

    console.log(`[proxy-pool] acquired port ${port} for exec_id=${execId.slice(0, 8)} command=${command.slice(0, 60)}`);

    return { port };
  }

  /**
   * Release a proxy by execution ID.
   */
  release(execId: string): void {
    const inst = this.proxies.get(execId);
    if (!inst) return;

    clearTimeout(inst.idleTimer);
    inst.server.close();
    this.proxies.delete(execId);
    console.log(`[proxy-pool] released port ${inst.port} (exec_id=${execId.slice(0, 8)})`);
  }

  /**
   * Shut down all active proxies. Called on daemon close.
   */
  shutdown(): void {
    for (const [execId, inst] of this.proxies) {
      clearTimeout(inst.idleTimer);
      inst.server.close();
      console.log(`[proxy-pool] shutdown: closed port ${inst.port} (exec_id=${execId.slice(0, 8)})`);
    }
    this.proxies.clear();
  }

  /**
   * Number of active proxies.
   */
  get size(): number {
    return this.proxies.size;
  }
}

// Module-level singleton — initialized lazily by getProxyPool()
let _pool: ProxyPool | undefined;

export function getProxyPool(): ProxyPool {
  if (!_pool) {
    _pool = new ProxyPool();
  }
  return _pool;
}

export function shutdownProxyPool(): void {
  if (_pool) {
    _pool.shutdown();
    _pool = undefined;
  }
}
