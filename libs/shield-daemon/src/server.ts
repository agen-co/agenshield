/**
 * Fastify server setup for AgenShield daemon
 */

// Fastify type augmentations live in context/request-context.ts
import './context/request-context';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import type { DaemonConfig } from '@agenshield/ipc';
import { initStorage } from '@agenshield/storage';
import { SkillManager } from '@agentshield/skills';
import { registerRoutes } from './routes/index';
import { getUiAssetsPath } from './static';
import { startSecurityWatcher, stopSecurityWatcher } from './watchers/security';
import { startProcessHealthWatcher, stopProcessHealthWatcher } from './watchers/process-health';
import { emitSkillUntrustedDetected, emitProcessStarted, emitProcessStopped, eventBus, daemonEvents } from './events/emitter';
import { getVault, getInstallationKey } from './vault';
import { activateMCP, deactivateMCP } from './mcp';
import { getActivityLog } from './services/activity-log';
import { shutdownProxyPool } from './proxy/pool';
import { getConfigDir, getQuarantineDir, getSkillBackupDir, isDevMode } from './config/paths';
import { DaemonDeployAdapter } from './adapters/daemon-deploy-adapter';
import { migrateSkillsToSqlite } from './migration/skill-migration';
import {
  MCPSkillSource,
  createAgenCoConnection,
  RemoteSkillSource,
} from './adapters';

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

  // Derive paths
  const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
  const skillsDir = path.resolve(`${agentHome}/.openclaw/workspace/skills`);
  const socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'ash_default';

  const devMode = isDevMode();

  // Ensure skills directory exists with proper permissions
  if (!fs.existsSync(skillsDir)) {
    if (devMode) {
      fs.mkdirSync(skillsDir, { recursive: true });
    } else {
      fs.mkdirSync(skillsDir, { recursive: true, mode: 0o2775 });
      try {
        execSync(`chown -R root:${socketGroup} "${skillsDir}"`, { stdio: 'pipe' });
      } catch { /* best-effort — may not be root */ }
    }
    console.log(`[Daemon] Created skills directory: ${skillsDir}`);
  } else if (!devMode) {
    try {
      const stat = fs.statSync(skillsDir);
      if ((stat.mode & 0o7777) !== 0o2775) {
        fs.chmodSync(skillsDir, 0o2775);
      }
    } catch { /* best-effort */ }
  }

  if (devMode) {
    console.log(`[Daemon] Running in DEV MODE — agentHome=${agentHome}, skillsDir=${skillsDir}`);
  }

  // Initialize installation key (generate if first run, cache for sync access in watcher)
  try {
    await getInstallationKey();
    console.log('[Daemon] Installation key ready');
  } catch (err) {
    console.warn('[Daemon] Failed to initialize installation key:', (err as Error).message);
  }

  // ─── Initialize SQLite storage ───────────────────────────────
  const dbPath = path.join(getConfigDir(), 'agenshield.db');
  const storage = initStorage(dbPath);
  console.log(`[Daemon] Storage initialized: ${dbPath}`);

  // ─── Run one-time JSON → SQLite migration ────────────────────
  migrateSkillsToSqlite(storage, skillsDir);

  // ─── Ensure quarantine directory exists ─────────────────────
  const quarantineDir = getQuarantineDir();
  if (!fs.existsSync(quarantineDir)) {
    fs.mkdirSync(quarantineDir, { recursive: true });
  }

  // ─── Ensure skill backup directory exists ──────────────────
  const backupDir = getSkillBackupDir();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // ─── Initialize SkillManager (new SQLite-backed) ─────────────
  const deployAdapter = new DaemonDeployAdapter({
    skillsDir,
    agentHome,
    socketGroup,
    binDir: path.join(agentHome, 'bin'),
    devMode,
  });

  const skillManager = new SkillManager(storage, {
    deployers: [deployAdapter],
    watcher: { pollIntervalMs: 30000, skillsDir, quarantineDir },
    autoStartWatcher: true,
    eventBus,
    backupDir,
  });

  // Wire watcher scan callbacks to emit daemon events
  skillManager.watcher.setScanCallbacks({
    onQuarantined: (slug, reason) => emitSkillUntrustedDetected(slug, reason),
  });

  // Forward watcher events from SkillManager to daemonEvents (SSE + ActivityLog).
  // The EventBus already receives these via _bridgeToEventBus; posting directly to
  // daemonEvents.broadcast (not the broadcast() helper) avoids double EventBus emission.
  skillManager.on('skill-event', (event: import('@agentshield/skills').SkillEvent) => {
    switch (event.type) {
      case 'watcher:integrity-violation':
        daemonEvents.broadcast('skills:integrity_violation', {
          name: event.installationId,
          slug: event.installationId, // daemon bridge resolves slug separately in EventBus
          action: event.action,
          modifiedFiles: event.modifiedFiles,
          missingFiles: event.missingFiles,
          unexpectedFiles: event.unexpectedFiles,
        });
        break;
      case 'watcher:reinstalled':
        daemonEvents.broadcast('skills:integrity_restored', {
          name: event.installationId,
          slug: event.installationId,
          modifiedFiles: [],
          missingFiles: [],
        });
        break;
      case 'watcher:quarantined':
        daemonEvents.broadcast('skills:quarantined', {
          name: event.installationId,
          reason: 'Integrity violation — skill quarantined',
        });
        break;
    }
  });

  // Decorate app so routes can access the manager
  app.decorate('skillManager', skillManager);

  // ─── Register sync sources with SkillManager ─────────────────
  try {
    const mcpSource = new MCPSkillSource();
    const { loadState: loadStateForManager } = await import('./state/index.js');
    await mcpSource.addConnection(createAgenCoConnection({
      getConnectedIntegrations: () => loadStateForManager().agenco.connectedIntegrations ?? [],
    }));
    await skillManager.sync.registerSource(mcpSource);

    // Register remote source (wraps marketplace.ts)
    const {
      searchMarketplace,
      getMarketplaceSkill,
      downloadAndExtractZip,
      listDownloadedSkills,
    } = await import('./services/marketplace.js');
    const remoteSource = new RemoteSkillSource({
      searchMarketplace,
      getMarketplaceSkill,
      downloadAndExtractZip,
      listDownloadedSkills,
    });
    await skillManager.sync.registerSource(remoteSource);

    // Sync AgenCo integration skills at boot
    try {
      const syncResult = await skillManager.syncSource('mcp', 'openclaw');
      if (syncResult.installed.length || syncResult.removed.length || syncResult.updated.length) {
        app.log.info(`[startup] AgenCo skill sync: installed=${syncResult.installed.length}, removed=${syncResult.removed.length}, updated=${syncResult.updated.length}`);
      }
    } catch (err) {
      app.log.warn(`[startup] AgenCo skill sync failed: ${(err as Error).message}`);
    }
  } catch (err) {
    app.log.warn(`[startup] Sync source registration failed: ${(err as Error).message}`);
  }

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

  // Start process health watcher for broker/gateway lifecycle events
  await startProcessHealthWatcher(10000);

  // Stop watchers, proxy pool, and MCP on server close
  app.addHook('onClose', async () => {
    emitProcessStopped('daemon', { pid: process.pid });
    stopSecurityWatcher();
    skillManager.stopWatcher();
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
