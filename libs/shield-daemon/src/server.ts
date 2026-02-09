/**
 * Fastify server setup for AgenShield daemon
 */

import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import type { DaemonConfig } from '@agenshield/ipc';
import { registerRoutes } from './routes/index';
import { getUiAssetsPath } from './static';
import { startSecurityWatcher, stopSecurityWatcher } from './watchers/security';
import { startSkillsWatcher, stopSkillsWatcher, ensureSkillWrappers } from './watchers/skills';
import { startProcessHealthWatcher, stopProcessHealthWatcher } from './watchers/process-health';
import { emitSkillUntrustedDetected, emitSkillApproved, emitProcessStarted, emitProcessStopped } from './events/emitter';
import { getVault, getInstallationKey } from './vault';
import { activateMCP, deactivateMCP } from './mcp';
import { getActivityLog } from './services/activity-log';
import { shutdownProxyPool } from './proxy/pool';

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
  await app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'] });

  // Register API routes
  await registerRoutes(app);

  // Serve static UI assets if available
  const uiPath = getUiAssetsPath();
  console.log(uiPath ? `UI assets: ${uiPath}` : 'UI assets: not found (API-only mode)');
  if (uiPath) {
    await app.register(fastifyStatic, {
      root: uiPath,
      prefix: '/',
    });

    // Fallback to index.html for SPA routing
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/sse') || request.url.startsWith('/rpc')) {
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
  const skillsDir = `${agentHome}/.openclaw/workspace/skills`;

  // Ensure skills directory exists with proper permissions before starting watcher
  const socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'ash_default';
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true, mode: 0o2775 });
    // Fix ownership — daemon runs as root but skills dir must be group-writable
    try {
      execSync(`chown -R root:${socketGroup} "${skillsDir}"`, { stdio: 'pipe' });
    } catch { /* best-effort — may not be root */ }
    console.log(`[Daemon] Created skills directory: ${skillsDir}`);
  } else {
    // Self-heal: fix permissions on existing skills directory
    try {
      const stat = fs.statSync(skillsDir);
      if ((stat.mode & 0o7777) !== 0o2775) {
        fs.chmodSync(skillsDir, 0o2775);
      }
    } catch { /* best-effort */ }
  }

  // Initialize installation key (generate if first run, cache for sync access in watcher)
  try {
    await getInstallationKey();
    console.log('[Daemon] Installation key ready');
  } catch (err) {
    console.warn('[Daemon] Failed to initialize installation key:', (err as Error).message);
  }

  startSkillsWatcher(skillsDir, {
    onUntrustedDetected: (info) => emitSkillUntrustedDetected(info.name, info.reason),
    onApproved: (name) => emitSkillApproved(name),
  }, 30000); // Check every 30 seconds

  // Ensure wrappers exist for all approved skills (covers reinstall/upgrade scenarios)
  ensureSkillWrappers().catch((err) => {
    console.warn('[Daemon] Failed to ensure skill wrappers:', (err as Error).message);
  });

  // Start persistent activity log
  const activityLog = getActivityLog();
  activityLog.start();

  // Self-heal command wrappers at boot
  try {
    const { loadConfig: loadDaemonConfig } = await import('./config/loader.js');
    const { loadState } = await import('./state/index.js');
    const { syncCommandPoliciesAndWrappers } = await import('./command-sync.js');
    const cfg = loadDaemonConfig();
    const st = loadState();
    syncCommandPoliciesAndWrappers(cfg.policies, st, app.log);
    app.log.info('[startup] boot-time command-sync completed');

    const { syncSecrets } = await import('./secret-sync.js');
    await syncSecrets(cfg.policies, app.log);
    app.log.info('[startup] boot-time secret-sync completed');
  } catch (err) {
    app.log.warn(`[startup] boot-time command-sync failed: ${(err as Error).message}`);
  }

  // Auto-activate MCP if valid tokens exist
  try {
    const vault = getVault();
    const agenco = await vault.get('agenco');
    if (agenco?.accessToken && agenco.expiresAt > Date.now()) {
      await activateMCP(config.port);
    }
  } catch {
    // Non-fatal: MCP auto-activation failed, user can connect later
  }

  // Sync AgenCo integration skills at boot
  try {
    const { syncAgenCoSkills } = await import('./services/integration-skills.js');
    const syncResult = await syncAgenCoSkills();
    if (syncResult.installed.length || syncResult.removed.length || syncResult.updated.length) {
      app.log.info(`[startup] AgenCo skill sync: installed=${syncResult.installed.length}, removed=${syncResult.removed.length}, updated=${syncResult.updated.length}`);
    }
  } catch (err) {
    app.log.warn(`[startup] AgenCo skill sync failed: ${(err as Error).message}`);
  }

  // Start process health watcher for broker/gateway lifecycle events
  await startProcessHealthWatcher(10000);

  // Stop watchers, proxy pool, and MCP on server close
  app.addHook('onClose', async () => {
    emitProcessStopped('daemon', { pid: process.pid });
    stopSecurityWatcher();
    stopSkillsWatcher();
    stopProcessHealthWatcher();
    activityLog.stop();
    shutdownProxyPool();
    await deactivateMCP();
  });

  // Normalize localhost to 127.0.0.1 to avoid IPv6 binding issues on macOS
  // (localhost resolves to ::1 on macOS, but clients often connect via 127.0.0.1)
  const listenHost = config.host === 'localhost' ? '127.0.0.1' : config.host;

  await app.listen({
    port: config.port,
    host: listenHost,
  });

  // Emit daemon started event after successful listen
  emitProcessStarted('daemon', { pid: process.pid });

  return app;
}
