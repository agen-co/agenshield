/**
 * Update server lifecycle
 *
 * Fastify server that wraps the UpdateEngine with HTTP endpoints,
 * serves the shield-ui SPA, and streams state changes via SSE.
 *
 * Auto-shuts down 5s after completion or 5min idle (no SSE connections).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import type { UpdateEngine } from '../update/engine.js';
import { setUpdateLogCallback } from '../update/engine.js';
import { registerRoutes } from './routes.js';
import { registerSSE, broadcastUpdateEvent, getActiveConnections, closeAllSSEConnections } from './sse.js';
import { getUiAssetsPath } from '../setup-server/static.js';

const IDLE_TIMEOUT = 5 * 60 * 1000;
const SHUTDOWN_DELAY = 5_000;
const IDLE_CHECK_INTERVAL = 30_000;

export interface UpdateServer {
  start(port: number): Promise<string>;
  stop(): Promise<void>;
  waitForCompletion(): Promise<void>;
}

export function createUpdateServer(engine: UpdateEngine): UpdateServer {
  let app: FastifyInstance | null = null;
  let completionResolve: (() => void) | null = null;
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  let lastActivity = Date.now();
  let isComplete = false;

  // Wire engine verbose logs to SSE broadcast
  setUpdateLogCallback((message, stepId) => {
    broadcastUpdateEvent('update:log', { message, stepId, timestamp: new Date().toISOString() });
  });

  // Wire engine state changes to SSE broadcast
  engine.onStateChange = (state) => {
    lastActivity = Date.now();

    broadcastUpdateEvent('update:state', { state });

    if (state.isComplete && !isComplete) {
      isComplete = true;
      setTimeout(() => {
        completionResolve?.();
      }, SHUTDOWN_DELAY);
    }

    if (state.hasError && !isComplete) {
      isComplete = true;
      setTimeout(() => {
        completionResolve?.();
      }, SHUTDOWN_DELAY);
    }
  };

  return {
    async start(port: number): Promise<string> {
      app = Fastify({ logger: false });

      // CORS
      await app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'] });

      // Request logging
      app.addHook('onResponse', (request, reply, done) => {
        if (!request.url.startsWith('/sse') && !request.url.includes('.') && !request.url.endsWith('/health')) {
          const ms = Math.round(reply.elapsedTime);
          const status = reply.statusCode;
          const color = status >= 400 ? '\x1b[31m' : status >= 300 ? '\x1b[33m' : '\x1b[32m';
          console.log(`${color}${request.method}\x1b[0m ${request.url} \x1b[2m${status} ${ms}ms\x1b[0m`);
        }
        done();
      });

      // Error handler
      app.setErrorHandler((error: { statusCode?: number; message: string }, request, reply) => {
        const status = error.statusCode ?? 500;
        console.error(`\x1b[31mERROR\x1b[0m ${request.method} ${request.url} \x1b[2m${status}\x1b[0m — ${error.message}`);
        reply.status(status).send({
          success: false,
          error: { message: error.message, statusCode: status },
        });
      });

      // API routes
      await registerRoutes(app, engine);

      // SSE endpoint
      await registerSSE(app);

      // Serve static UI assets
      const uiPath = getUiAssetsPath();
      if (uiPath) {
        await app.register(fastifyStatic, {
          root: uiPath,
          prefix: '/',
        });

        // SPA fallback
        app.setNotFoundHandler(async (request, reply) => {
          if (request.url.startsWith('/api') || request.url.startsWith('/sse') || request.url.startsWith('/rpc')) {
            return reply.code(404).send({ error: 'Not found' });
          }
          return reply.sendFile('index.html');
        });
      } else {
        app.setNotFoundHandler(async (_request, reply) => {
          return reply.code(404).send({
            error: 'UI assets not found. Build shield-ui first: npx nx build shield-ui',
          });
        });
      }

      // Idle-timeout checker
      idleTimer = setInterval(() => {
        const idleTime = Date.now() - lastActivity;
        const connections = getActiveConnections();
        if (connections === 0 && idleTime > IDLE_TIMEOUT) {
          console.log('Update server idle timeout — shutting down');
          completionResolve?.();
        }
      }, IDLE_CHECK_INTERVAL);

      await app.listen({ port, host: '127.0.0.1' });

      const url = `http://localhost:${port}`;
      return url;
    },

    async stop(): Promise<void> {
      setUpdateLogCallback(undefined);
      if (idleTimer) {
        clearInterval(idleTimer);
        idleTimer = null;
      }
      closeAllSSEConnections();
      if (app) {
        await app.close();
        app = null;
      }
    },

    waitForCompletion(): Promise<void> {
      return new Promise((resolve) => {
        completionResolve = resolve;
      });
    },
  };
}
