/**
 * Setup routes — wizard engine, detection, shielding, and setup completion.
 *
 * These routes are available in both setup and daemon mode,
 * but specific operations are gated by mode checks.
 *
 * The wizard engine routes match the CLI setup-server API so the UI
 * works identically whether connected to the daemon or the CLI server.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiResponse, DetectedTarget, OldInstallation, DetectionResult, MigrationSelection, DaemonConfig } from '@agenshield/ipc';
import { ASH_PREFIX } from '@agenshield/sandbox';
import { updateSetupState, loadState } from '../state';
import { emitEvent } from '../events/emitter';
import type { WizardEngine } from '../wizard/index';
import type { WizardContext, WizardStepId } from '../wizard/types';
import type { PrivilegeExecutor } from '../wizard/privilege-executor';

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Require setup mode for an endpoint — returns 409 if already in daemon mode.
 */
function requireSetupMode(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.daemonMode !== 'setup') {
    reply.code(409).send({
      success: false,
      error: { message: 'Setup already completed', statusCode: 409 },
    });
    return false;
  }
  return true;
}

/**
 * Compute user/group names from a base name (matches CLI's AdvancedConfig.computeNames)
 */
function computeNames(baseName: string): { agentUser: string; brokerUser: string; socketGroup: string; workspaceGroup: string } {
  const clean = baseName.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const base = clean || 'default';
  return {
    agentUser: `${ASH_PREFIX}${base}_agent`,
    brokerUser: `${ASH_PREFIX}${base}_broker`,
    socketGroup: `${ASH_PREFIX}${base}`,
    workspaceGroup: `${ASH_PREFIX}${base}_workspace`,
  };
}

/**
 * Sanitize context for API response — strip non-serializable and sensitive data
 */
function sanitizeContext(context: WizardContext): Record<string, unknown> {
  const { preset, passcodeValue, ...rest } = context as Record<string, unknown>;
  return {
    ...rest,
    presetName: (context.preset as { name?: string } | undefined)?.name ?? null,
    presetId: (context.preset as { id?: string } | undefined)?.id ?? null,
  };
}

/** Race guard — prevent double-triggering async phases */
let isRunning = false;

/** Lazily initialized wizard engine — created on first API call in setup mode */
let wizardEngine: WizardEngine | null = null;

/** Privilege executor — created when setup starts, cleaned up after final phase */
let privilegeExecutor: PrivilegeExecutor | null = null;

/** Shut down the privilege executor and clear references */
async function shutdownPrivilegeExecutor(engine: WizardEngine): Promise<void> {
  if (privilegeExecutor) {
    try {
      await privilegeExecutor.shutdown();
    } catch { /* ignore */ }
    privilegeExecutor = null;
    engine.context.privilegeExecutor = undefined;
  }
}

/**
 * Get or create the wizard engine (lazy initialization)
 */
function getWizardEngine(): WizardEngine {
  if (!wizardEngine) {
    const { createWizardEngine, setEngineLogCallback } = require('../wizard/index');
    wizardEngine = createWizardEngine() as WizardEngine;

    // Wire engine state changes to daemon SSE
    wizardEngine!.onStateChange = (state) => {
      const phase = determinePhase(wizardEngine!);
      emitEvent('setup:state_change', {
        state,
        context: sanitizeContext(wizardEngine!.context),
        phase,
      });
    };

    // Wire engine log callback to SSE
    setEngineLogCallback((message: string, stepId?: WizardStepId) => {
      emitEvent('setup:log', { message, stepId });
    });

    // Run detection phase immediately
    wizardEngine!.runDetectionPhase().catch((err: Error) => {
      console.error('[Setup] Detection phase failed:', err.message);
    });
  }
  return wizardEngine!;
}

/**
 * Determine the current wizard phase from engine state
 */
function determinePhase(engine: WizardEngine): string {
  const hasConfirm = engine.state.steps.find(s => s.id === 'confirm');
  const hasComplete = engine.state.steps.find(s => s.id === 'complete');
  const verifyStep = engine.state.steps.find(s => s.id === 'verify');

  if (engine.state.isComplete || hasComplete?.status === 'completed') {
    return 'complete';
  } else if (engine.state.steps.find(s => s.id === 'setup-passcode')?.status === 'running') {
    return 'passcode';
  } else if (verifyStep?.status === 'completed') {
    return 'passcode';
  } else if (hasConfirm?.status === 'completed') {
    return 'execution';
  } else if (engine.context.presetDetection?.found) {
    return 'configuration';
  }
  return 'detection';
}

// ── Route registration ───────────────────────────────────────────

/**
 * Register setup API routes.
 */
export async function setupRoutes(app: FastifyInstance): Promise<void> {

  // ─── Wizard engine routes (match CLI setup-server API) ─────────

  /**
   * GET /setup/state — Wizard state, context, and phase.
   */
  app.get('/setup/state', async (request) => {
    if (request.daemonMode !== 'setup') {
      const state = loadState();
      return {
        success: true,
        data: {
          state: null,
          context: {},
          phase: 'complete',
          targetInstallable: false,
          scanResult: null,
          mode: 'daemon',
          completed: state.setup?.completed ?? true,
        },
      };
    }

    const engine = getWizardEngine();
    const phase = determinePhase(engine);

    return {
      success: true,
      data: {
        state: engine.state,
        context: sanitizeContext(engine.context),
        phase,
        targetInstallable: engine.context.targetInstallable ?? false,
        scanResult: engine.context.scanResult ?? null,
      },
    };
  });

  /**
   * POST /setup/configure — Set mode and baseName, create user/paths config.
   */
  app.post<{ Body: { mode: 'quick' | 'advanced'; baseName?: string } }>(
    '/setup/configure',
    async (request) => {
      const engine = getWizardEngine();
      const { mode, baseName } = request.body;

      const effectiveBaseName = mode === 'quick' ? 'default' : (baseName || 'default');

      engine.context.options = {
        ...engine.context.options,
        baseName: effectiveBaseName,
      };

      const { createUserConfig, createPathsConfig } = await import('@agenshield/sandbox');
      engine.context.userConfig = createUserConfig({ baseName: effectiveBaseName });
      engine.context.pathsConfig = createPathsConfig(engine.context.userConfig);

      const names = computeNames(effectiveBaseName);

      emitEvent('setup:state_change', {
        state: engine.state,
        context: sanitizeContext(engine.context),
        phase: 'configuration',
      });

      return {
        success: true,
        data: { mode, baseName: effectiveBaseName, names },
      };
    },
  );

  /**
   * POST /setup/check-conflicts — Check for existing users/groups.
   */
  app.post<{ Body: { baseName: string } }>(
    '/setup/check-conflicts',
    async (request) => {
      const { baseName } = request.body;
      const names = computeNames(baseName);

      const { userExists, groupExists } = await import('@agenshield/sandbox');

      const existingUsers: string[] = [];
      const existingGroups: string[] = [];

      if (await userExists(names.agentUser)) existingUsers.push(names.agentUser);
      if (await userExists(names.brokerUser)) existingUsers.push(names.brokerUser);
      if (await groupExists(names.socketGroup)) existingGroups.push(names.socketGroup);
      if (await groupExists(names.workspaceGroup)) existingGroups.push(names.workspaceGroup);

      return {
        success: true,
        data: {
          hasConflicts: existingUsers.length > 0 || existingGroups.length > 0,
          users: existingUsers,
          groups: existingGroups,
          names,
        },
      };
    },
  );

  /**
   * POST /setup/install-target — Install openclaw via npm.
   */
  app.post('/setup/install-target', async () => {
    if (isRunning) {
      return { success: false, error: { code: 'ALREADY_RUNNING', message: 'An operation is already in progress' } };
    }

    const engine = getWizardEngine();
    isRunning = true;

    try {
      const { execSync } = await import('node:child_process');
      execSync('npm install -g openclaw', {
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: 'pipe',
      });

      const { autoDetectPreset } = await import('@agenshield/sandbox');
      const result = await autoDetectPreset();
      if (!result) {
        isRunning = false;
        return {
          success: false,
          error: { code: 'DETECT_FAILED', message: 'openclaw was installed but could not be detected. Check your PATH.' },
        };
      }

      engine.context.preset = result.preset;
      engine.context.presetDetection = result.detection;
      engine.context.targetInstallable = false;
      engine.context.installTargetRequested = true;

      const installTargetStep = engine.state.steps.find(s => s.id === 'install-target');
      if (installTargetStep) {
        installTargetStep.status = 'completed';
      }

      emitEvent('setup:state_change', {
        state: engine.state,
        context: sanitizeContext(engine.context),
        phase: 'detection',
      });

      isRunning = false;

      return {
        success: true,
        data: {
          installed: true,
          preset: result.preset.name,
          version: result.detection.version,
        },
      };
    } catch (err) {
      isRunning = false;
      return {
        success: false,
        error: { code: 'INSTALL_FAILED', message: (err as Error).message },
      };
    }
  });

  /**
   * POST /setup/confirm — Trigger setup phase (async).
   *
   * Creates an OsascriptExecutor (macOS native password dialog) so the
   * daemon can run privileged commands without requiring terminal sudo.
   * The executor persists until the final phase completes.
   */
  app.post('/setup/confirm', async () => {
    if (isRunning) {
      return { success: false, error: { code: 'ALREADY_RUNNING', message: 'Setup is already in progress' } };
    }

    const engine = getWizardEngine();
    isRunning = true;

    // Create a privilege executor for macOS native admin dialog.
    // The osascript executor lazily shows the password dialog on first use.
    if (!privilegeExecutor) {
      try {
        const { OsascriptExecutor } = await import('../wizard/osascript-executor.js');
        privilegeExecutor = new OsascriptExecutor();
        engine.context.privilegeExecutor = privilegeExecutor;
      } catch (err) {
        // If OsascriptExecutor fails to load (e.g. non-macOS), fall back to
        // no executor (engine will use direct sudo keepalive instead).
        console.warn('[Setup] OsascriptExecutor unavailable, falling back to direct sudo:', (err as Error).message);
      }
    }

    engine.runSetupPhase().then(() => {
      isRunning = false;
      // Note: do NOT shut down the executor here — it's needed for the final phase
      if (engine.state.hasError) {
        emitEvent('setup:error', {
          error: engine.state.steps.find(s => s.status === 'error')?.error ?? 'Unknown error',
        });
      } else {
        emitEvent('setup:scan_complete', {
          state: engine.state,
          context: sanitizeContext(engine.context),
          scanResult: engine.context.scanResult ?? null,
        });
      }
    }).catch(async (err: Error) => {
      isRunning = false;
      // On error, clean up the executor since setup won't continue
      await shutdownPrivilegeExecutor(engine);
      emitEvent('setup:error', { error: err.message });
    });

    return { success: true, data: { started: true } };
  });

  /**
   * POST /setup/passcode — Set passcode and trigger final phase.
   */
  app.post<{ Body: { passcode?: string; skip?: boolean } }>(
    '/setup/passcode',
    async (request) => {
      if (isRunning) {
        return { success: false, error: { code: 'ALREADY_RUNNING', message: 'Final phase is already in progress' } };
      }

      const engine = getWizardEngine();
      const { passcode, skip } = request.body;

      if (skip) {
        engine.context.passcodeSetup = { configured: false, skipped: true };
      } else if (passcode) {
        engine.context.passcodeValue = passcode;
      }

      isRunning = true;

      engine.runFinalPhase().then(async () => {
        isRunning = false;

        // Clean up privilege executor — setup is done
        await shutdownPrivilegeExecutor(engine);

        // Mark setup as completed in daemon state
        updateSetupState({ completed: true, phase: 'complete' });

        // Start full daemon services
        try {
          const { startDaemonServices } = await import('../server.js');
          const config = getDaemonConfig();
          await startDaemonServices(app, config);
        } catch (err) {
          console.error('[Setup] Failed to start daemon services:', (err as Error).message);
        }

        emitEvent('setup:complete', {});
      }).catch(async (err: Error) => {
        isRunning = false;
        await shutdownPrivilegeExecutor(engine);
        emitEvent('setup:error', { error: err.message });
      });

      return { success: true, data: { started: true } };
    },
  );

  /**
   * GET /setup/scan-result — Return scan result from engine context.
   */
  app.get('/setup/scan-result', async () => {
    const engine = getWizardEngine();

    if (!engine.context.scanResult) {
      return {
        success: false,
        error: { code: 'NOT_READY', message: 'Scan has not completed yet' },
      };
    }

    return {
      success: true,
      data: engine.context.scanResult,
    };
  });

  /**
   * POST /setup/select-items — Store migration selection and trigger migration phase.
   */
  app.post<{ Body: MigrationSelection }>(
    '/setup/select-items',
    async (request) => {
      if (isRunning) {
        return { success: false, error: { code: 'ALREADY_RUNNING', message: 'An operation is already in progress' } };
      }

      const engine = getWizardEngine();
      const { selectedSkills, selectedEnvVars } = request.body;

      engine.context.migrationSelection = {
        selectedSkills: selectedSkills ?? [],
        selectedEnvVars: selectedEnvVars ?? [],
      };

      isRunning = true;

      engine.runMigrationPhase().then(() => {
        isRunning = false;
        if (engine.state.hasError) {
          emitEvent('setup:error', {
            error: engine.state.steps.find(s => s.status === 'error')?.error ?? 'Unknown error',
          });
        } else {
          emitEvent('setup:state_change', {
            state: engine.state,
            context: sanitizeContext(engine.context),
            phase: 'passcode',
          });
        }
      }).catch((err: Error) => {
        isRunning = false;
        emitEvent('setup:error', { error: err.message });
      });

      return { success: true, data: { started: true } };
    },
  );

  /**
   * GET /setup/executables — Scan system executables.
   */
  let discoveryCache: { data: ReturnType<typeof import('@agenshield/sandbox').scanDiscovery>; cachedAt: number } | null = null;
  const EXEC_CACHE_TTL = 60_000;

  app.get('/setup/executables', async () => {
    const engine = getWizardEngine();
    const { scanDiscovery } = await import('@agenshield/sandbox');

    const now = Date.now();
    if (discoveryCache && now - discoveryCache.cachedAt < EXEC_CACHE_TTL) {
      const result = discoveryCache.data;
      return {
        success: true,
        data: {
          discovery: result,
          executables: result.binaries.map((b: { name: string; path: string; dir: string; protection: string; category: string }) => ({
            name: b.name,
            path: b.path,
            dir: b.dir,
            isProxied: b.protection === 'proxied',
            isWrapped: b.protection === 'wrapped',
            isAllowed: b.protection === 'allowed',
            category: b.category === 'language-runtime' ? 'other' : b.category,
          })),
        },
      };
    }

    const result = scanDiscovery({
      scanSkills: !!engine.context.presetDetection?.found,
      agentHome: engine.context.userConfig?.agentUser?.home,
      workspaceDir: engine.context.userConfig
        ? `${engine.context.userConfig.agentUser.home}/workspace`
        : undefined,
    });

    discoveryCache = { data: result, cachedAt: now };

    return {
      success: true,
      data: {
        discovery: result,
        executables: result.binaries.map((b: { name: string; path: string; dir: string; protection: string; category: string }) => ({
          name: b.name,
          path: b.path,
          dir: b.dir,
          isProxied: b.protection === 'proxied',
          isWrapped: b.protection === 'wrapped',
          isAllowed: b.protection === 'allowed',
          category: b.category === 'language-runtime' ? 'other' : b.category,
        })),
      },
    };
  });

  // ─── Legacy detection routes (kept for backward compatibility) ──

  /**
   * GET /setup/detection — Run detection scan for targets and old installations.
   */
  app.get('/setup/detection', async (): Promise<ApiResponse<DetectionResult>> => {
    const targets = await detectTargets();
    const oldInstallations = await detectOldInstallations();

    emitEvent('setup:detection', { targets, oldInstallations });

    return {
      success: true,
      data: { targets, oldInstallations },
    };
  });

  /**
   * POST /setup/shield/:targetId — Start shielding a detected target.
   */
  app.post<{ Params: { targetId: string } }>(
    '/setup/shield/:targetId',
    async (request, reply): Promise<ApiResponse<{ targetId: string; profileId: string }>> => {
      const { targetId } = request.params;

      emitEvent('setup:shield_progress', {
        targetId,
        step: 'initializing',
        progress: 0,
        message: 'Preparing to shield target...',
      });

      try {
        updateSetupState({ phase: 'shielding' });

        emitEvent('setup:shield_progress', { targetId, step: 'creating_profile', progress: 25, message: 'Creating profile...' });
        emitEvent('setup:shield_progress', { targetId, step: 'installing_wrappers', progress: 50, message: 'Installing command wrappers...' });
        emitEvent('setup:shield_progress', { targetId, step: 'configuring_policies', progress: 75, message: 'Configuring policies...' });

        const profileId = `profile-${targetId}`;

        emitEvent('setup:shield_progress', { targetId, step: 'complete', progress: 100, message: 'Shielding complete' });
        emitEvent('setup:shield_complete', { targetId, profileId });

        return { success: true, data: { targetId, profileId } };
      } catch (err) {
        emitEvent('setup:error', { error: (err as Error).message, targetId });
        return reply.code(500).send({
          success: false,
          error: { message: (err as Error).message, statusCode: 500 },
        });
      }
    }
  );

  /**
   * POST /setup/replace-installation — Replace an old AgenShield installation.
   */
  app.post('/setup/replace-installation', async (_request, reply): Promise<ApiResponse<{ replaced: boolean }>> => {
    try {
      return { success: true, data: { replaced: true } };
    } catch (err) {
      return reply.code(500).send({
        success: false,
        error: { message: (err as Error).message, statusCode: 500 },
      });
    }
  });

  /**
   * POST /setup/complete — Mark setup as complete and start full daemon services.
   * (Legacy route — new flow uses POST /setup/passcode which handles completion.)
   */
  app.post('/setup/complete', async (request, reply): Promise<ApiResponse<{ mode: string }>> => {
    if (!requireSetupMode(request, reply)) return reply;

    updateSetupState({ completed: true, phase: 'complete' });

    try {
      const { startDaemonServices } = await import('../server.js');
      const config = getDaemonConfig();
      await startDaemonServices(app, config);
    } catch (err) {
      console.error('[Setup] Failed to start daemon services:', (err as Error).message);
    }

    emitEvent('setup:complete', {});

    return { success: true, data: { mode: 'daemon' } };
  });
}

// ── Detection helpers ──────────────────────────────────────────

async function detectTargets(): Promise<DetectedTarget[]> {
  const targets: DetectedTarget[] = [];

  try {
    const { listPresets } = await import('@agenshield/sandbox');
    const presets = listPresets();

    for (const preset of presets) {
      if (preset.id === 'custom') continue;
      try {
        const detection = await preset.detect();
        if (detection) {
          targets.push({
            id: preset.id,
            name: preset.name,
            type: preset.id,
            version: detection.version,
            binaryPath: detection.binaryPath,
            method: detection.method ?? 'auto',
            shielded: false,
          });
        }
      } catch {
        // Detection failed for this preset — skip
      }
    }
  } catch {
    // Sandbox package not available — return empty
  }

  return targets;
}

async function detectOldInstallations(): Promise<OldInstallation[]> {
  const installations: OldInstallation[] = [];

  try {
    const { execSync } = await import('node:child_process');
    const fs = await import('node:fs');

    try {
      execSync('dscl . -read /Users/ash_default_agent', { stdio: 'pipe' });
    } catch {
      return installations;
    }

    const users: string[] = [];
    try {
      const output = execSync('dscl . -list /Users', { encoding: 'utf-8' });
      for (const line of output.split('\n')) {
        const username = line.trim();
        if (username.startsWith('ash_')) users.push(username);
      }
    } catch { /* ignore */ }

    const groups: string[] = [];
    try {
      const output = execSync('dscl . -list /Groups', { encoding: 'utf-8' });
      for (const line of output.split('\n')) {
        const name = line.trim();
        if (name.startsWith('ash_')) groups.push(name);
      }
    } catch { /* ignore */ }

    const directories: string[] = [];
    for (const dir of ['/opt/agenshield', '/etc/agenshield', '/var/run/agenshield', '/var/log/agenshield']) {
      if (fs.existsSync(dir)) directories.push(dir);
    }

    const launchDaemons: string[] = [];
    const plistDir = '/Library/LaunchDaemons';
    if (fs.existsSync(plistDir)) {
      try {
        for (const file of fs.readdirSync(plistDir)) {
          if (file.startsWith('com.agenshield.')) launchDaemons.push(file);
        }
      } catch { /* ignore */ }
    }

    let version = 'unknown';
    try {
      const migrationsPath = '/etc/agenshield/migrations.json';
      if (fs.existsSync(migrationsPath)) {
        const data = JSON.parse(fs.readFileSync(migrationsPath, 'utf-8'));
        version = data.version ?? 'unknown';
      }
    } catch { /* ignore */ }

    if (users.length > 0 || directories.length > 0) {
      installations.push({ version, components: { users, groups, directories, launchDaemons } });
    }
  } catch {
    // Detection failed — return empty
  }

  return installations;
}

function getDaemonConfig(): DaemonConfig {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadConfig } = require('../config/loader');
  return loadConfig() as DaemonConfig;
}
