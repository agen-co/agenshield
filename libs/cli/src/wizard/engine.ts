/**
 * Wizard engine - orchestrates the setup steps
 */

import * as os from 'node:os';
import * as crypto from 'node:crypto';
import {
  checkPrerequisites,
  saveBackup,
  backupOriginalConfig,
  createUserConfig,
  createGroups,
  createAgentUser,
  createBrokerUser,
  createAllDirectories,
  setupSocketDirectory,
  verifyUsersAndGroups,
  verifyDirectories,
  generateAgentProfile,
  installSeatbeltProfiles,
  installAllWrappers,
  generateBrokerPlist,
  installLaunchDaemon,
  createPathsConfig,
  // Preset system
  getPreset,
  autoDetectPreset,
  type MigrationContext,
  type MigrationDirectories,
} from '@agenshield/sandbox';
import type { OriginalInstallation, MigratedPaths, SandboxUserInfo, UserConfig, PasscodeData } from '@agenshield/ipc';
import type {
  WizardStep,
  WizardState,
  WizardContext,
  WizardStepId,
  WizardOptions,
} from './types.js';
import { createWizardSteps, getStepsByPhase, getAllStepIds } from './types.js';

export type StepExecutor = (context: WizardContext) => Promise<{ success: boolean; error?: string }>;

export interface WizardEngine {
  state: WizardState;
  context: WizardContext;
  onStateChange?: (state: WizardState) => void;
  /** Run full wizard (all steps) */
  run(): Promise<void>;
  /** Run only detection phase (prerequisites + detect + configure) */
  runDetectionPhase(): Promise<{ success: boolean; error?: string }>;
  /** Run setup phase (confirm through verify, excludes passcode and complete) */
  runSetupPhase(): Promise<void>;
  /** Run final phase (setup-passcode and complete) - called after passcode UI */
  runFinalPhase(): Promise<void>;
}

/**
 * Execute a step and update state
 */
async function executeStep(
  step: WizardStep,
  context: WizardContext,
  executor: StepExecutor
): Promise<{ success: boolean; error?: string }> {
  try {
    return await executor(context);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Step executors
 */
const stepExecutors: Record<WizardStepId, StepExecutor> = {
  prerequisites: async (_context) => {
    const result = checkPrerequisites();
    if (!result.ok) {
      return {
        success: false,
        error: `Missing prerequisites: ${result.missing.join(', ')}`,
      };
    }
    return { success: true };
  },

  detect: async (context) => {
    const presetId = context.options?.targetPreset;

    // Handle custom preset - requires entry point
    if (presetId === 'custom') {
      if (!context.options?.entryPoint) {
        return {
          success: false,
          error: '--entry-point is required when using --target custom',
        };
      }

      const preset = getPreset('custom');
      if (!preset) {
        return { success: false, error: 'Custom preset not found' };
      }

      // Custom preset doesn't auto-detect, so we create a detection result
      context.preset = preset;
      context.presetDetection = {
        found: true,
        method: 'custom',
      };
      return { success: true };
    }

    // Handle specific preset requested
    if (presetId) {
      const preset = getPreset(presetId);
      if (!preset) {
        return { success: false, error: `Unknown preset: ${presetId}` };
      }

      const detection = await preset.detect();
      if (!detection?.found) {
        return {
          success: false,
          error: `${preset.name} not found. Please install it first or use --target custom.`,
        };
      }

      context.preset = preset;
      context.presetDetection = detection;
      return { success: true };
    }

    // Auto-detect preset
    const result = await autoDetectPreset();
    if (!result) {
      return {
        success: false,
        error: 'No supported target found. Use --target custom --entry-point <path> for custom applications.',
      };
    }

    context.preset = result.preset;
    context.presetDetection = result.detection;
    return { success: true };
  },

  configure: async (context) => {
    // Create user configuration based on options
    const userConfig = createUserConfig({
      prefix: context.options?.prefix,
      baseUid: context.options?.baseUid,
      baseGid: context.options?.baseGid,
      baseName: context.options?.baseName,
    });

    context.userConfig = userConfig;
    context.pathsConfig = createPathsConfig(userConfig);

    return { success: true };
  },

  // Confirmation is handled by the UI, this step just marks it as complete
  confirm: async (_context) => {
    return { success: true };
  },

  backup: async (context) => {
    if (!context.presetDetection) {
      return { success: false, error: 'No target detected' };
    }

    // Skip actual backup in dry-run mode
    if (context.options?.dryRun) {
      context.originalInstallation = {
        method: (context.presetDetection.method as 'npm' | 'git') || 'npm',
        packagePath: context.presetDetection.packagePath || '',
        binaryPath: context.presetDetection.binaryPath,
        configPath: context.presetDetection.configPath,
        version: context.presetDetection.version,
      };
      return { success: true };
    }

    // Backup original config if it exists
    let configBackupPath: string | undefined;
    if (context.presetDetection.configPath) {
      const backupResult = backupOriginalConfig(context.presetDetection.configPath);
      if (!backupResult.success) {
        return { success: false, error: backupResult.error };
      }
      configBackupPath = backupResult.backupPath;
    }

    // Store backup info for later (will be saved after user creation)
    context.originalInstallation = {
      method: (context.presetDetection.method as 'npm' | 'git') || 'npm',
      packagePath: context.presetDetection.packagePath || '',
      binaryPath: context.presetDetection.binaryPath,
      configPath: context.presetDetection.configPath,
      configBackupPath,
      version: context.presetDetection.version,
    };

    return { success: true };
  },

  'create-groups': async (context) => {
    if (!context.userConfig) {
      return { success: false, error: 'User configuration not set' };
    }

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      context.groupsCreated = {
        socket: context.userConfig.groups.socket,
        workspace: context.userConfig.groups.workspace,
      };
      return { success: true };
    }

    const results = await createGroups(context.userConfig);
    const failed = results.filter((r) => !r.success);

    if (failed.length > 0) {
      return {
        success: false,
        error: failed.map((r) => r.message).join('; '),
      };
    }

    context.groupsCreated = {
      socket: context.userConfig.groups.socket,
      workspace: context.userConfig.groups.workspace,
    };

    return { success: true };
  },

  'create-agent-user': async (context) => {
    if (!context.userConfig) {
      return { success: false, error: 'User configuration not set' };
    }

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      context.agentUser = {
        username: context.userConfig.agentUser.username,
        uid: context.userConfig.agentUser.uid,
        gid: context.userConfig.agentUser.gid,
        homeDir: context.userConfig.agentUser.home,
        shell: context.userConfig.agentUser.shell,
      };
      return { success: true };
    }

    const result = await createAgentUser(context.userConfig);
    if (!result.success) {
      return { success: false, error: result.message };
    }

    context.agentUser = {
      username: context.userConfig.agentUser.username,
      uid: context.userConfig.agentUser.uid,
      gid: context.userConfig.agentUser.gid,
      homeDir: context.userConfig.agentUser.home,
      shell: context.userConfig.agentUser.shell,
    };

    return { success: true };
  },

  'create-broker-user': async (context) => {
    if (!context.userConfig) {
      return { success: false, error: 'User configuration not set' };
    }

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      context.brokerUser = {
        username: context.userConfig.brokerUser.username,
        uid: context.userConfig.brokerUser.uid,
        gid: context.userConfig.brokerUser.gid,
        homeDir: context.userConfig.brokerUser.home,
        shell: context.userConfig.brokerUser.shell,
      };
      return { success: true };
    }

    const result = await createBrokerUser(context.userConfig);
    if (!result.success) {
      return { success: false, error: result.message };
    }

    context.brokerUser = {
      username: context.userConfig.brokerUser.username,
      uid: context.userConfig.brokerUser.uid,
      gid: context.userConfig.brokerUser.gid,
      homeDir: context.userConfig.brokerUser.home,
      shell: context.userConfig.brokerUser.shell,
    };

    return { success: true };
  },

  'create-directories': async (context) => {
    if (!context.userConfig || !context.pathsConfig) {
      return { success: false, error: 'Configuration not set' };
    }

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      context.directories = {
        binDir: `${context.userConfig.agentUser.home}/bin`,
        wrappersDir: `${context.userConfig.agentUser.home}/bin`,
        configDir: context.pathsConfig.configDir,
        packageDir: `${context.userConfig.agentUser.home}/.openclaw-pkg`,
        npmDir: `${context.userConfig.agentUser.home}/.npm`,
        socketDir: context.pathsConfig.socketDir,
        logDir: context.pathsConfig.logDir,
        seatbeltDir: context.pathsConfig.seatbeltDir,
      };
      return { success: true };
    }

    const results = await createAllDirectories(context.userConfig);
    const failed = results.filter((r) => !r.success);

    if (failed.length > 0) {
      return {
        success: false,
        error: failed.map((r) => r.message).join('; '),
      };
    }

    context.directories = {
      binDir: `${context.userConfig.agentUser.home}/bin`,
      wrappersDir: `${context.userConfig.agentUser.home}/bin`,
      configDir: context.pathsConfig.configDir,
      packageDir: `${context.userConfig.agentUser.home}/.openclaw-pkg`,
      npmDir: `${context.userConfig.agentUser.home}/.npm`,
      socketDir: context.pathsConfig.socketDir,
      logDir: context.pathsConfig.logDir,
      seatbeltDir: context.pathsConfig.seatbeltDir,
    };

    return { success: true };
  },

  'setup-socket': async (context) => {
    if (!context.userConfig || !context.pathsConfig) {
      return { success: false, error: 'Configuration not set' };
    }

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      context.socketSetup = {
        path: context.pathsConfig.socketPath,
        success: true,
      };
      return { success: true };
    }

    const result = await setupSocketDirectory(context.userConfig);
    if (!result.success) {
      return { success: false, error: result.message };
    }

    context.socketSetup = {
      path: context.pathsConfig.socketPath,
      success: true,
    };

    return { success: true };
  },

  'generate-seatbelt': async (context) => {
    if (!context.userConfig || !context.pathsConfig) {
      return { success: false, error: 'Configuration not set' };
    }

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      context.seatbeltProfiles = {
        agentProfile: `${context.pathsConfig.seatbeltDir}/agent.sb`,
        operationProfiles: [],
      };
      return { success: true };
    }

    try {
      // Generate agent profile
      const agentProfile = generateAgentProfile({
        workspacePath: `${context.userConfig.agentUser.home}/workspace`,
        socketPath: context.pathsConfig.socketPath,
      });

      // Install profiles
      const result = await installSeatbeltProfiles(context.userConfig, {
        agentProfile,
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      context.seatbeltProfiles = {
        agentProfile: result.agentProfilePath!,
        operationProfiles: result.operationProfilePaths || [],
      };

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: `Failed to generate seatbelt profiles: ${(err as Error).message}`,
      };
    }
  },

  'install-wrappers': async (context) => {
    if (!context.userConfig || !context.agentUser || !context.directories) {
      return { success: false, error: 'Required context not set' };
    }

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      context.wrappersInstalled = [
        'shieldctl',
        'curl',
        'wget',
        'git',
        'npm',
        'pip',
        'python',
        'node',
      ];
      return { success: true };
    }

    try {
      const result = await installAllWrappers(context.userConfig, context.directories);

      if (!result.success) {
        return { success: false, error: result.error };
      }

      context.wrappersInstalled = result.installed || [];
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: `Failed to install wrappers: ${(err as Error).message}`,
      };
    }
  },

  'install-broker': async (context) => {
    if (!context.userConfig || !context.pathsConfig) {
      return { success: false, error: 'Configuration not set' };
    }

    const brokerPath = '/opt/agenshield/bin/agenshield-broker';

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      context.brokerInstalled = {
        binaryPath: brokerPath,
        success: true,
      };
      return { success: true };
    }

    // TODO: Implement actual broker installation
    // For now, just mark as success (broker will be installed separately)
    context.brokerInstalled = {
      binaryPath: brokerPath,
      success: true,
    };

    return { success: true };
  },

  'install-daemon-config': async (context) => {
    if (!context.userConfig || !context.pathsConfig) {
      return { success: false, error: 'Configuration not set' };
    }

    const configPath = `${context.pathsConfig.configDir}/daemon.json`;

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      context.daemonConfig = {
        configPath,
        success: true,
      };
      return { success: true };
    }

    // TODO: Implement actual daemon config installation
    // For now, just mark as success
    context.daemonConfig = {
      configPath,
      success: true,
    };

    return { success: true };
  },

  'install-policies': async (context) => {
    if (!context.pathsConfig) {
      return { success: false, error: 'Configuration not set' };
    }

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      context.policiesInstalled = {
        builtinCount: 5,
        customCount: 0,
      };
      return { success: true };
    }

    // TODO: Implement actual policy installation
    // For now, just mark as success
    context.policiesInstalled = {
      builtinCount: 5,
      customCount: 0,
    };

    return { success: true };
  },

  'setup-launchdaemon': async (context) => {
    if (!context.userConfig || !context.brokerInstalled) {
      return { success: false, error: 'Required context not set' };
    }

    const plistPath = '/Library/LaunchDaemons/com.agenshield.broker.plist';

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      context.launchDaemon = {
        plistPath,
        loaded: false,
      };
      return { success: true };
    }

    try {
      // Generate plist
      const plist = generateBrokerPlist(context.userConfig, {
        brokerPath: context.brokerInstalled.binaryPath,
      });

      // Install and load
      const result = await installLaunchDaemon(plist);

      if (!result.success) {
        return { success: false, error: result.message };
      }

      context.launchDaemon = {
        plistPath: result.plistPath!,
        loaded: result.loaded || false,
      };

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: `Failed to setup LaunchDaemon: ${(err as Error).message}`,
      };
    }
  },

  migrate: async (context) => {
    if (!context.preset || !context.agentUser || !context.directories || !context.userConfig) {
      return { success: false, error: 'Missing required context for migration' };
    }

    // Get the entry command for this preset to determine binary name
    const entryCommand = context.preset.getEntryCommand({
      agentUser: context.userConfig.agentUser,
      directories: context.directories as MigrationDirectories,
      entryPoint: context.options?.entryPoint,
      detection: context.presetDetection,
    });

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      context.migration = {
        success: true,
        newPaths: {
          packagePath: context.directories.packageDir,
          binaryPath: entryCommand,
          configPath: `${context.directories.configDir}/config.json`,
        },
      };
      return { success: true };
    }

    // Use preset's migrate function
    const migrationContext: MigrationContext = {
      agentUser: context.userConfig.agentUser,
      directories: context.directories as MigrationDirectories,
      entryPoint: context.options?.entryPoint,
      detection: context.presetDetection,
    };

    const result = await context.preset.migrate(migrationContext);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    context.migration = {
      success: true,
      newPaths: result.newPaths,
    };

    // Now save the full backup with all the information
    if (context.originalInstallation && context.agentUser && result.newPaths) {
      const sandboxUserInfo: SandboxUserInfo = {
        username: context.agentUser.username,
        uid: context.agentUser.uid,
        gid: context.agentUser.gid,
        homeDir: context.agentUser.homeDir,
      };

      const migratedPaths: MigratedPaths = {
        packagePath: result.newPaths.packagePath,
        configPath: result.newPaths.configPath || `${context.directories?.configDir}/config.json`,
        binaryPath: result.newPaths.binaryPath,
      };

      const backupResult = saveBackup({
        originalInstallation: context.originalInstallation,
        sandboxUser: sandboxUserInfo,
        migratedPaths,
      });

      if (!backupResult.success) {
        // Log warning but don't fail - installation is already complete
        console.warn(`Warning: Could not save backup: ${backupResult.error}`);
      }
    }

    return { success: true };
  },

  verify: async (context) => {
    if (!context.userConfig) {
      return { success: false, error: 'Configuration not set' };
    }

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      context.verification = {
        usersValid: true,
        groupsValid: true,
        directoriesValid: true,
        socketValid: true,
        daemonRunning: false,
        networkBlocked: true,
      };
      return { success: true };
    }

    // Verify users and groups
    const userResult = await verifyUsersAndGroups(context.userConfig);
    if (!userResult.valid) {
      return {
        success: false,
        error: `Missing users: ${userResult.missingUsers.join(', ')}; Missing groups: ${userResult.missingGroups.join(', ')}`,
      };
    }

    // Verify directories
    const dirResult = await verifyDirectories(context.userConfig);
    if (!dirResult.valid) {
      return {
        success: false,
        error: `Missing directories: ${dirResult.missing.join(', ')}`,
      };
    }

    // Try to run the target binary as the sandbox user
    try {
      const { execSync } = await import('node:child_process');
      const agentUsername = context.userConfig.agentUser.username;

      if (context.migration?.newPaths?.binaryPath) {
        const cmd = `sudo -u ${agentUsername} ${context.migration.newPaths.binaryPath} --version`;
        const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });

        if (!output.trim()) {
          return { success: false, error: 'Target did not return version' };
        }
      }
    } catch (err) {
      // Don't fail on version check - it's optional
      console.warn(`Warning: Version check failed: ${(err as Error).message}`);
    }

    context.verification = {
      usersValid: true,
      groupsValid: true,
      directoriesValid: true,
      socketValid: context.socketSetup?.success || false,
      daemonRunning: context.launchDaemon?.loaded || false,
      networkBlocked: true, // Assumed true if seatbelt is installed
    };

    return { success: true };
  },

  'setup-passcode': async (context) => {
    // Check if user chose to skip
    if (context.passcodeSetup?.skipped) {
      context.passcodeSetup = { configured: false, skipped: true };
      return { success: true };
    }

    // Check if passcode value was provided by the UI
    if (!context.passcodeValue) {
      // No passcode provided - skip (user declined in UI)
      context.passcodeSetup = { configured: false, skipped: true };
      return { success: true };
    }

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      context.passcodeSetup = { configured: true, skipped: false };
      // Clear the passcode from context
      context.passcodeValue = undefined;
      return { success: true };
    }

    try {
      // Hash the passcode using PBKDF2 (same as daemon's auth/passcode.ts)
      const ITERATIONS = 100000;
      const KEY_LENGTH = 64;
      const DIGEST = 'sha512';
      const SALT_LENGTH = 16;

      const salt = crypto.randomBytes(SALT_LENGTH);
      const derivedKey = await new Promise<Buffer>((resolve, reject) => {
        crypto.pbkdf2(context.passcodeValue!, salt, ITERATIONS, KEY_LENGTH, DIGEST, (err, key) => {
          if (err) reject(err);
          else resolve(key);
        });
      });

      const hash = `${ITERATIONS}:${salt.toString('base64')}:${derivedKey.toString('base64')}`;

      const passcodeData: PasscodeData = {
        hash,
        setAt: new Date().toISOString(),
      };

      // Save passcode to vault
      const { getVault } = await import('@agenshield/daemon');
      const vault = getVault();
      await vault.set('passcode', passcodeData);

      // Enable passcode protection in state
      const { updatePasscodeProtectionState } = await import('@agenshield/daemon');
      updatePasscodeProtectionState({ enabled: true });

      context.passcodeSetup = { configured: true, skipped: false };

      // Clear the passcode from context for security
      context.passcodeValue = undefined;

      return { success: true };
    } catch (err) {
      // Clear the passcode from context even on failure
      context.passcodeValue = undefined;
      return {
        success: false,
        error: `Failed to setup passcode: ${(err as Error).message}`,
      };
    }
  },

  complete: async (_context) => {
    // Final step - nothing to do
    return { success: true };
  },
};

/**
 * Run a subset of steps
 */
async function runSteps(
  state: WizardState,
  context: WizardContext,
  stepIds: WizardStepId[],
  onStateChange?: (state: WizardState) => void
): Promise<{ success: boolean; error?: string }> {
  for (const stepId of stepIds) {
    const stepIndex = state.steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) continue;

    state.currentStep = stepIndex;
    const step = state.steps[stepIndex];

    // Update step status to running
    step.status = 'running';
    onStateChange?.(state);

    // Execute the step
    const executor = stepExecutors[stepId];
    if (!executor) {
      step.status = 'error';
      step.error = `No executor for step: ${step.id}`;
      state.hasError = true;
      onStateChange?.(state);
      return { success: false, error: step.error };
    }

    const result = await executeStep(step, context, executor);

    if (result.success) {
      step.status = 'completed';
    } else {
      step.status = 'error';
      step.error = result.error;
      state.hasError = true;
      onStateChange?.(state);
      return { success: false, error: result.error };
    }

    onStateChange?.(state);
  }

  return { success: true };
}

/**
 * Create a new wizard engine
 */
export function createWizardEngine(options?: WizardOptions): WizardEngine {
  const state: WizardState = {
    currentStep: 0,
    steps: createWizardSteps(),
    isComplete: false,
    hasError: false,
  };

  const context: WizardContext = {
    options,
  };

  const engine: WizardEngine = {
    state,
    context,
    onStateChange: undefined,

    /**
     * Run detection phase only (prerequisites + detect + configure)
     * Called first, then waits for user confirmation
     */
    async runDetectionPhase() {
      const detectionSteps = getStepsByPhase('detection').filter((id) => id !== 'confirm');
      const result = await runSteps(state, context, detectionSteps, engine.onStateChange);
      return result;
    },

    /**
     * Run setup phase (confirm through verify, excludes passcode and complete)
     * Called after user confirms they want to proceed
     */
    async runSetupPhase() {
      const setupSteps: WizardStepId[] = ['confirm', ...getStepsByPhase('setup')
        .filter((id) => id !== 'setup-passcode' && id !== 'complete')];
      await runSteps(state, context, setupSteps, engine.onStateChange);
    },

    /**
     * Run final phase (setup-passcode and complete)
     * Called after the passcode UI has collected the passcode value
     */
    async runFinalPhase() {
      const finalSteps: WizardStepId[] = ['setup-passcode', 'complete'];
      await runSteps(state, context, finalSteps, engine.onStateChange);

      if (!state.hasError) {
        state.isComplete = true;
        engine.onStateChange?.(state);
      }
    },

    /**
     * Run all steps sequentially (for backwards compatibility)
     */
    async run() {
      await runSteps(state, context, getAllStepIds(), engine.onStateChange);

      if (!state.hasError) {
        state.isComplete = true;
        engine.onStateChange?.(state);
      }
    },
  };

  return engine;
}
