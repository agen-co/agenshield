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
import { getStorage } from '@agenshield/storage';
import { SkillManager } from '@agentshield/skills';
import { registerRoutes } from './routes/index';
import { getUiAssetsPath } from './static';
import { startSecurityWatcher, stopSecurityWatcher } from './watchers/security';
import { startProcessHealthWatcher, stopProcessHealthWatcher } from './watchers/process-health';
import { emitSkillUntrustedDetected, emitProcessStarted, emitProcessStopped, emitSecurityLocked, eventBus, daemonEvents } from './events/emitter';
import { getVault, getInstallationKey } from './vault';
import { activateMCP, deactivateMCP } from './mcp';
import { getActivityWriter } from './services/activity-writer';
import { getSessionManager } from './auth/session';
import { shutdownProxyPool } from './proxy/pool';
import { getQuarantineDir, getSkillBackupDir, isDevMode } from './config/paths';
import { verifyConfigIntegrity } from './config/loader';
import { ConfigTamperError } from './config/errors';
import { DaemonDeployAdapter } from './adapters/daemon-deploy-adapter';
import { migrateSkillsToSqlite } from './migration/skill-migration';
import { migrateSlugPrefixDisk } from './migration/slug-prefix-disk';
import { migrateSecretsToSqlite } from './migration/secret-migration';
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

  // ─── Get storage (already initialized in main.ts) ────────
  const storage = getStorage();
  const vaultState = storage.isUnlocked() ? 'unlocked' : 'locked (unlock via passcode to manage secrets)';
  console.log(`[Daemon] Storage ready — vault state: ${vaultState}`);

  // ─── Wire auto-lock handler for idle timeout ──────────────
  getSessionManager().setAutoLockHandler(() => {
    try { storage.lock(); } catch { /* already closed */ }
    import('./services/broker-bridge.js')
      .then(({ clearBrokerSecrets }) => clearBrokerSecrets())
      .catch(() => { /* non-fatal */ });
    emitSecurityLocked('idle_timeout');
    console.log('[Daemon] Auto-locked vault after idle timeout');
  });

  // ─── Verify config integrity (HMAC) ──────────────────
  try {
    await verifyConfigIntegrity();
    console.log('[Daemon] Config integrity verified');
  } catch (err) {
    if (err instanceof ConfigTamperError) {
      console.error('[Daemon] CONFIG TAMPER DETECTED — enforcing deny-all policy');
    } else {
      console.warn('[Daemon] Config integrity check failed:', (err as Error).message);
    }
  }

  // ─── Run one-time JSON → SQLite migration ────────────────────
  migrateSkillsToSqlite(storage, skillsDir);

  // ─── Run one-time slug-prefix disk folder rename ─────────────
  migrateSlugPrefixDisk(storage, skillsDir);

  // ─── Run one-time secret vault.enc → SQLite migration ───────
  await migrateSecretsToSqlite(storage);

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
      case 'watcher:integrity-violation': {
        const slug = skillManager.resolveSlugForInstallation(event.installationId);
        daemonEvents.broadcast('skills:integrity_violation', {
          name: slug,
          slug,
          action: event.action,
          modifiedFiles: event.modifiedFiles,
          missingFiles: event.missingFiles,
          unexpectedFiles: event.unexpectedFiles,
        });
        break;
      }
      case 'watcher:reinstalled': {
        const slug = skillManager.resolveSlugForInstallation(event.installationId);
        daemonEvents.broadcast('skills:integrity_restored', {
          name: slug,
          slug,
          modifiedFiles: [],
          missingFiles: [],
        });
        break;
      }
      case 'watcher:quarantined': {
        const slug = skillManager.resolveSlugForInstallation(event.installationId);
        daemonEvents.broadcast('skills:quarantined', {
          name: slug,
          reason: 'Integrity violation — skill quarantined',
        });
        break;
      }
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

  // Start persistent activity writer (SQLite-backed)
  const activityWriter = getActivityWriter();
  activityWriter.start();

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
    activityWriter.stop();
    shutdownProxyPool();
    await deactivateMCP();
    // Clear broker's in-memory secrets on shutdown
    try {
      const { clearBrokerSecrets } = await import('./services/broker-bridge.js');
      await clearBrokerSecrets();
    } catch {
      // Non-fatal
    }
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
