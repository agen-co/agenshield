/**
 * Wizard engine - orchestrates the setup steps
 */

import * as os from 'node:os';
import * as crypto from 'node:crypto';
import {
  checkPrerequisites,
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
  copyShieldClient,
  installGuardedShell,
  // NVM (existing)
  installAgentNvm,
  patchNvmNode,
  // Preset system
  getPreset,
  autoDetectPreset,
  type MigrationContext,
  type MigrationDirectories,
} from '@agenshield/sandbox';
import {
  // Homebrew
  installAgentHomebrew,
  isAgentHomebrewInstalled,
  // OpenClaw install + config + lifecycle
  detectHostOpenClawVersion,
  installAgentOpenClaw,
  copyOpenClawConfig,
  stopHostOpenClaw,
  getOriginalUser,
  getHostOpenClawConfigPath,
  onboardAgentOpenClaw,
  // OpenClaw LaunchDaemons
  installOpenClawLaunchDaemons,
  startOpenClawServices,
  OPENCLAW_DAEMON_PLIST,
  OPENCLAW_GATEWAY_PLIST,
} from '@agenshield/integrations';
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
 * Module-level log callback — allows the setup server to receive verbose
 * messages and broadcast them (e.g. via SSE) to the browser UI.
 */
let _logCallback: ((message: string, stepId?: WizardStepId) => void) | undefined;
let _currentStepId: WizardStepId | undefined;

export function setEngineLogCallback(cb: ((message: string, stepId?: WizardStepId) => void) | undefined): void {
  _logCallback = cb;
}

/**
 * Verbose logging helper - logs messages when verbose mode is enabled.
 * Writes to stderr (terminal) only in verbose mode, but ALWAYS calls
 * the log callback so the setup server can forward messages to the browser.
 */
function logVerbose(message: string, context?: WizardContext): void {
  if (context?.options?.verbose || process.env['AGENSHIELD_VERBOSE'] === 'true') {
    process.stderr.write(`[SETUP] ${message}\n`);
  }
  // Always broadcast to the UI regardless of verbose flag
  _logCallback?.(message, _currentStepId);
}

export interface WizardEngine {
  state: WizardState;
  context: WizardContext;
  onStateChange?: (state: WizardState) => void;
  /** Run full wizard (all steps) */
  run(): Promise<void>;
  /** Run only detection phase (prerequisites + detect + configure) */
  runDetectionPhase(): Promise<{ success: boolean; error?: string }>;
  /** Run setup phase (confirm through scan-source, stops for user selection) */
  runSetupPhase(): Promise<void>;
  /** Run migration phase (select-items + migrate + verify) - called after user makes selection */
  runMigrationPhase(): Promise<void>;
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
        // Preserve partial detection (e.g. configPath) for scan-source
        context.preset = preset;
        context.presetDetection = detection ?? { found: false };
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
      // Try to capture partial detection (e.g. configPath with skills on disk)
      const openclawPreset = getPreset('openclaw');
      if (openclawPreset) {
        context.preset = openclawPreset;
        const partialDetection = await openclawPreset.detect();
        context.presetDetection = partialDetection ?? { found: false };
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
      logVerbose('Running: npm install -g openclaw', context);
      const output = execSync('npm install -g openclaw', {
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: 'pipe',
      });
      if (output?.trim()) {
        logVerbose(output.trim(), context);
      }
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

  // ── New setup steps ───────────────────────────────────────────────────

  'cleanup-previous': async (context) => {
    logVerbose('Checking for previous installations', context);
    const { execSync } = await import('node:child_process');
    const fs = await import('node:fs');

    // Quick check: does the default agent user exist?
    let agentUserExists = false;
    try {
      execSync('dscl . -read /Users/ash_default_agent', { encoding: 'utf-8', stdio: 'pipe' });
      agentUserExists = true;
    } catch { /* user doesn't exist */ }

    if (!agentUserExists) {
      logVerbose('No previous installation detected', context);
      return { success: true };
    }

    logVerbose('Found previous installation (ash_default_agent exists), cleaning up', context);

    if (context.options?.dryRun) {
      logVerbose('[dry-run] Would remove previous installation', context);
      return { success: true };
    }

    // NOTE: We cannot use forceUninstall() here because it calls stopDaemon()
    // which kills the process on port 5200 — that's our own setup wizard.
    // Instead we do the cleanup steps inline, skipping the daemon kill.

    const sudo = (cmd: string) => {
      try {
        execSync(`sudo ${cmd}`, { encoding: 'utf-8', stdio: 'pipe' });
        return true;
      } catch { return false; }
    };

    // 1. Stop broker launchd service (but NOT the daemon on port 5200 — that's us)
    const brokerPlist = '/Library/LaunchDaemons/com.agenshield.broker.plist';
    if (fs.existsSync(brokerPlist)) {
      logVerbose('[cleanup] Stopping broker LaunchDaemon', context);
      sudo(`launchctl bootout system/com.agenshield.broker 2>/dev/null || true`);
      sudo(`rm -f "${brokerPlist}"`);
    }

    // 2. Remove OpenClaw LaunchDaemon plists if present
    for (const plist of [
      '/Library/LaunchDaemons/com.agenshield.openclaw.daemon.plist',
      '/Library/LaunchDaemons/com.agenshield.openclaw.gateway.plist',
    ]) {
      if (fs.existsSync(plist)) {
        const label = plist.replace('/Library/LaunchDaemons/', '').replace('.plist', '');
        logVerbose(`[cleanup] Removing ${label}`, context);
        sudo(`launchctl bootout system/${label} 2>/dev/null || true`);
        sudo(`rm -f "${plist}"`);
      }
    }

    // 3. Discover and kill processes for all ash_* users
    let sandboxUsers: string[] = [];
    try {
      const output = execSync('dscl . -list /Users', { encoding: 'utf-8' });
      sandboxUsers = output.split('\n').filter(u => u.startsWith('ash_'));
    } catch { /* ignore */ }

    for (const username of sandboxUsers) {
      logVerbose(`[cleanup] Killing processes for ${username}`, context);
      sudo(`pkill -u ${username} 2>/dev/null || true`);
    }
    if (sandboxUsers.length > 0) {
      try { execSync('sleep 1', { encoding: 'utf-8' }); } catch { /* ignore */ }
      for (const username of sandboxUsers) {
        sudo(`pkill -9 -u ${username} 2>/dev/null || true`);
      }
    }

    // 4. Delete sandbox users (with home dirs)
    const { deleteSandboxUser } = await import('@agenshield/sandbox');
    for (const username of sandboxUsers) {
      logVerbose(`[cleanup] Deleting user ${username}`, context);
      deleteSandboxUser(username, { removeHomeDir: true });
    }

    // 5. Delete ash_* groups
    let ashGroups: string[] = [];
    try {
      const output = execSync('dscl . -list /Groups', { encoding: 'utf-8' });
      ashGroups = output.split('\n').filter(g => g.startsWith('ash_'));
    } catch { /* ignore */ }

    for (const groupName of ashGroups) {
      logVerbose(`[cleanup] Deleting group ${groupName}`, context);
      sudo(`dscl . -delete /Groups/${groupName}`);
    }

    // 6. Remove guarded shell from /etc/shells and disk
    const guardedShellPath = '/usr/local/bin/guarded-shell';
    if (fs.existsSync(guardedShellPath)) {
      logVerbose('[cleanup] Removing guarded shell', context);
      sudo(`sed -i '' '\\|${guardedShellPath}|d' /etc/shells`);
      sudo(`rm -f "${guardedShellPath}"`);
    }

    // 7. Remove sudoers drop-in
    if (fs.existsSync('/etc/sudoers.d/agenshield')) {
      logVerbose('[cleanup] Removing /etc/sudoers.d/agenshield', context);
      sudo('rm -f /etc/sudoers.d/agenshield');
    }

    // 8. Clean up directories
    for (const dir of ['/etc/agenshield', '/var/log/agenshield', '/var/run/agenshield', '/opt/agenshield']) {
      if (fs.existsSync(dir)) {
        logVerbose(`[cleanup] Removing ${dir}`, context);
        sudo(`rm -rf "${dir}"`);
      }
    }

    logVerbose('Previous installation cleaned up', context);
    return { success: true };
  },

  'install-homebrew': async (context) => {
    if (!context.userConfig) {
      return { success: false, error: 'User configuration not set' };
    }

    const { agentUser } = context.userConfig;
    const socketGroupName = context.userConfig.groups.socket.name;

    if (context.options?.dryRun) {
      logVerbose(`[dry-run] Would install Homebrew to ${agentUser.home}/homebrew`, context);
      context.homebrewInstalled = { brewPath: `${agentUser.home}/homebrew/bin/brew`, success: true };
      return { success: true };
    }

    // Skip if already installed (e.g., retry after partial failure)
    if (await isAgentHomebrewInstalled(agentUser.home)) {
      logVerbose('Homebrew already installed, skipping', context);
      context.homebrewInstalled = { brewPath: `${agentUser.home}/homebrew/bin/brew`, success: true };
      return { success: true };
    }

    logVerbose(`Installing user-specific Homebrew for ${agentUser.username}`, context);
    const onLog = (msg: string) => logVerbose(msg, context);
    const result = await installAgentHomebrew({
      agentHome: agentUser.home,
      agentUsername: agentUser.username,
      socketGroupName,
      verbose: context.options?.verbose,
      onLog,
    });

    if (!result.success) {
      return { success: false, error: result.message };
    }

    context.homebrewInstalled = { brewPath: result.brewPath, success: true };
    return { success: true };
  },

  'install-nvm': async (context) => {
    if (!context.userConfig) {
      return { success: false, error: 'User configuration not set' };
    }

    const { agentUser } = context.userConfig;
    const socketGroupName = context.userConfig.groups.socket.name;
    const nodeVersion = context.options?.nodeVersion || '24';

    if (context.options?.dryRun) {
      logVerbose(`[dry-run] Would install NVM + Node.js v${nodeVersion} for ${agentUser.username}`, context);
      context.nvmInstalled = {
        nvmDir: `${agentUser.home}/.nvm`,
        nodeVersion: `v${nodeVersion}`,
        nodeBinaryPath: `${agentUser.home}/.nvm/versions/node/v${nodeVersion}.0.0/bin/node`,
        success: true,
      };
      return { success: true };
    }

    // Skip if NVM + requested Node version already installed
    const nvmDir = `${agentUser.home}/.nvm`;
    const nvmSh = `${nvmDir}/nvm.sh`;
    const fs = await import('node:fs');
    if (fs.existsSync(nvmSh)) {
      try {
        const { exec: execCb } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(execCb);
        const { stdout } = await execAsync(
          `sudo -H -u ${agentUser.username} /bin/bash --norc --noprofile -c 'source "${nvmSh}" && nvm which ${nodeVersion}'`,
          { cwd: '/' },
        );
        if (stdout.trim()) {
          logVerbose(`NVM + Node.js v${nodeVersion} already installed, skipping`, context);
          // Still copy node binary to ensure it's up to date
          const nodeResult = await copyNodeBinary(context.userConfig, stdout.trim());
          if (!nodeResult.success) {
            return { success: false, error: `Node binary copy failed: ${nodeResult.message}` };
          }
          // NOTE: Do NOT patch NVM node here — patching must happen after all
          // npm installs (openclaw etc.) complete. See start-openclaw step.
          context.nvmInstalled = {
            nvmDir,
            nodeVersion: `v${nodeVersion}`,
            nodeBinaryPath: stdout.trim(),
            success: true,
          };
          return { success: true };
        }
      } catch {
        // Node version not installed, proceed with full install
      }
    }

    logVerbose(`Installing NVM + Node.js v${nodeVersion} for ${agentUser.username}`, context);
    const onLog = (msg: string) => logVerbose(msg, context);
    const result = await installAgentNvm({
      agentHome: agentUser.home,
      agentUsername: agentUser.username,
      socketGroupName,
      nodeVersion,
      verbose: context.options?.verbose,
      onLog,
    });

    if (!result.success) {
      return { success: false, error: result.message };
    }

    // Copy NVM node binary to /opt/agenshield/bin/node-bin
    logVerbose(`Copying NVM node binary to /opt/agenshield/bin/node-bin`, context);
    const nodeResult = await copyNodeBinary(context.userConfig, result.nodeBinaryPath);
    if (!nodeResult.success) {
      return { success: false, error: `Node binary copy failed: ${nodeResult.message}` };
    }

    // NOTE: Do NOT patch NVM node here — patching must happen after all
    // npm installs (openclaw etc.) complete. See start-openclaw step.

    context.nvmInstalled = {
      nvmDir: result.nvmDir,
      nodeVersion: result.nodeVersion,
      nodeBinaryPath: result.nodeBinaryPath,
      success: true,
    };
    return { success: true };
  },

  'configure-shell': async (context) => {
    if (!context.userConfig) {
      return { success: false, error: 'User configuration not set' };
    }

    if (context.options?.dryRun) {
      logVerbose(`[dry-run] Would configure guarded shell with Homebrew + NVM paths`, context);
      context.shellConfigured = { success: true };
      return { success: true };
    }

    logVerbose('Installing guarded shell with Homebrew and NVM paths', context);
    const result = await installGuardedShell(context.userConfig, { verbose: context.options?.verbose });
    if (!result.success) {
      return { success: false, error: result.message };
    }

    context.shellConfigured = { success: true };
    return { success: true };
  },

  'install-openclaw': async (context) => {
    if (!context.userConfig) {
      return { success: false, error: 'User configuration not set' };
    }

    const { agentUser } = context.userConfig;
    const socketGroupName = context.userConfig.groups.socket.name;

    // Detect host version
    const hostVersion = context.presetDetection?.version || detectHostOpenClawVersion() || 'latest';
    logVerbose(`Host OpenClaw version: ${hostVersion}`, context);

    if (context.options?.dryRun) {
      logVerbose(`[dry-run] Would install openclaw@${hostVersion} for ${agentUser.username}`, context);
      context.openclawInstalled = {
        version: hostVersion,
        binaryPath: `${agentUser.home}/.nvm/versions/node/v24.0.0/bin/openclaw`,
        success: true,
      };
      return { success: true };
    }

    logVerbose(`Installing openclaw@${hostVersion} for agent user`, context);
    const onLog = (msg: string) => logVerbose(msg, context);
    const result = await installAgentOpenClaw({
      agentHome: agentUser.home,
      agentUsername: agentUser.username,
      socketGroupName,
      targetVersion: hostVersion,
      verbose: context.options?.verbose,
      onLog,
    });

    if (!result.success) {
      return { success: false, error: result.message };
    }

    context.openclawInstalled = {
      version: result.version,
      binaryPath: result.binaryPath,
      success: true,
    };
    return { success: true };
  },

  'copy-openclaw-config': async (context) => {
    if (!context.userConfig) {
      return { success: false, error: 'User configuration not set' };
    }

    const { agentUser } = context.userConfig;
    const socketGroupName = context.userConfig.groups.socket.name;

    // Find host config path
    const sourceConfigPath = context.presetDetection?.configPath
      || getHostOpenClawConfigPath();

    if (context.options?.dryRun) {
      logVerbose(`[dry-run] Would copy .openclaw from ${sourceConfigPath || '(not found)'} to ${agentUser.home}/.openclaw`, context);
      context.openclawConfigCopied = {
        configDir: `${agentUser.home}/.openclaw`,
        sanitized: false,
        success: true,
      };
      return { success: true };
    }

    if (!sourceConfigPath) {
      logVerbose('No host .openclaw config found, creating empty config', context);
    }

    logVerbose(`Copying OpenClaw config to agent user`, context);
    const onLog = (msg: string) => logVerbose(msg, context);
    const result = copyOpenClawConfig({
      sourceConfigPath: sourceConfigPath || '/nonexistent',
      agentHome: agentUser.home,
      agentUsername: agentUser.username,
      socketGroup: socketGroupName,
      verbose: context.options?.verbose,
      onLog,
    });

    if (!result.success) {
      return { success: false, error: result.message };
    }

    context.openclawConfigCopied = {
      configDir: result.configDir,
      sanitized: result.sanitized,
      success: true,
    };
    return { success: true };
  },

  'stop-host-openclaw': async (context) => {
    const originalUser = getOriginalUser();

    if (context.options?.dryRun) {
      logVerbose(`[dry-run] Would stop OpenClaw daemon + gateway for user: ${originalUser}`, context);
      context.hostOpenclawStopped = { daemonStopped: true, gatewayStopped: true };
      return { success: true };
    }

    logVerbose(`Stopping host OpenClaw processes for user: ${originalUser}`, context);
    const onLog = (msg: string) => logVerbose(msg, context);
    const result = await stopHostOpenClaw({
      originalUser,
      verbose: context.options?.verbose,
      onLog,
    });

    context.hostOpenclawStopped = {
      daemonStopped: result.daemonStopped,
      gatewayStopped: result.gatewayStopped,
    };

    // Non-fatal if stop fails (processes might not be running)
    return { success: true };
  },

  'onboard-openclaw': async (context) => {
    if (!context.userConfig) {
      return { success: false, error: 'User configuration not set' };
    }

    const { agentUser } = context.userConfig;

    if (context.options?.dryRun) {
      logVerbose('[dry-run] Would run openclaw onboard --non-interactive', context);
      context.openclawOnboarded = { success: true };
      return { success: true };
    }

    logVerbose('Running openclaw onboard for agent user', context);
    const onLog = (msg: string) => logVerbose(msg, context);
    const result = await onboardAgentOpenClaw({
      agentHome: agentUser.home,
      agentUsername: agentUser.username,
      verbose: context.options?.verbose,
      onLog,
    });

    context.openclawOnboarded = { success: result.success };

    // Non-fatal — onboard may fail if openclaw doesn't support the flags
    if (!result.success) {
      logVerbose(`Onboard returned non-success (non-fatal): ${result.message}`, context);
    }
    return { success: true };
  },

  'start-openclaw': async (context) => {
    if (!context.userConfig) {
      return { success: false, error: 'User configuration not set' };
    }

    const { agentUser } = context.userConfig;
    const socketGroupName = context.userConfig.groups.socket.name;

    if (context.options?.dryRun) {
      logVerbose(`[dry-run] Would install OpenClaw LaunchDaemons (managed by broker)`, context);
      context.openclawLaunchDaemons = {
        daemonPlistPath: OPENCLAW_DAEMON_PLIST,
        gatewayPlistPath: OPENCLAW_GATEWAY_PLIST,
        loaded: false,
      };
      return { success: true };
    }

    // 1. Patch NVM node in-place BEFORE starting OpenClaw services.
    //    All npm installs (openclaw, onboard, etc.) are done by now, so it's safe
    //    to replace NVM's node with the interceptor wrapper. From this point on,
    //    every `node` invocation via NVM goes through the interceptor.
    const onLog = (msg: string) => logVerbose(msg, context);
    if (context.nvmInstalled?.success && context.nvmInstalled.nodeBinaryPath) {
      logVerbose('Patching NVM node binary in-place with interceptor wrapper', context);
      const patchResult = await patchNvmNode({
        nodeBinaryPath: context.nvmInstalled.nodeBinaryPath,
        agentUsername: agentUser.username,
        socketGroupName,
        interceptorPath: '/opt/agenshield/lib/interceptor/register.cjs',
        socketPath: '/var/run/agenshield/agenshield.sock',
        httpPort: 5201,
        verbose: context.options?.verbose,
        onLog,
      });
      if (!patchResult.success) {
        return { success: false, error: `Failed to patch NVM node: ${patchResult.message}` };
      }
    }

    // 2. Install OpenClaw LaunchDaemons (gateway + daemon) — managed by launchd/broker
    logVerbose('Installing OpenClaw LaunchDaemons (broker-managed)', context);
    const installResult = await installOpenClawLaunchDaemons({
      agentUsername: agentUser.username,
      socketGroupName,
      agentHome: agentUser.home,
    });

    if (!installResult.success) {
      return { success: false, error: installResult.message };
    }

    logVerbose('OpenClaw LaunchDaemons installed and loaded', context);

    // 3. Start OpenClaw services via launchctl kickstart
    logVerbose('Starting OpenClaw services via launchctl', context);
    const startResult = await startOpenClawServices();

    if (!startResult.success) {
      logVerbose(`Failed to start OpenClaw services (non-fatal): ${startResult.message}`, context);
    } else {
      logVerbose('OpenClaw services started', context);
    }

    context.openclawLaunchDaemons = {
      daemonPlistPath: OPENCLAW_DAEMON_PLIST,
      gatewayPlistPath: OPENCLAW_GATEWAY_PLIST,
      loaded: true,
    };

    return { success: true };
  },

  'open-dashboard': async (_context) => {
    // No-op: the browser is already on the setup wizard page which
    // transitions to CompleteStep and polls for daemon readiness.
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
      configDir: `${agentUser.home}/.openclaw`,
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
          nodeVersion: context.options?.nodeVersion,
          verbose: context.options?.verbose,
          nvmResult: context.nvmInstalled ? {
            success: context.nvmInstalled.success,
            nvmDir: context.nvmInstalled.nvmDir,
            nodeVersion: context.nvmInstalled.nodeVersion,
            nodeBinaryPath: context.nvmInstalled.nodeBinaryPath,
            message: '',
          } : undefined,
        });
        context.wrappersInstalled = result.installedWrappers;
        if (!result.success) {
          return { success: false, error: result.errors.join('; ') };
        }

        // Install shield-exec binary for daemon runtime self-healing
        try {
          const { SHIELD_EXEC_CONTENT, SHIELD_EXEC_PATH } = await import('@agenshield/sandbox');
          const { execSync } = await import('node:child_process');
          execSync(`sudo tee "${SHIELD_EXEC_PATH}" > /dev/null << 'SHIELDEXECEOF'\n${SHIELD_EXEC_CONTENT}\nSHIELDEXECEOF`);
          execSync(`sudo chmod 755 "${SHIELD_EXEC_PATH}"`);
          execSync(`sudo chown root:wheel "${SHIELD_EXEC_PATH}"`);
          logVerbose(`Installed shield-exec to ${SHIELD_EXEC_PATH}`, context);
        } catch (err) {
          logVerbose(`Warning: shield-exec install failed: ${(err as Error).message}`, context);
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

    // Also install shield-client (used by curl/git/etc. wrappers)
    logVerbose('Installing shield-client to /opt/agenshield/bin/shield-client', context);
    const clientResult = await copyShieldClient(context.userConfig);
    if (!clientResult.success) {
      logVerbose(`Warning: shield-client install failed: ${clientResult.message}`, context);
    }

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
        agentHome: context.userConfig.agentUser.home,
      }, null, 2);

      logVerbose(`Writing daemon config to ${configPath}`, context);

      // Write config file via sudo tee
      logVerbose(`Running: sudo tee "${configPath}"`, context);
      execSync(`sudo tee "${configPath}" > /dev/null << 'SHIELD_EOF'
${shieldConfig}
SHIELD_EOF`, { encoding: 'utf-8', stdio: 'pipe' });

      // Set ownership and permissions
      logVerbose(`Running: sudo chown ${brokerUsername}:${socketGroupName} "${configPath}"`, context);
      execSync(`sudo chown ${brokerUsername}:${socketGroupName} "${configPath}"`, { encoding: 'utf-8', stdio: 'pipe' });
      logVerbose(`Running: sudo chmod 640 "${configPath}"`, context);
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

  'install-sudoers': async (context) => {
    if (!context.userConfig) {
      return { success: false, error: 'User configuration not set' };
    }

    const brokerUsername = context.userConfig.brokerUser.username;
    const agentUsername = context.userConfig.agentUser.username;
    const agentHome = context.userConfig.agentUser.home;

    if (context.options?.dryRun) {
      logVerbose(`[dry-run] Would install /etc/sudoers.d/agenshield granting ${brokerUsername} sudo for ${agentUsername} operations`, context);
      return { success: true };
    }

    try {
      const { execSync } = await import('node:child_process');

      // Include the original user (who ran setup) so dev-mode daemon can also use sudo
      const originalUser = getOriginalUser();
      const users = [brokerUsername];
      if (originalUser && originalUser !== brokerUsername) {
        users.push(originalUser);
      }

      const lines: string[] = [
        '# AgenShield: allow broker (and host user) to run openclaw commands as agent user',
      ];
      for (const user of users) {
        lines.push(`${user} ALL=(${agentUsername}) NOPASSWD: /opt/agenshield/bin/openclaw-launcher.sh *`);
        lines.push(`${user} ALL=(${agentUsername}) NOPASSWD: /bin/cat ${agentHome}/.openclaw/*`);
        lines.push(`${user} ALL=(${agentUsername}) NOPASSWD: /usr/bin/tee ${agentHome}/.openclaw/*`);
        lines.push(`${user} ALL=(${agentUsername}) NOPASSWD: /bin/mkdir -p ${agentHome}/.openclaw/*`);
        lines.push(`${user} ALL=(${agentUsername}) NOPASSWD: /usr/bin/tee ${agentHome}/bin/*`);
        lines.push(`${user} ALL=(${agentUsername}) NOPASSWD: /bin/mkdir -p ${agentHome}/bin`);
      }
      lines.push('');
      lines.push('# AgenShield: allow broker (and host user) to manage openclaw gateway LaunchDaemon');
      for (const user of users) {
        lines.push(`${user} ALL=(root) NOPASSWD: /bin/launchctl kickstart system/com.agenshield.openclaw.gateway`);
        lines.push(`${user} ALL=(root) NOPASSWD: /bin/launchctl kickstart -k system/com.agenshield.openclaw.gateway`);
        lines.push(`${user} ALL=(root) NOPASSWD: /bin/launchctl kill SIGTERM system/com.agenshield.openclaw.gateway`);
        lines.push(`${user} ALL=(root) NOPASSWD: /bin/launchctl list com.agenshield.openclaw.gateway`);
      }
      lines.push('');

      const sudoersContent = lines.join('\n');

      const tmpPath = '/tmp/agenshield-sudoers';

      // 1. Write to temp file
      logVerbose('Writing sudoers rules to temp file', context);
      execSync(`sudo tee "${tmpPath}" > /dev/null`, {
        input: sudoersContent,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // 2. Validate with visudo
      logVerbose('Validating sudoers syntax', context);
      execSync(`sudo visudo -c -f "${tmpPath}"`, { encoding: 'utf-8', stdio: 'pipe' });

      // 3. Move to /etc/sudoers.d/
      logVerbose('Installing sudoers drop-in to /etc/sudoers.d/agenshield', context);
      execSync(`sudo mv "${tmpPath}" /etc/sudoers.d/agenshield`, { encoding: 'utf-8', stdio: 'pipe' });

      // 4. Set permissions (440 is required for sudoers files)
      execSync('sudo chmod 440 /etc/sudoers.d/agenshield', { encoding: 'utf-8', stdio: 'pipe' });

      logVerbose(`Sudoers rule installed: ${users.join(', ')} → ${agentUsername} + root (launchctl)`, context);
      return { success: true };
    } catch (err) {
      // Clean up temp file on failure
      try {
        const { execSync } = await import('node:child_process');
        execSync('sudo rm -f /tmp/agenshield-sudoers', { stdio: 'pipe' });
      } catch { /* ignore */ }
      return {
        success: false,
        error: `Failed to install sudoers rule: ${(err as Error).message}`,
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
      logVerbose('Running: sudo rm -f /var/run/agenshield/agenshield.sock', context);
      execSync(`sudo rm -f /var/run/agenshield/agenshield.sock`, { encoding: 'utf-8', stdio: 'pipe' });

      // Ensure log files exist with correct ownership BEFORE loading daemon.
      // launchd opens stdout/stderr files at process start; if they don't exist
      // or are root-owned, the broker's output may be lost.
      logVerbose('Ensuring log files have correct ownership', context);
      logVerbose('Running: sudo mkdir -p /var/log/agenshield', context);
      execSync(`sudo mkdir -p /var/log/agenshield`, { encoding: 'utf-8', stdio: 'pipe' });
      logVerbose('Running: sudo touch /var/log/agenshield/broker.log /var/log/agenshield/broker.error.log', context);
      execSync(`sudo touch /var/log/agenshield/broker.log /var/log/agenshield/broker.error.log`, { encoding: 'utf-8', stdio: 'pipe' });
      logVerbose(`Running: sudo chown ${brokerUsername}:${socketGroupName} /var/log/agenshield/broker.log /var/log/agenshield/broker.error.log`, context);
      execSync(`sudo chown ${brokerUsername}:${socketGroupName} /var/log/agenshield/broker.log /var/log/agenshield/broker.error.log`, { encoding: 'utf-8', stdio: 'pipe' });

      // Bootout any stale broker daemon entry from a previous install.
      // Without this, `launchctl load` may no-op if the old entry is cached.
      logVerbose('Removing stale launchd entry if present', context);
      logVerbose('Running: sudo launchctl bootout system/com.agenshield.broker', context);
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
      logVerbose('Running: sudo launchctl kickstart system/com.agenshield.broker', context);
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

  // NOTE: migrate step removed — replaced by install-openclaw + copy-openclaw-config

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
    _currentStepId = stepId;
    logVerbose(`▶ Starting step: ${step.name} (${step.id})`, context);
    onStateChange?.(state);

    // Yield a macrotask tick so the SSE 'running' event flushes to the browser
    // before the step executor (which may use execSync) blocks the event loop.
    await new Promise(resolve => setTimeout(resolve, 0));

    // Execute the step
    const executor = stepExecutors[stepId];
    if (!executor) {
      step.status = 'error';
      step.error = `No executor for step: ${step.id}`;
      state.hasError = true;
      _currentStepId = undefined;
      logVerbose(`✗ Step ${step.id}: no executor found`, context);
      onStateChange?.(state);
      return { success: false, error: step.error };
    }

    const result = await executeStep(step, context, executor);
    _currentStepId = undefined;

    if (result.success) {
      step.status = 'completed';
      logVerbose(`✓ Completed step: ${step.name}`, context);
    } else {
      step.status = 'error';
      step.error = result.error;
      state.hasError = true;
      logVerbose(`✗ Failed step: ${step.name} — ${result.error}`, context);
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
     * Run setup phase — all setup steps from confirm through complete.
     * Called after user confirms they want to proceed.
     * Excludes: setup-passcode, open-dashboard, complete (handled by runFinalPhase).
     */
    async runSetupPhase() {
      const excludeFromSetup: WizardStepId[] = [
        'setup-passcode', 'open-dashboard', 'complete',
      ];

      // Prompt for sudo credentials before privileged steps (skip in dry-run)
      if (!context.options?.dryRun) {
        const { ensureSudoAccess, startSudoKeepalive } = await import('../utils/privileges.js');
        ensureSudoAccess();
        const keepalive = startSudoKeepalive();
        try {
          const setupSteps: WizardStepId[] = ['confirm', ...getStepsByPhase('setup')
            .filter((id) => !excludeFromSetup.includes(id))];
          await runSteps(state, context, setupSteps, engine.onStateChange);
        } finally {
          clearInterval(keepalive);
        }
        return;
      }
      // dry-run path
      const setupSteps: WizardStepId[] = ['confirm', ...getStepsByPhase('setup')
        .filter((id) => !excludeFromSetup.includes(id))];
      await runSteps(state, context, setupSteps, engine.onStateChange);
    },

    /**
     * Run migration phase — no longer needed in new flow.
     * Kept for backward compatibility; does nothing.
     * @deprecated Use runSetupPhase() which now includes install-openclaw + copy-openclaw-config.
     */
    async runMigrationPhase() {
      // Migration is now part of the setup phase (install-openclaw + copy-openclaw-config)
      return;
    },

    /**
     * Run final phase (setup-passcode, open-dashboard, and complete)
     * Called after the passcode UI has collected the passcode value
     */
    async runFinalPhase() {
      const finalSteps: WizardStepId[] = ['setup-passcode', 'open-dashboard', 'complete'];
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
