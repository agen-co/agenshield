/**
 * Setup mode middleware
 *
 * Reads the `setup_completed` flag from SQLite on every request
 * to determine whether the daemon is in setup or daemon mode.
 */

import type { FastifyInstance } from 'fastify';
import { loadState } from '../state';

export type DaemonMode = 'setup' | 'daemon';

// Fastify request type augmentation
declare module 'fastify' {
  interface FastifyRequest {
    daemonMode: DaemonMode;
  }
}

/**
 * Determine the current daemon mode from SQLite state.
 */
export function getDaemonMode(): DaemonMode {
  const state = loadState();
  if (!state.setup?.completed) return 'setup';
  return 'daemon';
}

/**
 * Register the daemon mode middleware.
 * Decorates every request with `daemonMode` based on DB state.
 */
export function registerSetupModeMiddleware(app: FastifyInstance): void {
  app.decorateRequest('daemonMode', null as unknown as DaemonMode);

  app.addHook('onRequest', (request, _reply, done) => {
    request.daemonMode = getDaemonMode();
    done();
  });
}
