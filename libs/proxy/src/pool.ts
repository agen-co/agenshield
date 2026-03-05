/**
 * ProxyPool — manages per-run proxy instances for seatbelt-wrapped commands.
 *
 * Each exec'd command that needs network access gets its own localhost proxy.
 * The proxy enforces URL policies while the seatbelt profile restricts the child
 * to only connect to localhost (preventing direct network bypass).
 *
 * Decoupled from daemon internals — uses ProxyPoolHooks for event callbacks.
 */

import type { PolicyConfig } from '@agenshield/ipc';
import { createPerRunProxy } from './server';
import { ProxyBindError } from './errors';
import type { ProxyInstance, ProxyPoolOptions, ProxyPoolHooks } from './types';

export class ProxyPool {
  private proxies = new Map<string, ProxyInstance>();
  private maxConcurrent: number;
  private idleTimeoutMs: number;
  private hooks: ProxyPoolHooks;

  constructor(options: ProxyPoolOptions = {}, hooks: ProxyPoolHooks = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 50;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60 * 1000;
    this.hooks = hooks;
  }

  private log(msg: string): void {
    (this.hooks.logger ?? console.log)(msg);
  }

  /**
   * Acquire a per-run proxy for a command execution.
   * Returns the localhost port the child should use as its proxy.
   */
  async acquire(
    execId: string,
    command: string,
    getPolicies: () => PolicyConfig[],
    getDefaultAction: () => 'allow' | 'deny',
    callbacks?: {
      onBlock?: (method: string, target: string, protocol: 'http' | 'https') => void;
      onAllow?: (method: string, target: string, protocol: 'http' | 'https') => void;
    },
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
        this.log(`[proxy-pool] evicting oldest proxy (exec_id=${oldest.execId}) to make room`);
        this.release(oldest.execId);
      }
    }

    const onActivity = () => {
      const inst = this.proxies.get(execId);
      if (inst) {
        inst.lastActivity = Date.now();
        clearTimeout(inst.idleTimer);
        inst.idleTimer = setTimeout(() => {
          this.log(`[proxy-pool] idle timeout, releasing port ${inst.port} (exec_id=${execId})`);
          this.release(execId);
        }, this.idleTimeoutMs);
      }
    };

    const logger = (msg: string) => {
      this.log(`[proxy:${execId.slice(0, 8)}] ${msg}`);
    };

    const onBlock = (method: string, target: string, protocol: 'http' | 'https') => {
      this.hooks.onBlock?.(execId, method, target, protocol);
      callbacks?.onBlock?.(method, target, protocol);
    };

    const onAllow = (method: string, target: string, protocol: 'http' | 'https') => {
      this.hooks.onAllow?.(execId, method, target, protocol);
      callbacks?.onAllow?.(method, target, protocol);
    };

    const server = createPerRunProxy({
      getPolicies,
      getDefaultAction,
      onActivity,
      logger,
      onBlock,
      onAllow,
      tls: this.hooks.tls,
    });

    // Listen on port 0 — OS picks a free port
    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          resolve(addr.port);
        } else {
          reject(new ProxyBindError());
        }
      });
      server.on('error', (err) => reject(new ProxyBindError(err.message)));
    });

    const idleTimer = setTimeout(() => {
      this.log(`[proxy-pool] idle timeout, releasing port ${port} (exec_id=${execId})`);
      this.release(execId);
    }, this.idleTimeoutMs);

    this.proxies.set(execId, {
      execId,
      command,
      port,
      server,
      lastActivity: Date.now(),
      idleTimer,
    });

    this.log(`[proxy-pool] acquired port ${port} for exec_id=${execId.slice(0, 8)} command=${command.slice(0, 60)}`);

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
    this.log(`[proxy-pool] released port ${inst.port} (exec_id=${execId.slice(0, 8)})`);

    this.hooks.onRelease?.(execId);
  }

  /**
   * Shut down all active proxies.
   */
  shutdown(): void {
    for (const [execId, inst] of this.proxies) {
      clearTimeout(inst.idleTimer);
      inst.server.close();
      this.log(`[proxy-pool] shutdown: closed port ${inst.port} (exec_id=${execId.slice(0, 8)})`);
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
