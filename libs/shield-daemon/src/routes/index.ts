/**
 * Route registration
 */

import type { FastifyInstance } from 'fastify';
import { API_PREFIX } from '@agenshield/ipc';
import { healthRoutes } from './health';
import { statusRoutes } from './status';
import { configRoutes } from './config';
import { securityRoutes } from './security';
import { sseRoutes } from './sse';
import { wrappersRoutes } from './wrappers';
import { agentlinkRoutes } from './agentlink';
import { skillsRoutes } from './skills';
import { execRoutes } from './exec';
import { authRoutes } from './auth';
import { emitApiRequest } from '../events/emitter';
import { createAuthHook } from '../auth/middleware';

/**
 * Register all API routes under the /api prefix
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Register SSE routes at root level (not under /api)
  await app.register(sseRoutes);

  // Add request logging hook for API traffic events
  app.addHook('onResponse', (request, reply, done) => {
    // Skip SSE and static file requests
    if (!request.url.startsWith('/sse') && !request.url.includes('.')) {
      const duration = reply.elapsedTime;
      emitApiRequest(request.method, request.url, reply.statusCode, Math.round(duration));
    }
    done();
  });

  await app.register(
    async (api) => {
      // Add auth hook to protect routes
      api.addHook('preHandler', createAuthHook());

      await api.register(healthRoutes);
      await api.register(statusRoutes);
      await api.register(configRoutes);
      await api.register(securityRoutes);
      await api.register(wrappersRoutes);
      await api.register(agentlinkRoutes);
      await api.register(skillsRoutes);
      await api.register(execRoutes);
      await api.register(authRoutes);
    },
    { prefix: API_PREFIX }
  );
}
