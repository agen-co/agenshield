/**
 * Fastify server setup for AgenShield daemon
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import type { DaemonConfig } from '@agenshield/ipc';
import { registerRoutes } from './routes/index';
import { getUiAssetsPath } from './static';
import { startSecurityWatcher, stopSecurityWatcher } from './watchers/security';
import { startSkillsWatcher, stopSkillsWatcher } from './watchers/skills';
import { emitSkillQuarantined, emitSkillApproved } from './events/emitter';

/**
 * Create and configure the Fastify server
 * @param config Daemon configuration
 * @returns Configured Fastify instance
 */
export async function createServer(config: DaemonConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  // Enable CORS for development
  await app.register(cors, { origin: true });

  // Register API routes
  await registerRoutes(app);

  // Serve static UI assets if available
  const uiPath = getUiAssetsPath();
  if (uiPath) {
    await app.register(fastifyStatic, {
      root: uiPath,
      prefix: '/',
      decorateReply: false,
    });

    // Fallback to index.html for SPA routing
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/sse')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

/**
 * Start the server
 * @param config Daemon configuration
 * @returns The running Fastify instance
 */
export async function startServer(config: DaemonConfig): Promise<FastifyInstance> {
  const app = await createServer(config);

  // Start security watcher for real-time monitoring
  startSecurityWatcher(10000); // Check every 10 seconds

  // Start skills watcher for quarantine enforcement
  // Default skills dir: agent home is derived from config or uses fallback
  const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
  const skillsDir = `${agentHome}/.openclaw/skills`;
  startSkillsWatcher(skillsDir, {
    onQuarantined: (info) => emitSkillQuarantined(info.name, info.reason),
    onApproved: (name) => emitSkillApproved(name),
  }, 30000); // Check every 30 seconds

  // Stop watchers on server close
  app.addHook('onClose', async () => {
    stopSecurityWatcher();
    stopSkillsWatcher();
  });

  await app.listen({
    port: config.port,
    host: config.host,
  });

  return app;
}
