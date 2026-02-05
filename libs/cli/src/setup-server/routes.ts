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
} from '@agenshield/sandbox';
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

    if (engine.state.isComplete || hasComplete?.status === 'completed') {
      phase = 'complete';
    } else if (engine.state.steps.find(s => s.id === 'setup-passcode')?.status === 'running') {
      phase = 'passcode';
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

  // --- Confirm (triggers setup phase) ---
  app.post('/api/setup/confirm', async () => {
    if (isRunning) {
      return { success: false, error: { code: 'ALREADY_RUNNING', message: 'Setup is already in progress' } };
    }

    isRunning = true;

    // Run setup phase asynchronously — progress streams via SSE
    engine.runSetupPhase().then(() => {
      isRunning = false;
      if (engine.state.hasError) {
        broadcastSetupEvent('setup:error', {
          state: engine.state,
          context: sanitizeContext(engine.context),
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
