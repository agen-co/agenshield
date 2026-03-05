/**
 * ProxyPool adapter — wraps @agenshield/proxy's ProxyPool with daemon-specific hooks.
 *
 * Wires pool events to the daemon's event emitter, trace store, and logger.
 * Preserves the getProxyPool() / shutdownProxyPool() singleton API.
 */

import { ProxyPool } from '@agenshield/proxy';
import type { ProxyPoolHooks } from '@agenshield/proxy';
import { emitInterceptorEvent, emitEvent } from '../events/emitter';
import { getTraceStore } from '../services/trace-store';
import { getLogger } from '../logger';
import { loadConfig } from '../config/loader';

export type { ProxyPoolOptions } from '@agenshield/proxy';
export { ProxyPool } from '@agenshield/proxy';

function createDaemonHooks(tlsRejectUnauthorized?: boolean): ProxyPoolHooks {
  return {
    tls: {
      rejectUnauthorized: tlsRejectUnauthorized ?? true,
    },

    onBlock(execId, method, target, protocol) {
      emitInterceptorEvent({
        type: 'denied',
        operation: 'http_request',
        target: protocol === 'https' ? `https://${target}` : target,
        timestamp: new Date().toISOString(),
        error: `Blocked by URL policy (${method})`,
      });
    },

    onRelease(execId) {
      try {
        const traceStore = getTraceStore();
        const trace = traceStore.get(execId);
        if (trace) {
          traceStore.complete(trace.traceId);
          const children = traceStore.getByParent(trace.traceId);
          emitEvent('trace:completed', {
            traceId: trace.traceId,
            durationMs: Date.now() - trace.startedAt,
            childCount: children.length,
          }, trace.profileId);
        }
      } catch {
        // Trace store may not be available — ignore
      }
    },

    logger(msg) {
      getLogger().info(msg);
    },
  };
}

// Module-level singleton — initialized lazily by getProxyPool()
let _pool: ProxyPool | undefined;

export function getProxyPool(): ProxyPool {
  if (!_pool) {
    const config = loadConfig();
    _pool = new ProxyPool({}, createDaemonHooks(config.daemon.proxyTlsRejectUnauthorized));
  }
  return _pool;
}

export function shutdownProxyPool(): void {
  if (_pool) {
    _pool.shutdown();
    _pool = undefined;
  }
}
