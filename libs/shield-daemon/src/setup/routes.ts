/**
 * Setup routes — detection, shielding, and setup completion.
 *
 * These routes are available in both setup and daemon mode,
 * but specific operations are gated by mode checks.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiResponse, DetectedTarget, OldInstallation, DetectionResult } from '@agenshield/ipc';
import { updateSetupState, loadState } from '../state';
import { emitEvent } from '../events/emitter';
import type { DaemonConfig } from '@agenshield/ipc';

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
 * Register setup API routes.
 */
export async function setupRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /setup/state — Current setup phase and detection results.
   */
  app.get('/setup/state', async (request): Promise<ApiResponse<{ mode: string; phase?: string; completed: boolean }>> => {
    const state = loadState();
    return {
      success: true,
      data: {
        mode: request.daemonMode,
        phase: state.setup?.phase,
        completed: state.setup?.completed ?? false,
      },
    };
  });

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

      // Emit progress start
      emitEvent('setup:shield_progress', {
        targetId,
        step: 'initializing',
        progress: 0,
        message: 'Preparing to shield target...',
      });

      try {
        // Update phase
        updateSetupState({ phase: 'shielding' });

        // TODO: Integrate with actual shielding engine from setup-engine package.
        // For now, emit progress events to demonstrate the SSE flow.
        emitEvent('setup:shield_progress', {
          targetId,
          step: 'creating_profile',
          progress: 25,
          message: 'Creating profile...',
        });

        emitEvent('setup:shield_progress', {
          targetId,
          step: 'installing_wrappers',
          progress: 50,
          message: 'Installing command wrappers...',
        });

        emitEvent('setup:shield_progress', {
          targetId,
          step: 'configuring_policies',
          progress: 75,
          message: 'Configuring policies...',
        });

        const profileId = `profile-${targetId}`;

        emitEvent('setup:shield_progress', {
          targetId,
          step: 'complete',
          progress: 100,
          message: 'Shielding complete',
        });

        emitEvent('setup:shield_complete', { targetId, profileId });

        return {
          success: true,
          data: { targetId, profileId },
        };
      } catch (err) {
        emitEvent('setup:error', {
          error: (err as Error).message,
          targetId,
        });
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
      // TODO: Integrate with cleanup engine from setup-engine package.
      // Detection of old installation artifacts (ash_* users, groups, dirs)
      // and removal via the same logic as the CLI cleanup-previous step.
      return {
        success: true,
        data: { replaced: true },
      };
    } catch (err) {
      return reply.code(500).send({
        success: false,
        error: { message: (err as Error).message, statusCode: 500 },
      });
    }
  });

  /**
   * POST /setup/complete — Mark setup as complete and start full daemon services.
   */
  app.post('/setup/complete', async (request, reply): Promise<ApiResponse<{ mode: string }>> => {
    if (!requireSetupMode(request, reply)) return reply;

    // Mark setup as completed in DB
    updateSetupState({ completed: true, phase: 'complete' });

    // Start full daemon services
    try {
      const { startDaemonServices } = await import('../server.js');
      const config = getDaemonConfig();
      await startDaemonServices(app, config);
    } catch (err) {
      console.error('[Setup] Failed to start daemon services:', (err as Error).message);
    }

    // Broadcast mode transition
    emitEvent('setup:complete', {});

    return {
      success: true,
      data: { mode: 'daemon' },
    };
  });
}

// ── Detection helpers ──────────────────────────────────────────

/**
 * Detect available targets on the system.
 * Uses the preset system from @agenshield/sandbox.
 */
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
            shielded: false, // TODO: cross-reference with existing profiles
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

/**
 * Detect old AgenShield installations on the system.
 * Checks for ash_* macOS users and known directories.
 */
async function detectOldInstallations(): Promise<OldInstallation[]> {
  const installations: OldInstallation[] = [];

  try {
    const { execSync } = await import('node:child_process');
    const fs = await import('node:fs');

    // Check for sentinel user
    try {
      execSync('dscl . -read /Users/ash_default_agent', { stdio: 'pipe' });
    } catch {
      return installations; // No old installation
    }

    // Discover ash_* users
    const users: string[] = [];
    try {
      const output = execSync('dscl . -list /Users', { encoding: 'utf-8' });
      for (const line of output.split('\n')) {
        const username = line.trim();
        if (username.startsWith('ash_')) {
          users.push(username);
        }
      }
    } catch { /* ignore */ }

    // Discover ash_* groups
    const groups: string[] = [];
    try {
      const output = execSync('dscl . -list /Groups', { encoding: 'utf-8' });
      for (const line of output.split('\n')) {
        const name = line.trim();
        if (name.startsWith('ash_')) {
          groups.push(name);
        }
      }
    } catch { /* ignore */ }

    // Check known directories
    const directories: string[] = [];
    const knownDirs = ['/opt/agenshield', '/etc/agenshield', '/var/run/agenshield', '/var/log/agenshield'];
    for (const dir of knownDirs) {
      if (fs.existsSync(dir)) {
        directories.push(dir);
      }
    }

    // Check LaunchDaemon plists
    const launchDaemons: string[] = [];
    const plistDir = '/Library/LaunchDaemons';
    if (fs.existsSync(plistDir)) {
      try {
        const files = fs.readdirSync(plistDir);
        for (const file of files) {
          if (file.startsWith('com.agenshield.')) {
            launchDaemons.push(file);
          }
        }
      } catch { /* ignore */ }
    }

    // Check for version info
    let version = 'unknown';
    try {
      const migrationsPath = '/etc/agenshield/migrations.json';
      if (fs.existsSync(migrationsPath)) {
        const data = JSON.parse(fs.readFileSync(migrationsPath, 'utf-8'));
        version = data.version ?? 'unknown';
      }
    } catch { /* ignore */ }

    if (users.length > 0 || directories.length > 0) {
      installations.push({
        version,
        components: { users, groups, directories, launchDaemons },
      });
    }
  } catch {
    // Detection failed — return empty
  }

  return installations;
}

/**
 * Get daemon config from the loader.
 */
function getDaemonConfig(): DaemonConfig {
  // Dynamic import to avoid circular dependency at module load time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadConfig } = require('../config/loader');
  return loadConfig() as DaemonConfig;
}
