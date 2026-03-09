/**
 * Daemon logger singleton — stores Fastify's Pino instance so non-route code
 * can use structured logging instead of console.log.
 */

import type { FastifyBaseLogger } from 'fastify';

let _logger: FastifyBaseLogger | null = null;

/** Set the daemon logger (called once after Fastify creation). */
export function setDaemonLogger(logger: FastifyBaseLogger): void {
  _logger = logger;
}

/** Get the daemon logger. Falls back to console-based shim if not yet set. */
export function getLogger(): FastifyBaseLogger {
  if (_logger) return _logger;

  // Minimal console-based shim for early startup (before Fastify is created)
  return {
    info: (...args: unknown[]) => console.log('[daemon]', ...args),
    warn: (...args: unknown[]) => console.warn('[daemon]', ...args),
    error: (...args: unknown[]) => console.error('[daemon]', ...args),
    debug: (...args: unknown[]) => console.debug('[daemon]', ...args),
    fatal: (...args: unknown[]) => console.error('[daemon:fatal]', ...args),
    trace: (...args: unknown[]) => console.debug('[daemon:trace]', ...args),
    child: () => getLogger(),
    silent: () => { /* noop */ },
    level: 'info',
  } as unknown as FastifyBaseLogger;
}
