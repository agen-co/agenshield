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
import { sanitizeLogUrl } from './utils/log-sanitizer';
import { setDaemonLogger } from './logger';
import { createLogBufferDestination } from './services/log-buffer';
import { getStorage } from '@agenshield/storage';
import { SkillManager } from '@agentshield/skills';
import { registerRoutes } from './routes/index';
import { getUiAssetsPath } from './static';
import { startSecurityWatcher, stopSecurityWatcher } from './watchers/security';
import { startProcessHealthWatcher, stopProcessHealthWatcher } from './watchers/process-health';
import { startTargetWatcher, stopTargetWatcher, setProcessManager } from './watchers/targets';
import { emitSkillUntrustedDetected, emitProcessStarted, emitProcessStopped, eventBus, daemonEvents } from './events/emitter';
import { getVault, getInstallationKey, loadOrCreateVaultKey } from './vault';
import { loadOrCreateSecret, signAdminToken } from '@agenshield/auth';
import { activateMCP, deactivateMCP } from './mcp';
import { getActivityWriter } from './services/activity-writer';
import { shutdownProxyPool } from './proxy/pool';
import { getQuarantineDir, getSkillBackupDir, isDevMode, getConfigDir } from './config/paths';
import { verifyConfigIntegrity } from './config/loader';
import { ConfigTamperError } from './config/errors';
import { DaemonDeployAdapter } from './adapters/daemon-deploy-adapter';
import { migrateSkillsToSqlite } from './migration/skill-migration';
import { migrateSlugPrefixDisk } from './migration/slug-prefix-disk';
import { migrateSecretsToSqlite } from './migration/secret-migration';
import { cleanupLegacyFiles } from './migration/legacy-cleanup';
import { reconcileTokenFiles, writeTokenFile } from './services/profile-token';
import { ProfileSocketManager } from './services/profile-sockets';
import { rpcHandlers } from './routes/rpc';
import {
  MCPSkillSource,
  createAgenCoConnection,
  RemoteSkillSource,
} from './adapters';
import { initPolicyManager } from './services/policy-manager';
import { pushSecretsToBroker } from './services/broker-bridge';
import { startMetricsCollector, stopMetricsCollector } from './services/metrics-collector';
import { resolveTargetContext } from './services/target-context';
import { ProcessManager } from './services/process-manager';
import { getCloudConnector } from './services/cloud-connector';
import { startProcessEnforcer, stopProcessEnforcer } from './services/process-enforcer';

/**
 * Create and configure the Fastify server
 * @param config Daemon configuration
 * @returns Configured Fastify instance
 */
export async function createServer(config: DaemonConfig): Promise<FastifyInstance> {
  const devMode = isDevMode();

  // Build Pino logger options
  const loggerOpts: Record<string, unknown> = {
    level: devMode ? 'debug' : config.logLevel,
    serializers: {
      req(request: { method?: string; url?: string }) {
        return {
          method: request.method,
          url: request.url ? sanitizeLogUrl(request.url) : request.url,
        };
      },
    },
  };

  if (devMode) {
    // Pretty-print in dev mode
    loggerOpts.transport = {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    };
  } else {
    // In production, tee logs to both stdout and the in-memory ring buffer
    // so the CLI `logs` command can stream them.
    const pino = (await import('pino')).default;
    const multistream = pino.multistream([
      { stream: process.stdout },
      { stream: createLogBufferDestination() },
    ]);
    loggerOpts.stream = multistream;
  }

  const app = Fastify({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logger: loggerOpts as any,
  });

  // Expose Pino logger globally for non-route code
  setDaemonLogger(app.log);

  // Enable CORS for development
  await app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'] });

  // Register API routes
  await registerRoutes(app);

  // Serve static UI assets if available
  const uiPath = getUiAssetsPath();
  app.log.info(uiPath ? `UI assets: ${uiPath}` : 'UI assets: not found (API-only mode)');
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

  await startDaemonServices(app, config);

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

/**
 * Start heavy daemon services (watchers, skill manager, proxy pool, MCP, etc.)
 * Called at boot in daemon mode, or after setup completion.
 */
export async function startDaemonServices(app: FastifyInstance, config: DaemonConfig): Promise<void> {
  // Start security watcher for real-time monitoring
  startSecurityWatcher(10000); // Check every 10 seconds

  // Derive paths from profile storage (falls back to env vars / defaults)
  const targetCtx = resolveTargetContext();
  const agentHome = targetCtx.agentHome;
  const skillsDir = path.resolve(`${agentHome}/.openclaw/workspace/skills`);
  const socketGroup = targetCtx.socketGroup;

  const devMode = isDevMode();

  // Ensure skills directory exists with proper permissions
  if (!fs.existsSync(skillsDir)) {
    try {
      if (devMode) {
        fs.mkdirSync(skillsDir, { recursive: true });
      } else {
        fs.mkdirSync(skillsDir, { recursive: true, mode: 0o2775 });
        try {
          execSync(`chown -R root:${socketGroup} "${skillsDir}"`, { stdio: 'pipe' });
        } catch { /* best-effort — may not be root */ }
      }
      app.log.info(`Created skills directory: ${skillsDir}`);
    } catch (err) {
      app.log.warn({ err }, `Cannot create skills directory (${skillsDir}) — skills features will be limited until the directory is created by the shielding pipeline`);
    }
  } else if (!devMode) {
    try {
      const stat = fs.statSync(skillsDir);
      if ((stat.mode & 0o7777) !== 0o2775) {
        fs.chmodSync(skillsDir, 0o2775);
      }
    } catch { /* best-effort */ }
  }

  if (devMode) {
    app.log.info(`Running in DEV MODE — agentHome=${agentHome}, skillsDir=${skillsDir}`);
  }

  // Initialize installation key (generate if first run, cache for sync access in watcher)
  try {
    await getInstallationKey();
    app.log.info('Installation key ready');
  } catch (err) {
    app.log.warn({ err }, 'Failed to initialize installation key');
  }

  // ─── Get storage (already initialized in main.ts) ────────
  const storage = getStorage();

  // ─── Initialize vault encryption with raw key ────────────
  const vaultKey = loadOrCreateVaultKey();
  if (storage.hasPasscode()) {
    storage.unlockWithKey(vaultKey);
  } else {
    storage.initEncryption(vaultKey);
  }
  app.log.info('Storage ready — vault unlocked via vault key');

  // ─── Initialize JWT secret ──────────────────────────────
  loadOrCreateSecret();
  app.log.info('JWT secret ready');

  // ─── Generate admin token file ──────────────────────────
  try {
    const adminToken = await signAdminToken();

    // Primary: user-accessible config dir (~/.agenshield/.admin-token)
    const configTokenPath = path.join(getConfigDir(), '.admin-token');
    fs.writeFileSync(configTokenPath, adminToken, { mode: 0o600 });
    // Chown to calling user if running under sudo
    const sudoUser = process.env['SUDO_USER'];
    if (process.getuid?.() === 0 && sudoUser) {
      try {
        const uid = parseInt(execSync(`id -u ${sudoUser}`, { encoding: 'utf-8' }).trim(), 10);
        const gid = parseInt(execSync(`id -g ${sudoUser}`, { encoding: 'utf-8' }).trim(), 10);
        fs.chownSync(configTokenPath, uid, gid);
      } catch { /* best effort */ }
    }
    app.log.info(`Admin token written to ${configTokenPath}`);

    // Secondary: system dir (best-effort, for root-level reads)
    try {
      const tokenDir = '/var/run/agenshield';
      if (!fs.existsSync(tokenDir)) {
        fs.mkdirSync(tokenDir, { recursive: true, mode: 0o755 });
      }
      fs.writeFileSync(path.join(tokenDir, '.admin-token'), adminToken, { mode: 0o644 });
    } catch {
      app.log.debug('Could not write token to /var/run/agenshield — using config dir only');
    }
  } catch (err) {
    app.log.warn({ err }, 'Failed to write admin token file');
  }

  // Start background metrics collector (2s interval, stores to SQLite)
  startMetricsCollector();

  // ─── Initialize PolicyManager ──────────────────────────────
  const policyManager = initPolicyManager(storage, {
    eventBus,
    pushSecrets: pushSecretsToBroker,
  });
  app.log.info(`PolicyManager ready — engine v${policyManager.engineVersion}`);

  if (devMode) {
    // Seed dev data (profiles, preset policies)
    const { seedDevData } = await import('./dev/seed.js');
    seedDevData(storage);
  }

  // ─── Clean up stale graph activations from previous sessions ──
  try {
    storage.policyGraph.expireBySession();
    const pruned = storage.policyGraph.pruneExpired();
    if (pruned > 0) {
      app.log.info(`Pruned ${pruned} stale policy graph activations`);
    }
  } catch (err) {
    app.log.warn({ err }, 'Policy graph activation cleanup failed');
  }

  // ─── Reconcile broker token files ──────────────────────────
  await reconcileTokenFiles(storage);
  app.log.info('Broker token files reconciled');

  // ─── Start per-profile daemon sockets ──────────────────────
  const profileSocketManager = new ProfileSocketManager(storage, rpcHandlers);
  try {
    await profileSocketManager.start();
    app.decorate('profileSocketManager', profileSocketManager);
    app.log.info('Per-profile daemon sockets started');
  } catch (err) {
    app.log.warn({ err }, 'Failed to start profile sockets');
  }

  // ─── Verify config integrity (HMAC) ──────────────────
  try {
    await verifyConfigIntegrity();
    app.log.info('Config integrity verified');
  } catch (err) {
    if (err instanceof ConfigTamperError) {
      app.log.error('CONFIG TAMPER DETECTED — enforcing deny-all policy');
    } else {
      app.log.warn({ err }, 'Config integrity check failed');
    }
  }

  // ─── Run one-time JSON → SQLite migration ────────────────────
  migrateSkillsToSqlite(storage, skillsDir);

  // ─── Run one-time slug-prefix disk folder rename ─────────────
  migrateSlugPrefixDisk(storage, skillsDir);

  // ─── Run one-time secret vault.enc → SQLite migration ───────
  await migrateSecretsToSqlite(storage);

  // ─── Post-migration legacy file cleanup ─────────────────────
  cleanupLegacyFiles(storage);

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

  // Start target status watcher (10s, emits on change only)
  startTargetWatcher(10000);

  // Initialize privilege executor for root operations (lazy — prompts user on first use)
  const { OsascriptExecutor } = await import('./services/osascript-executor.js');
  const executor = new OsascriptExecutor();
  app.decorate('privilegeExecutor', executor);

  // Initialize gateway process manager
  const processManager = new ProcessManager();
  app.decorate('processManager', processManager);
  setProcessManager(processManager);

  // Connect to AgenShield Cloud if credentials exist
  const cloudConnector = getCloudConnector();
  try {
    await cloudConnector.connect();
    if (cloudConnector.isConnected()) {
      app.log.info(`[cloud] Connected to AgenShield Cloud (${cloudConnector.getCompanyName() ?? 'unknown company'})`);
    }
  } catch (err) {
    app.log.warn({ err }, '[cloud] Failed to connect to AgenShield Cloud');
  }

  // Start process enforcer (scans running host processes against process-target policies)
  startProcessEnforcer({ intervalMs: 10_000 });

  // Stop watchers, proxy pool, and MCP on server close
  app.addHook('onClose', async () => {
    emitProcessStopped('daemon', { pid: process.pid });
    stopProcessEnforcer();
    stopSecurityWatcher();
    stopMetricsCollector();
    stopTargetWatcher();
    skillManager.stopWatcher();
    stopProcessHealthWatcher();
    activityWriter.stop();
    shutdownProxyPool();
    await profileSocketManager.stop();
    await deactivateMCP();
    // Shut down the process manager (stop all managed gateway processes)
    if (app.processManager) {
      try {
        await app.processManager.shutdown();
      } catch { /* non-fatal */ }
    }
    // Shut down the privilege executor if it's still running
    if (app.privilegeExecutor) {
      try {
        await app.privilegeExecutor.shutdown();
      } catch { /* non-fatal */ }
    }
    // Disconnect cloud connector
    cloudConnector.disconnect();
    // Clear broker's in-memory secrets on shutdown
    try {
      const { clearBrokerSecrets } = await import('./services/broker-bridge.js');
      await clearBrokerSecrets();
    } catch {
      // Non-fatal
    }
  });
}
