/**
 * REST API routes for the setup server
 *
 * Wraps the existing WizardEngine with HTTP endpoints and streams
 * engine.onStateChange as SSE events.
 */

import type { FastifyInstance } from 'fastify';
import {
  createUserConfig,
  createPathsConfig,
  userExists,
  groupExists,
  scanDiscovery,
  autoDetectPreset,
} from '@agenshield/sandbox';
import type { MigrationSelection } from '@agenshield/ipc';
import type { WizardEngine } from '../wizard/engine.js';
import type { WizardState, WizardContext, WizardStepId } from '../wizard/types.js';
import { computeNames } from '../wizard/components/AdvancedConfig.js';
import { broadcastSetupEvent } from './sse.js';

export interface ExecutableInfo {
  name: string;
  path: string;
  dir: string;
  isProxied: boolean;
  isWrapped: boolean;
  isAllowed: boolean;
  category: 'system' | 'package-manager' | 'network' | 'shell' | 'other';
}

/**
 * Sanitize context for API response — strip non-serializable and sensitive data
 */
function sanitizeContext(context: WizardContext): Record<string, unknown> {
  const { preset, passcodeValue, ...rest } = context as Record<string, unknown>;
  return {
    ...rest,
    // Add serializable preset info
    presetName: (context.preset as { name?: string } | undefined)?.name ?? null,
    presetId: (context.preset as { id?: string } | undefined)?.id ?? null,
  };
}

/** Race guard — prevent double-triggering async phases */
let isRunning = false;

/**
 * Register all setup API routes
 */
export async function registerRoutes(app: FastifyInstance, engine: WizardEngine): Promise<void> {
  // --- Health ---
  app.get('/api/health', async () => {
    return {
      success: true,
      data: {
        ok: true,
        timestamp: new Date().toISOString(),
        mode: 'setup' as const,
      },
    };
  });

  // --- Auth status (fake — no auth needed for setup) ---
  app.get('/api/auth/status', async () => {
    return {
      protectionEnabled: false,
      passcodeSet: false,
      allowAnonymousReadOnly: true,
      lockedOut: false,
    };
  });

  // --- Setup state ---
  app.get('/api/setup/state', async () => {
    // Determine phase
    let phase: string = 'detection';
    const hasConfirm = engine.state.steps.find(s => s.id === 'confirm');
    const hasComplete = engine.state.steps.find(s => s.id === 'complete');
    const scanSource = engine.state.steps.find(s => s.id === 'scan-source');
    const selectItems = engine.state.steps.find(s => s.id === 'select-items');
    const verifyStep = engine.state.steps.find(s => s.id === 'verify');

    if (engine.state.isComplete || hasComplete?.status === 'completed') {
      phase = 'complete';
    } else if (engine.state.steps.find(s => s.id === 'setup-passcode')?.status === 'running') {
      phase = 'passcode';
    } else if (verifyStep?.status === 'completed') {
      // Migration phase is done, waiting for passcode
      phase = 'passcode';
    } else if (selectItems?.status === 'running' || selectItems?.status === 'completed') {
      // Running migration phase (select-items, migrate, verify)
      phase = 'migration';
    } else if (scanSource?.status === 'completed' && selectItems?.status === 'pending') {
      // Scan done, waiting for user to select items
      phase = 'selection';
    } else if (hasConfirm?.status === 'completed') {
      phase = 'execution';
    } else if (engine.context.presetDetection?.found) {
      phase = 'configuration';
    }

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

  // --- Configure (set mode + baseName) ---
  app.post<{ Body: { mode: 'quick' | 'advanced'; baseName?: string } }>(
    '/api/setup/configure',
    async (request) => {
      const { mode, baseName } = request.body;

      const effectiveBaseName = mode === 'quick' ? 'default' : (baseName || 'default');

      // Update engine context
      engine.context.options = {
        ...engine.context.options,
        baseName: effectiveBaseName,
      };

      // Create user config
      const userConfig = createUserConfig({ baseName: effectiveBaseName });
      engine.context.userConfig = userConfig;
      engine.context.pathsConfig = createPathsConfig(userConfig);

      const names = computeNames(effectiveBaseName);

      broadcastSetupEvent('setup:state_change', {
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

  // --- Check conflicts ---
  app.post<{ Body: { baseName: string } }>(
    '/api/setup/check-conflicts',
    async (request) => {
      const { baseName } = request.body;
      const names = computeNames(baseName);

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

  // --- Install target (npm install -g openclaw) ---
  app.post('/api/setup/install-target', async () => {
    if (isRunning) {
      return { success: false, error: { code: 'ALREADY_RUNNING', message: 'An operation is already in progress' } };
    }

    isRunning = true;

    try {
      const { execSync } = await import('node:child_process');
      execSync('npm install -g openclaw', {
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: 'pipe',
      });

      // Re-run detection
      const result = await autoDetectPreset();
      if (!result) {
        isRunning = false;
        return {
          success: false,
          error: { code: 'DETECT_FAILED', message: 'openclaw was installed but could not be detected. Check your PATH.' },
        };
      }

      // Update engine context
      engine.context.preset = result.preset;
      engine.context.presetDetection = result.detection;
      engine.context.targetInstallable = false;
      engine.context.installTargetRequested = true;

      // Update step statuses
      const installTargetStep = engine.state.steps.find(s => s.id === 'install-target');
      if (installTargetStep) {
        installTargetStep.status = 'completed';
      }

      broadcastSetupEvent('setup:state_change', {
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

  // --- Confirm (triggers setup phase) ---
  app.post('/api/setup/confirm', async () => {
    if (isRunning) {
      return { success: false, error: { code: 'ALREADY_RUNNING', message: 'Setup is already in progress' } };
    }

    isRunning = true;

    // Run setup phase asynchronously — progress streams via SSE
    // Setup phase now stops after scan-source, broadcasting scan_complete
    // so the UI can show the selection step.
    engine.runSetupPhase().then(() => {
      isRunning = false;
      if (engine.state.hasError) {
        broadcastSetupEvent('setup:error', {
          state: engine.state,
          context: sanitizeContext(engine.context),
        });
      } else {
        // Setup phase completed (scan-source done) — broadcast scan result
        broadcastSetupEvent('setup:scan_complete', {
          state: engine.state,
          context: sanitizeContext(engine.context),
          scanResult: engine.context.scanResult ?? null,
        });
      }
    }).catch((err) => {
      isRunning = false;
      broadcastSetupEvent('setup:error', {
        error: (err as Error).message,
        state: engine.state,
      });
    });

    return { success: true, data: { started: true } };
  });

  // --- Passcode (triggers final phase) ---
  app.post<{ Body: { passcode?: string; skip?: boolean } }>(
    '/api/setup/passcode',
    async (request) => {
      if (isRunning) {
        return { success: false, error: { code: 'ALREADY_RUNNING', message: 'Final phase is already in progress' } };
      }

      const { passcode, skip } = request.body;

      if (skip) {
        engine.context.passcodeSetup = { configured: false, skipped: true };
      } else if (passcode) {
        engine.context.passcodeValue = passcode;
      }

      isRunning = true;

      engine.runFinalPhase().then(() => {
        isRunning = false;
        broadcastSetupEvent('setup:complete', {
          state: engine.state,
          context: sanitizeContext(engine.context),
        });
      }).catch((err) => {
        isRunning = false;
        broadcastSetupEvent('setup:error', {
          error: (err as Error).message,
          state: engine.state,
        });
      });

      return { success: true, data: { started: true } };
    },
  );

  // --- Scan result (returns the scan from scan-source step) ---
  app.get('/api/setup/scan-result', async () => {
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

  // --- Select items and trigger migration phase ---
  app.post<{ Body: MigrationSelection }>(
    '/api/setup/select-items',
    async (request) => {
      if (isRunning) {
        return { success: false, error: { code: 'ALREADY_RUNNING', message: 'An operation is already in progress' } };
      }

      const { selectedSkills, selectedEnvVars } = request.body;

      // Store user's selection in context
      engine.context.migrationSelection = {
        selectedSkills: selectedSkills ?? [],
        selectedEnvVars: selectedEnvVars ?? [],
      };

      isRunning = true;

      // Run migration phase asynchronously (select-items + migrate + verify)
      engine.runMigrationPhase().then(() => {
        isRunning = false;
        if (engine.state.hasError) {
          broadcastSetupEvent('setup:error', {
            state: engine.state,
            context: sanitizeContext(engine.context),
          });
        } else {
          // Migration complete — broadcast state change so UI advances to passcode
          broadcastSetupEvent('setup:state_change', {
            state: engine.state,
            context: sanitizeContext(engine.context),
            phase: 'passcode',
          });
        }
      }).catch((err) => {
        isRunning = false;
        broadcastSetupEvent('setup:error', {
          error: (err as Error).message,
          state: engine.state,
        });
      });

      return { success: true, data: { started: true } };
    },
  );

  // --- Executables scan (using shared discovery module) ---
  let discoveryCache: { data: ReturnType<typeof scanDiscovery>; cachedAt: number } | null = null;
  const EXEC_CACHE_TTL = 60_000;

  app.get('/api/setup/executables', async () => {
    const now = Date.now();
    if (discoveryCache && now - discoveryCache.cachedAt < EXEC_CACHE_TTL) {
      const result = discoveryCache.data;
      return {
        success: true,
        data: {
          discovery: result,
          executables: result.binaries.map((b) => ({
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
        executables: result.binaries.map((b) => ({
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
}
