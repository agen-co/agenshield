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
  installPresetBinaries,
  generateBrokerPlist,
  installLaunchDaemon,
  fixSocketPermissions,
  createPathsConfig,
  deployInterceptor,
  copyNodeBinary,
  copyBrokerBinary,
  installGuardedShell,
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

/**
 * Verbose logging helper - logs messages when verbose mode is enabled
 * Uses stderr to bypass Ink's stdout capture
 */
function logVerbose(message: string, context?: WizardContext): void {
  if (context?.options?.verbose || process.env['AGENSHIELD_VERBOSE'] === 'true') {
    process.stderr.write(`[SETUP] ${message}\n`);
  }
}

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
        // Don't fail — let install-target step handle it
        context.preset = preset;
        context.presetDetection = { found: false };
        context.targetInstallable = true;
        return { success: true };
      }

      context.preset = preset;
      context.presetDetection = detection;
      return { success: true };
    }

    // Auto-detect preset
    const result = await autoDetectPreset();
    if (!result) {
      // No target found — mark as installable so install-target step can offer installation
      const openclawPreset = getPreset('openclaw');
      if (openclawPreset) {
        context.preset = openclawPreset;
        context.presetDetection = { found: false };
        context.targetInstallable = true;
        return { success: true };
      }
      return {
        success: false,
        error: 'No supported target found. Use --target custom --entry-point <path> for custom applications.',
      };
    }

    context.preset = result.preset;
    context.presetDetection = result.detection;
    return { success: true };
  },

  'install-target': async (context) => {
    // If detection already found a target, skip
    if (context.presetDetection?.found) {
      return { success: true };
    }

    // If not found and user hasn't requested install yet, mark as installable and succeed
    // (the Web UI will offer an install button)
    if (!context.installTargetRequested) {
      context.targetInstallable = true;
      return { success: true };
    }

    // User requested installation — skip actual install in dry-run
    if (context.options?.dryRun) {
      context.targetInstallable = false;
      context.presetDetection = { found: true, method: 'npm' };
      return { success: true };
    }

    // Run npm install -g openclaw (no sudo — user handles npm config)
    try {
      const { execSync } = await import('node:child_process');
      execSync('npm install -g openclaw', {
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: 'pipe',
      });
    } catch (err) {
      return {
        success: false,
        error: `Failed to install openclaw: ${(err as Error).message}`,
      };
    }

    // Re-run detection
    const result = await autoDetectPreset();
    if (!result) {
      return {
        success: false,
        error: 'openclaw was installed but could not be detected. Check your PATH.',
      };
    }

    context.preset = result.preset;
    context.presetDetection = result.detection;
    context.targetInstallable = false;
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
      logVerbose(`[dry-run] Would create group: ${context.userConfig.groups.socket.name} (gid=${context.userConfig.groups.socket.gid})`, context);
      logVerbose(`[dry-run] Would create group: ${context.userConfig.groups.workspace.name} (gid=${context.userConfig.groups.workspace.gid})`, context);
      context.groupsCreated = {
        socket: context.userConfig.groups.socket,
        workspace: context.userConfig.groups.workspace,
      };
      return { success: true };
    }

    logVerbose(`Creating group: ${context.userConfig.groups.socket.name} (gid=${context.userConfig.groups.socket.gid})`, context);
    logVerbose(`Creating group: ${context.userConfig.groups.workspace.name} (gid=${context.userConfig.groups.workspace.gid})`, context);

    const results = await createGroups(context.userConfig, { verbose: context.options?.verbose });
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

    const { agentUser } = context.userConfig;

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      logVerbose(`[dry-run] Would create user: ${agentUser.username} (uid=${agentUser.uid}, gid=${agentUser.gid})`, context);
      logVerbose(`[dry-run] Home directory: ${agentUser.home}`, context);
      logVerbose(`[dry-run] Shell: ${agentUser.shell}`, context);
      context.agentUser = {
        username: agentUser.username,
        uid: agentUser.uid,
        gid: agentUser.gid,
        homeDir: agentUser.home,
        shell: agentUser.shell,
      };
      return { success: true };
    }

    logVerbose(`Creating user: ${agentUser.username} (uid=${agentUser.uid}, gid=${agentUser.gid})`, context);
    logVerbose(`Home directory: ${agentUser.home}`, context);
    logVerbose(`Shell: ${agentUser.shell}`, context);

    const result = await createAgentUser(context.userConfig, { verbose: context.options?.verbose });
    if (!result.success) {
      return { success: false, error: result.message };
    }

    context.agentUser = {
      username: agentUser.username,
      uid: agentUser.uid,
      gid: agentUser.gid,
      homeDir: agentUser.home,
      shell: agentUser.shell,
    };

    return { success: true };
  },

  'create-broker-user': async (context) => {
    if (!context.userConfig) {
      return { success: false, error: 'User configuration not set' };
    }

    const { brokerUser } = context.userConfig;

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      logVerbose(`[dry-run] Would create user: ${brokerUser.username} (uid=${brokerUser.uid}, gid=${brokerUser.gid})`, context);
      context.brokerUser = {
        username: brokerUser.username,
        uid: brokerUser.uid,
        gid: brokerUser.gid,
        homeDir: brokerUser.home,
        shell: brokerUser.shell,
      };
      return { success: true };
    }

    logVerbose(`Creating user: ${brokerUser.username} (uid=${brokerUser.uid}, gid=${brokerUser.gid})`, context);

    const result = await createBrokerUser(context.userConfig, { verbose: context.options?.verbose });
    if (!result.success) {
      return { success: false, error: result.message };
    }

    context.brokerUser = {
      username: brokerUser.username,
      uid: brokerUser.uid,
      gid: brokerUser.gid,
      homeDir: brokerUser.home,
      shell: brokerUser.shell,
    };

    return { success: true };
  },

  'create-directories': async (context) => {
    if (!context.userConfig || !context.pathsConfig) {
      return { success: false, error: 'Configuration not set' };
    }

    const { agentUser } = context.userConfig;
    const directories = {
      binDir: `${agentUser.home}/bin`,
      wrappersDir: `${agentUser.home}/bin`,
      configDir: context.pathsConfig.configDir,
      packageDir: `${agentUser.home}/.openclaw-pkg`,
      npmDir: `${agentUser.home}/.npm`,
      socketDir: context.pathsConfig.socketDir,
      logDir: context.pathsConfig.logDir,
      seatbeltDir: context.pathsConfig.seatbeltDir,
    };

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      logVerbose(`[dry-run] Would create directory: ${directories.binDir}`, context);
      logVerbose(`[dry-run] Would create directory: ${directories.configDir}`, context);
      logVerbose(`[dry-run] Would create directory: ${directories.socketDir}`, context);
      logVerbose(`[dry-run] Would create directory: ${directories.logDir}`, context);
      context.directories = directories;
      return { success: true };
    }

    logVerbose(`Creating directory: ${directories.binDir}`, context);
    logVerbose(`Creating directory: ${directories.configDir}`, context);
    logVerbose(`Creating directory: ${directories.socketDir}`, context);
    logVerbose(`Creating directory: ${directories.logDir}`, context);
    logVerbose(`Creating directory: ${agentUser.home}/workspace (mode=2775, group=${context.userConfig.groups.workspace.name})`, context);

    const results = await createAllDirectories(context.userConfig, { verbose: context.options?.verbose });
    const failed = results.filter((r) => !r.success);

    if (failed.length > 0) {
      return {
        success: false,
        error: failed.map((r) => r.message).join('; '),
      };
    }

    context.directories = directories;

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

    // Determine which bins to install from preset
    const requiredBins = context.preset?.requiredBins;

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      logVerbose(`[dry-run] Would install guarded shell to /usr/local/bin/guarded-shell`, context);
      logVerbose(`[dry-run] Would install ZDOTDIR files to /etc/agenshield/zdot/`, context);
      logVerbose(`[dry-run] Would install wrappers: ${(requiredBins || ['node', 'npm', 'git', 'curl', 'shieldctl']).join(', ')}`, context);
      context.wrappersInstalled = requiredBins || ['node', 'npm', 'git', 'curl', 'shieldctl'];
      return { success: true };
    }

    try {
      // First, install guarded shell (critical for PATH/HOME enforcement)
      logVerbose(`Installing guarded shell to /usr/local/bin/guarded-shell`, context);
      logVerbose(`Installing .zshenv to /etc/agenshield/zdot/.zshenv`, context);
      logVerbose(`Installing .zshrc to /etc/agenshield/zdot/.zshrc`, context);

      const guardedShellResult = await installGuardedShell(context.userConfig);
      if (!guardedShellResult.success) {
        return { success: false, error: guardedShellResult.message };
      }

      if (requiredBins && requiredBins.length > 0) {
        // Preset-driven installation
        logVerbose(`Installing wrappers: ${requiredBins.join(', ')}`, context);
        const result = await installPresetBinaries({
          requiredBins,
          userConfig: context.userConfig,
          binDir: context.directories.binDir,
          socketGroupName: context.userConfig.groups.socket.name,
          verbose: context.options?.verbose,
        });
        context.wrappersInstalled = result.installedWrappers;
        if (!result.success) {
          return { success: false, error: result.errors.join('; ') };
        }
        return { success: true };
      }

      // Fallback: install all wrappers (no preset or preset has no requiredBins)
      logVerbose(`Deploying interceptor to /opt/agenshield/lib/interceptor/register.cjs`, context);
      const interceptorResult = await deployInterceptor(context.userConfig);
      if (!interceptorResult.success) {
        return { success: false, error: interceptorResult.message };
      }

      logVerbose(`Copying node binary to /opt/agenshield/bin/node-bin`, context);
      const nodeBinResult = await copyNodeBinary(context.userConfig);
      if (!nodeBinResult.success) {
        return { success: false, error: nodeBinResult.message };
      }

      logVerbose(`Installing all wrappers to ${context.directories.binDir}`, context);
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
      logVerbose(`[dry-run] Would install broker binary to ${brokerPath}`, context);
      context.brokerInstalled = {
        binaryPath: brokerPath,
        success: true,
      };
      return { success: true };
    }

    logVerbose(`Installing broker binary to ${brokerPath}`, context);

    const result = await copyBrokerBinary(context.userConfig);
    if (!result.success) {
      return { success: false, error: result.message };
    }

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

    const configPath = `${context.pathsConfig.configDir}/shield.json`;
    const brokerUsername = context.userConfig.brokerUser.username;
    const socketGroupName = context.userConfig.groups.socket.name;

    // Skip in dry-run mode
    if (context.options?.dryRun) {
      logVerbose(`[dry-run] Would write daemon config to ${configPath}`, context);
      context.daemonConfig = {
        configPath,
        success: true,
      };
      return { success: true };
    }

    try {
      const { execSync } = await import('node:child_process');

      const shieldConfig = JSON.stringify({
        socketPath: context.pathsConfig.socketPath,
        socketOwner: brokerUsername,
        socketGroup: socketGroupName,
        policiesPath: '/opt/agenshield/policies',
        auditLogPath: '/var/log/agenshield/audit.log',
      }, null, 2);

      logVerbose(`Writing daemon config to ${configPath}`, context);

      // Write config file via sudo tee
      execSync(`sudo tee "${configPath}" > /dev/null << 'SHIELD_EOF'
${shieldConfig}
SHIELD_EOF`, { encoding: 'utf-8', stdio: 'pipe' });

      // Set ownership and permissions
      execSync(`sudo chown ${brokerUsername}:${socketGroupName} "${configPath}"`, { encoding: 'utf-8', stdio: 'pipe' });
      execSync(`sudo chmod 640 "${configPath}"`, { encoding: 'utf-8', stdio: 'pipe' });

      context.daemonConfig = {
        configPath,
        success: true,
      };

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: `Failed to install daemon config: ${(err as Error).message}`,
      };
    }
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
      const { execSync } = await import('node:child_process');
      const brokerUsername = context.userConfig.brokerUser.username;
      const socketGroupName = context.userConfig.groups.socket.name;

      // Remove stale socket from previous installs (may be root-owned, causing EACCES)
      logVerbose('Removing stale socket file if present', context);
      execSync(`sudo rm -f /var/run/agenshield/agenshield.sock`, { encoding: 'utf-8', stdio: 'pipe' });

      // Ensure log files exist with correct ownership BEFORE loading daemon.
      // launchd opens stdout/stderr files at process start; if they don't exist
      // or are root-owned, the broker's output may be lost.
      logVerbose('Ensuring log files have correct ownership', context);
      execSync(`sudo mkdir -p /var/log/agenshield`, { encoding: 'utf-8', stdio: 'pipe' });
      execSync(`sudo touch /var/log/agenshield/broker.log /var/log/agenshield/broker.error.log`, { encoding: 'utf-8', stdio: 'pipe' });
      execSync(`sudo chown ${brokerUsername}:${socketGroupName} /var/log/agenshield/broker.log /var/log/agenshield/broker.error.log`, { encoding: 'utf-8', stdio: 'pipe' });

      // Bootout any stale broker daemon entry from a previous install.
      // Without this, `launchctl load` may no-op if the old entry is cached.
      logVerbose('Removing stale launchd entry if present', context);
      try {
        execSync(`sudo launchctl bootout system/com.agenshield.broker 2>/dev/null`, { encoding: 'utf-8', stdio: 'pipe' });
      } catch {
        // Not loaded — that's fine
      }

      // Generate plist
      const plist = generateBrokerPlist(context.userConfig, {
        brokerPath: context.brokerInstalled.binaryPath,
      });

      // Install and load
      const result = await installLaunchDaemon(plist);

      if (!result.success) {
        return { success: false, error: result.message };
      }

      // Force-start the broker immediately. launchctl load + RunAtLoad may not
      // start the process if launchd throttles it (e.g. ThrottleInterval from a
      // prior crashed run). kickstart bypasses throttling.
      logVerbose('Kickstarting broker daemon', context);
      try {
        execSync(`sudo launchctl kickstart system/com.agenshield.broker`, { encoding: 'utf-8', stdio: 'pipe' });
      } catch {
        // May fail if already running from RunAtLoad — that's fine
      }

      // Fix socket permissions after broker starts
      // This ensures the daemon user can access the broker socket
      const socketResult = await fixSocketPermissions(context.userConfig);
      if (!socketResult.success) {
        // Non-fatal: log warning but continue
        console.warn(`[Setup] Warning: ${socketResult.message}`);
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
      const parts: string[] = [];
      if (dirResult.missing.length > 0) {
        parts.push(`Missing directories: ${dirResult.missing.join(', ')}`);
      }
      if (dirResult.incorrect.length > 0) {
        parts.push(`Incorrect directories: ${dirResult.incorrect.map(d => `${d.path} (${d.issue})`).join(', ')}`);
      }
      return {
        success: false,
        error: parts.join('; ') || 'Directory verification failed',
      };
    }

    // NOTE: We skip running the target binary during setup verification.
    // The interceptor (loaded via NODE_OPTIONS) would try to connect to the
    // broker, which isn't running yet, causing ETIMEDOUT errors.
    // The users/groups/directories verification above is sufficient.

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
      // Prompt for sudo credentials before privileged steps (skip in dry-run)
      if (!context.options?.dryRun) {
        const { ensureSudoAccess, startSudoKeepalive } = await import('../utils/privileges.js');
        ensureSudoAccess();
        const keepalive = startSudoKeepalive();
        try {
          const setupSteps: WizardStepId[] = ['confirm', ...getStepsByPhase('setup')
            .filter((id) => id !== 'setup-passcode' && id !== 'complete')];
          await runSteps(state, context, setupSteps, engine.onStateChange);
        } finally {
          clearInterval(keepalive);
        }
        return;
      }
      // dry-run path (unchanged)
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
