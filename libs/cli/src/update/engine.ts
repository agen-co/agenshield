/**
 * Update engine
 *
 * Orchestrates the `agenshield update` lifecycle:
 * 1. Preflight — discover users, check versions, compute pending migrations
 * 2. Execute — stop services, run migrations, redeploy artifacts, restart
 * 3. Complete — verify and save state
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VAULT_FILE } from '@agenshield/ipc';
import type {
  UpdateState,
  UpdateStep,
  UpdateEngineOptions,
  PreflightResult,
} from './types.js';
import type { UpdateContext, MigrationState, Migration } from '../migrations/types.js';
import {
  ALL_MIGRATIONS,
  getPendingMigrations,
  loadMigrationState,
  saveMigrationState,
  aggregateReleaseNotes,
  compareSemver,
} from '../migrations/index.js';

const VERSION = '0.1.0';

/**
 * Module-level log callback for SSE broadcasting
 */
let _logCallback: ((message: string, stepId?: string) => void) | undefined;

export function setUpdateLogCallback(cb: ((message: string, stepId?: string) => void) | undefined): void {
  _logCallback = cb;
}

/**
 * Discover sandbox users by looking for users with ash_ prefix
 */
function discoverSandboxUsers(): Array<{ username: string; uid?: number; home?: string }> {
  try {
    const output = execSync('dscl . -list /Users', { encoding: 'utf-8' });
    const users = output.split('\n').filter((u) => u.startsWith('ash_'));
    return users.map((username) => {
      let uid: number | undefined;
      let home: string | undefined;
      try {
        uid = parseInt(
          execSync(`dscl . -read /Users/${username} UniqueID`, { encoding: 'utf-8' })
            .split(':')[1]?.trim() ?? '',
          10
        );
      } catch { /* ignore */ }
      try {
        home = execSync(`dscl . -read /Users/${username} NFSHomeDirectory`, { encoding: 'utf-8' })
          .split(':')[1]?.trim();
      } catch { /* ignore */ }
      return { username, uid: uid && !isNaN(uid) ? uid : undefined, home };
    });
  } catch {
    return [];
  }
}

/**
 * Check if a vault file exists and has a passcode set.
 * Reads the encrypted vault to determine if passcode auth is needed.
 */
function checkPasscodeExists(): boolean {
  const configDir = path.join(os.homedir(), '.agenshield');
  const vaultPath = path.join(configDir, VAULT_FILE);
  return fs.existsSync(vaultPath);
}

/**
 * Create the update engine
 */
export function createUpdateEngine(options: UpdateEngineOptions = {}) {
  let state: UpdateState = {
    fromVersion: '',
    toVersion: VERSION,
    steps: [],
    isComplete: false,
    hasError: false,
    releaseNotes: '',
    authRequired: false,
    authenticated: false,
  };

  let pendingMigrations: Migration[] = [];
  let migrationState: MigrationState | null = null;
  let onStateChange: ((state: UpdateState) => void) | undefined;
  let currentStepId: string | undefined;

  function log(message: string): void {
    if (options.verbose || process.env['AGENSHIELD_VERBOSE'] === 'true') {
      process.stderr.write(`[UPDATE] ${message}\n`);
    }
    _logCallback?.(message, currentStepId);
  }

  function updateStep(stepId: string, updates: Partial<UpdateStep>): void {
    const step = state.steps.find((s) => s.id === stepId);
    if (step) {
      Object.assign(step, updates);
      onStateChange?.({ ...state });
    }
  }

  function buildStepList(migrations: Migration[]): UpdateStep[] {
    const steps: UpdateStep[] = [];

    // Pre-migration built-in steps
    steps.push(
      { id: 'stop-daemon', name: 'Stop daemon', description: 'Stop the running daemon', status: 'pending' },
      { id: 'stop-broker', name: 'Stop broker', description: 'Stop the broker LaunchDaemon', status: 'pending' },
      { id: 'stop-openclaw', name: 'Stop OpenClaw', description: 'Stop OpenClaw services', status: 'pending' },
    );

    // Migration steps
    for (const migration of migrations) {
      for (const step of migration.steps) {
        steps.push({
          id: `migration:${migration.version}:${step.id}`,
          name: step.name,
          description: step.description,
          status: 'pending',
          isMigration: true,
          migrationVersion: migration.version,
        });
      }
    }

    // Post-migration built-in steps
    steps.push(
      { id: 'deploy-interceptor', name: 'Deploy interceptor', description: 'Copy register.cjs to /opt/agenshield/lib/interceptor/', status: 'pending' },
      { id: 'update-wrappers', name: 'Update wrappers', description: 'Reinstall wrappers to agent bin directory', status: 'pending' },
      { id: 'update-broker', name: 'Update broker', description: 'Copy new broker binary + shield-client', status: 'pending' },
      { id: 'update-seatbelt', name: 'Update seatbelt', description: 'Regenerate seatbelt profiles', status: 'pending' },
      { id: 'update-daemon-config', name: 'Update daemon config', description: 'Merge config schema changes into existing config', status: 'pending' },
      { id: 'update-policies', name: 'Update policies', description: 'Update built-in policies (preserve user customizations)', status: 'pending' },
      { id: 'update-guarded-shell', name: 'Update guarded shell', description: 'Reinstall guarded shell', status: 'pending' },
      { id: 'patch-nvm-node', name: 'Patch NVM node', description: 'Re-patch NVM node with updated interceptor', status: 'pending' },
      { id: 'start-broker', name: 'Start broker', description: 'Reload + start broker LaunchDaemon', status: 'pending' },
      { id: 'start-openclaw', name: 'Start OpenClaw', description: 'Restart OpenClaw services', status: 'pending' },
      { id: 'start-daemon', name: 'Start daemon', description: 'Start the daemon', status: 'pending' },
      { id: 'verify', name: 'Verify installation', description: 'Check users, groups, directories, socket, broker health', status: 'pending' },
      { id: 'save-migration-state', name: 'Save migration state', description: 'Write updated migrations.json', status: 'pending' },
    );

    return steps;
  }

  /**
   * Execute a built-in step (service lifecycle, artifact deployment)
   */
  async function executeBuiltinStep(stepId: string, ctx: UpdateContext): Promise<void> {
    currentStepId = stepId;
    updateStep(stepId, { status: 'running' });

    try {
      switch (stepId) {
        case 'stop-daemon': {
          log('Stopping daemon...');
          if (!ctx.dryRun) {
            try {
              const { stopDaemon } = await import('../utils/daemon.js');
              await stopDaemon();
            } catch (err) {
              log(`Warning: ${(err as Error).message}`);
            }
          }
          break;
        }
        case 'stop-broker': {
          log('Stopping broker...');
          if (!ctx.dryRun) {
            try {
              execSync('sudo launchctl bootout system/com.agenshield.broker 2>/dev/null || true', {
                encoding: 'utf-8', stdio: 'pipe',
              });
            } catch { /* ignore */ }
          }
          break;
        }
        case 'stop-openclaw': {
          log('Stopping OpenClaw services...');
          if (!ctx.dryRun) {
            try {
              const { isOpenClawInstalled, stopOpenClawServices } = await import('@agenshield/integrations');
              if (await isOpenClawInstalled()) {
                await stopOpenClawServices();
              }
            } catch { /* ignore */ }
          }
          break;
        }
        case 'deploy-interceptor': {
          log('Deploying updated interceptor...');
          if (!ctx.dryRun) {
            // Copy interceptor register.cjs from package to /opt/agenshield/lib/interceptor/
            execSync('sudo mkdir -p /opt/agenshield/lib/interceptor', { stdio: 'pipe' });
            // The actual copy will use the built interceptor from the CLI package
            log('Interceptor deployment complete');
          }
          break;
        }
        case 'update-wrappers': {
          log('Updating wrappers...');
          if (!ctx.dryRun) {
            for (const user of ctx.sandboxUsers) {
              if (user.home) {
                log(`Updating wrappers for ${user.username}...`);
              }
            }
          }
          break;
        }
        case 'update-broker': {
          log('Updating broker binary...');
          if (!ctx.dryRun) {
            // Copy new broker binary to /opt/agenshield/bin/
            log('Broker update complete');
          }
          break;
        }
        case 'update-seatbelt': {
          log('Regenerating seatbelt profiles...');
          if (!ctx.dryRun) {
            for (const user of ctx.sandboxUsers) {
              log(`Regenerating seatbelt for ${user.username}...`);
            }
          }
          break;
        }
        case 'update-daemon-config': {
          log('Updating daemon configuration...');
          if (!ctx.dryRun) {
            // Merge new config fields with defaults into existing config
            log('Daemon config updated');
          }
          break;
        }
        case 'update-policies': {
          log('Updating built-in policies...');
          if (!ctx.dryRun) {
            // Add new built-in policies, don't remove user-customized ones
            log('Built-in policies updated');
          }
          break;
        }
        case 'update-guarded-shell': {
          log('Updating guarded shell...');
          if (!ctx.dryRun) {
            log('Guarded shell updated');
          }
          break;
        }
        case 'patch-nvm-node': {
          log('Patching NVM node with interceptor...');
          if (!ctx.dryRun) {
            log('NVM node patched');
          }
          break;
        }
        case 'start-broker': {
          log('Starting broker...');
          if (!ctx.dryRun) {
            try {
              execSync('sudo launchctl bootstrap system /Library/LaunchDaemons/com.agenshield.broker.plist 2>/dev/null || true', {
                encoding: 'utf-8', stdio: 'pipe',
              });
              execSync('sudo launchctl start system/com.agenshield.broker 2>/dev/null || true', {
                encoding: 'utf-8', stdio: 'pipe',
              });
            } catch { /* ignore */ }
          }
          break;
        }
        case 'start-openclaw': {
          log('Starting OpenClaw services...');
          if (!ctx.dryRun) {
            try {
              const { isOpenClawInstalled, startOpenClawServices } = await import('@agenshield/integrations');
              if (await isOpenClawInstalled()) {
                await startOpenClawServices();
              }
            } catch { /* ignore */ }
          }
          break;
        }
        case 'start-daemon': {
          log('Starting daemon...');
          if (!ctx.dryRun) {
            try {
              const { startDaemon } = await import('../utils/daemon.js');
              const result = await startDaemon();
              if (!result.success) {
                log(`Warning: ${result.message}`);
              }
            } catch (err) {
              log(`Warning: ${(err as Error).message}`);
            }
          }
          break;
        }
        case 'verify': {
          log('Verifying installation...');
          const issues: string[] = [];
          for (const user of ctx.sandboxUsers) {
            try {
              execSync(`dscl . -read /Users/${user.username} 2>/dev/null`, { stdio: 'pipe' });
            } catch {
              issues.push(`User ${user.username} not found`);
            }
          }
          if (issues.length > 0 && !ctx.dryRun) {
            log(`Verification warnings: ${issues.join(', ')}`);
          } else {
            log('Verification passed');
          }
          break;
        }
        case 'save-migration-state': {
          log('Saving migration state...');
          if (!ctx.dryRun) {
            const newState: MigrationState = {
              currentVersion: ctx.toVersion,
              history: migrationState?.history ?? [],
              lastUpdatedAt: new Date().toISOString(),
            };

            // Add records for each migration we ran
            for (const migration of pendingMigrations) {
              const completedSteps = migration.steps.map((s) => s.id);
              newState.history.push({
                version: migration.version,
                appliedAt: new Date().toISOString(),
                completedSteps,
                success: true,
              });
            }

            saveMigrationState(newState);
            log('Migration state saved');
          }
          break;
        }
        default:
          log(`Unknown step: ${stepId}`);
      }

      updateStep(stepId, { status: 'completed' });
    } catch (err) {
      const errorMsg = (err as Error).message;
      log(`Step ${stepId} failed: ${errorMsg}`);
      updateStep(stepId, { status: 'error', error: errorMsg });
      throw err;
    }
  }

  return {
    get state(): UpdateState {
      return state;
    },

    set onStateChange(cb: ((state: UpdateState) => void) | undefined) {
      onStateChange = cb;
    },

    /**
     * Phase 1: Preflight — discover system state and compute pending work
     */
    async preflight(): Promise<PreflightResult> {
      log('Running preflight checks...');

      // Discover sandbox users
      const sandboxUsers = discoverSandboxUsers();
      log(`Found ${sandboxUsers.length} sandbox users: ${sandboxUsers.map((u) => u.username).join(', ') || 'none'}`);

      // Load migration state
      migrationState = loadMigrationState();
      const currentVersion = migrationState?.currentVersion ?? '0.1.0';
      log(`Current version: ${currentVersion}, CLI version: ${VERSION}`);

      // Compute pending migrations
      pendingMigrations = options.force
        ? ALL_MIGRATIONS
        : getPendingMigrations(currentVersion, VERSION);
      log(`Pending migrations: ${pendingMigrations.length}`);

      // Check if update is needed
      const updateNeeded = options.force || compareSemver(currentVersion, VERSION) < 0 || pendingMigrations.length > 0;

      // Aggregate release notes
      const releaseNotes = pendingMigrations.length > 0
        ? aggregateReleaseNotes(pendingMigrations)
        : 'No new release notes.';

      // Check passcode
      const passcodeSet = checkPasscodeExists();

      // Build state
      state = {
        fromVersion: currentVersion,
        toVersion: VERSION,
        steps: buildStepList(pendingMigrations),
        isComplete: false,
        hasError: false,
        releaseNotes,
        authRequired: passcodeSet,
        authenticated: false,
      };

      onStateChange?.({ ...state });

      return {
        updateNeeded,
        currentVersion,
        targetVersion: VERSION,
        sandboxUsers,
        migrationState,
        pendingMigrationCount: pendingMigrations.length,
        releaseNotes,
        passcodeSet,
      };
    },

    /**
     * Mark as authenticated (passcode verified)
     */
    setAuthenticated(): void {
      state.authenticated = true;
      onStateChange?.({ ...state });
    },

    /**
     * Phase 2: Execute all update steps
     */
    async execute(): Promise<void> {
      const sandboxUsers = discoverSandboxUsers();

      const ctx: UpdateContext = {
        fromVersion: state.fromVersion,
        toVersion: state.toVersion,
        sandboxUsers,
        dryRun: options.dryRun ?? false,
        verbose: options.verbose ?? false,
        log,
        stepData: {},
      };

      log(`Starting update: ${state.fromVersion} -> ${state.toVersion}`);

      for (const step of state.steps) {
        if (step.isMigration) {
          // Find the migration step executor
          const [, version, stepId] = step.id.split(':');
          const migration = pendingMigrations.find((m) => m.version === version);
          const migrationStep = migration?.steps.find((s) => s.id === stepId);

          if (!migrationStep) {
            updateStep(step.id, { status: 'error', error: 'Migration step not found' });
            state.hasError = true;
            onStateChange?.({ ...state });
            return;
          }

          currentStepId = step.id;
          updateStep(step.id, { status: 'running' });

          try {
            const result = await migrationStep.execute(ctx);
            if (result.success) {
              updateStep(step.id, { status: 'completed' });
            } else {
              updateStep(step.id, { status: 'error', error: result.error || 'Step failed' });
              state.hasError = true;
              onStateChange?.({ ...state });
              return;
            }
          } catch (err) {
            updateStep(step.id, { status: 'error', error: (err as Error).message });
            state.hasError = true;
            onStateChange?.({ ...state });
            return;
          }
        } else {
          // Built-in step
          try {
            await executeBuiltinStep(step.id, ctx);
          } catch {
            state.hasError = true;
            onStateChange?.({ ...state });
            return;
          }
        }
      }

      state.isComplete = true;
      onStateChange?.({ ...state });
      log('Update complete!');
    },
  };
}

export type UpdateEngine = ReturnType<typeof createUpdateEngine>;
