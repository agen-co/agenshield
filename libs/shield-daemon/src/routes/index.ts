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
import { agencoRoutes } from './agenco';
import { skillsRoutes } from './skills';
import { execRoutes } from './exec';
import { discoveryRoutes } from './discovery';
import { authRoutes } from './auth';
import { secretsRoutes } from './secrets';
import { marketplaceRoutes } from './marketplace';
import { fsRoutes } from './fs';
import { activityRoutes } from './activity';
import { openclawRoutes } from './openclaw';
import { profileRoutes } from './targets';
import { policyGraphRoutes } from './policy-graph';
import { rpcRoutes } from './rpc';
import { emitApiRequest } from '../events/emitter';
import { createAuthHook } from '../auth/middleware';
import { getSessionManager } from '../auth/session';
import { registerShieldContext } from '../context';

/**
 * Register all API routes under the /api prefix
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Register context extraction before all routes
  registerShieldContext(app);

  // Touch idle auto-lock timer on every non-SSE API request
  app.addHook('onRequest', (request, _reply, done) => {
    if (!request.url.startsWith('/sse')) {
      getSessionManager().touchActivity();
    }
    done();
  });

  // Register SSE routes at root level (not under /api)
  await app.register(sseRoutes);

  // Register RPC routes at root level (interceptor calls, no auth)
  await app.register(rpcRoutes);

  // Capture response payload on the request for logging
  app.addHook('onSend', (request, _reply, payload, done) => {
    // Store payload on request for the onResponse hook (skip large/streaming responses)
    if (typeof payload === 'string' && payload.length < 4000) {
      (request as unknown as Record<string, unknown>).__responsePayload = payload;
    }
    done(null, payload);
  });

  // Add request logging hook for API traffic events
  app.addHook('onResponse', (request, reply, done) => {
    // Skip SSE, RPC, static file requests, and noisy health polls
    if (!request.url.startsWith('/sse') && !request.url.startsWith('/rpc') && !request.url.includes('.') && !request.url.endsWith('/health')) {
      // Skip successful status polls — too noisy
      if (request.method === 'GET' && (request.url.startsWith('/api/status') || request.url.startsWith('/api/activity')) && reply.statusCode === 200) {
        done();
        return;
      }

      const duration = reply.elapsedTime;
      const ms = Math.round(duration);
      const status = reply.statusCode;
      const color = status >= 400 ? '\x1b[31m' : status >= 300 ? '\x1b[33m' : '\x1b[32m';
      const traceId = request.shieldContext?.traceId ?? '-';
      console.log(`${color}${request.method}\x1b[0m ${request.url} \x1b[2m${status} ${ms}ms [${traceId}]\x1b[0m`);

      // Include request/response bodies for non-GET, non-auth routes
      const isAuthRoute = request.url.includes('/auth/');
      const includeBody = request.method !== 'GET' && !isAuthRoute;

      if (includeBody) {
        const requestBody = request.body as unknown;
        const responsePayload = (request as unknown as Record<string, unknown>).__responsePayload as string | undefined;
        let responseBody: unknown;
        if (responsePayload) {
          try {
            responseBody = JSON.parse(responsePayload);
          } catch {
            responseBody = undefined;
          }
        }
        emitApiRequest(request.method, request.url, status, ms, requestBody, responseBody);
      } else {
        emitApiRequest(request.method, request.url, status, ms);
      }
    }
    done();
  });

  // Error handler — log details and send structured response
  app.setErrorHandler((error: { statusCode?: number; message: string }, request, reply) => {
    const status = error.statusCode ?? 500;
    request.log.error({ err: error, statusCode: status }, `${request.method} ${request.url} — ${error.message}`);
    reply.status(status).send({
      success: false,
      error: { message: error.message, statusCode: status },
    });
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
      await api.register(agencoRoutes);
      await api.register(skillsRoutes);
      await api.register(execRoutes);
      await api.register(discoveryRoutes);
      await api.register(authRoutes);
      await api.register(secretsRoutes);
      await api.register(marketplaceRoutes);
      await api.register(fsRoutes);
      await api.register(activityRoutes);
      await api.register(openclawRoutes);
      await api.register(profileRoutes);
      await api.register(policyGraphRoutes);
    },
    { prefix: API_PREFIX }
  );
}
