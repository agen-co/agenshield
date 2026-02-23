/**
 * OpenClaw Preset
 *
 * Preset for detecting and migrating OpenClaw AI coding agent installations.
 * Supports both npm global and git clone installations.
 */

import * as path from 'node:path';
import type {
  TargetPreset,
  PresetDetectionResult,
  MigrationContext,
  PresetMigrationResult,
  InstallContext,
  InstallResult,
} from './types.js';
import type { MigrationScanResult } from '@agenshield/ipc';
import {
  checkedExecAsRoot,
  checkedExecAsUser,
  nvmCommand,
  brewEnv,
  installHomebrew,
  installNvmAndNode,
  copyNodeBinary,
  patchNvmNode,
} from './install-helpers.js';
import { TargetAppInstallError } from '../errors.js';
import { detectOpenClaw } from '../detect.js';
import { scanHost } from '../host-scanner.js';
import { migrateOpenClaw, type MigrationSource } from '../migration.js';
import type { SandboxUser, DirectoryStructure as LegacyDirectoryStructure } from '../types.js';

/**
 * OpenClaw preset implementation
 */
export const openclawPreset: TargetPreset = {
  id: 'openclaw',
  name: 'OpenClaw',
  description: 'AI coding agent (auto-detected via npm or git)',

  requiredBins: ['node', 'npm', 'npx', 'git', 'curl', 'bash', 'shieldctl'],
  optionalBins: ['wget', 'ssh', 'scp', 'python3', 'pip', 'brew'],
  policyPresetIds: ['openclaw'],

  async detect(): Promise<PresetDetectionResult | null> {
    const result = detectOpenClaw();

    if (!result.installation.found) {
      // Binary not found, but config dir may exist (e.g. skills on disk without openclaw installed)
      if (result.installation.configPath) {
        return { found: false, configPath: result.installation.configPath };
      }
      return null;
    }

    return {
      found: true,
      version: result.installation.version,
      packagePath: result.installation.packagePath,
      binaryPath: result.installation.binaryPath,
      configPath: result.installation.configPath,
      method: result.installation.method === 'unknown' ? undefined : result.installation.method,
    };
  },

  async scan(detection: PresetDetectionResult): Promise<MigrationScanResult | null> {
    // Build the config JSON path from the detection config directory
    const configJsonPath = detection.configPath
      ? path.join(detection.configPath, 'openclaw.json')
      : undefined;

    return scanHost({ configPath: configJsonPath });
  },

  async migrate(context: MigrationContext): Promise<PresetMigrationResult> {
    if (!context.detection?.packagePath) {
      return { success: false, error: 'OpenClaw package path not detected' };
    }

    // Convert to legacy types for existing migration function
    const source: MigrationSource = {
      method: (context.detection.method as 'npm' | 'git') || 'npm',
      packagePath: context.detection.packagePath,
      binaryPath: context.detection.binaryPath,
      configPath: context.detection.configPath,
      selection: context.selection,
    };

    const user: SandboxUser = {
      username: context.agentUser.username,
      uid: context.agentUser.uid,
      gid: context.agentUser.gid,
      homeDir: context.agentUser.home,
      shell: context.agentUser.shell,
    };

    const dirs: LegacyDirectoryStructure = {
      binDir: context.directories.binDir,
      wrappersDir: context.directories.wrappersDir,
      configDir: context.directories.configDir,
      packageDir: context.directories.packageDir,
      npmDir: context.directories.npmDir,
    };

    // Use existing migration logic
    const result = migrateOpenClaw(source, user, dirs);

    return {
      success: result.success,
      error: result.error,
      newPaths: result.newPaths,
    };
  },

  getEntryCommand(context: MigrationContext): string {
    return `${context.directories.binDir}/openclaw`;
  },

  async install(ctx: InstallContext): Promise<InstallResult> {
    const version = ctx.requestedVersion ?? ctx.detection?.version ?? 'latest';

    try {
      // 1. Homebrew (0-15%)
      ctx.onProgress('installing_homebrew', 5, 'Installing Homebrew...');
      ctx.onLog('Step 1/9: Installing Homebrew');
      await installHomebrew(ctx);

      // 2. NVM + Node.js (15-35%)
      ctx.onProgress('installing_nvm', 20, 'Installing NVM and Node.js...');
      ctx.onLog('Step 2/9: Installing NVM and Node.js v24');
      await installNvmAndNode(ctx, '24');

      // 3. Copy node binary (35-40%)
      ctx.onProgress('copying_node', 38, 'Copying node binary...');
      ctx.onLog('Step 3/9: Copying node binary to /opt/agenshield/bin');
      await copyNodeBinary(ctx);

      // 4. Install OpenClaw (40-60%)
      ctx.onProgress('installing_openclaw', 45, `Installing OpenClaw ${version}...`);
      ctx.onLog(`Step 4/9: Installing OpenClaw ${version} via official installer`);
      const versionFlag = version && version !== 'latest' ? ` --version ${version}` : '';
      try {
        await checkedExecAsUser(ctx,
          `export HOME="${ctx.agentHome}" && ${brewEnv(ctx.agentHome)} && curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard --no-prompt${versionFlag}`,
          'install_openclaw', 300_000,
        );
      } catch (err) {
        throw new TargetAppInstallError((err as Error).message, 'openclaw');
      }

      // 5. Stop host OpenClaw (60-65%)
      ctx.onProgress('stopping_host', 62, 'Stopping host OpenClaw processes...');
      ctx.onLog('Step 5/9: Stopping host OpenClaw daemons');
      // Kill openclaw daemon/gateway processes running as the host user (best-effort)
      await ctx.execAsRoot(
        `pkill -f "openclaw.*daemon" -u $(id -u ${ctx.hostUsername}) 2>/dev/null; pkill -f "openclaw.*gateway" -u $(id -u ${ctx.hostUsername}) 2>/dev/null; true`,
        { timeout: 15_000 },
      );

      // 6. Copy host config (65-75%)
      ctx.onProgress('copying_config', 68, 'Copying host configuration...');
      ctx.onLog('Step 6/9: Copying host OpenClaw configuration');
      const hostConfigDir = `/Users/${ctx.hostUsername}/.openclaw`;
      const agentConfigDir = `${ctx.agentHome}/.openclaw`;
      await ctx.execAsRoot([
        `if [ -d "${hostConfigDir}" ]; then`,
        `  cp -a "${hostConfigDir}" "${agentConfigDir}"`,
        `  chown -R ${ctx.agentUsername}:${ctx.socketGroupName} "${agentConfigDir}"`,
        // Rewrite paths in config file
        `  if [ -f "${agentConfigDir}/openclaw.json" ]; then`,
        `    sed -i '' 's|/Users/${ctx.hostUsername}|${ctx.agentHome}|g' "${agentConfigDir}/openclaw.json"`,
        '  fi',
        'fi',
      ].join('\n'), { timeout: 30_000 });

      // 7. Onboard — skipped: --no-onboard was passed to the installer.
      //    Kept as a safety net verify step.
      ctx.onProgress('onboarding', 78, 'Verifying OpenClaw setup...');
      ctx.onLog('Step 7/9: Verifying OpenClaw setup (onboard skipped via installer)');
      await ctx.execAsUser(
        nvmCommand(ctx.agentHome, 'openclaw --version 2>/dev/null; true'),
        { timeout: 30_000 },
      );

      // 8. Patch NVM node (85-95%)
      ctx.onProgress('patching_node', 88, 'Patching NVM node with interceptor...');
      ctx.onLog('Step 8/9: Patching NVM node with interceptor wrapper');
      await patchNvmNode(ctx);

      // 9. Write gateway plist (95-100%) — NOT loaded yet; target-lifecycle
      //    will start the gateway AFTER the broker socket is confirmed.
      ctx.onProgress('writing_gateway_plist', 96, 'Writing OpenClaw gateway LaunchDaemon...');
      ctx.onLog('Step 9/9: Writing OpenClaw gateway LaunchDaemon (deferred start)');
      const gatewayPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.agenshield.openclaw.gateway</string>
  <key>UserName</key>
  <string>${ctx.agentUsername}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>source ${ctx.agentHome}/.nvm/nvm.sh &amp;&amp; openclaw gateway start</string>
  </array>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ExitTimeOut</key>
  <integer>20</integer>
  <key>StandardOutPath</key>
  <string>/var/log/agenshield/openclaw-gateway.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/agenshield/openclaw-gateway.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${ctx.agentHome}</string>
    <key>NVM_DIR</key>
    <string>${ctx.agentHome}/.nvm</string>
    <key>HOMEBREW_PREFIX</key>
    <string>${ctx.agentHome}/homebrew</string>
    <key>HOMEBREW_CELLAR</key>
    <string>${ctx.agentHome}/homebrew/Cellar</string>
  </dict>
</dict>
</plist>`;

      const gatewayPlistPath = '/Library/LaunchDaemons/com.agenshield.openclaw.gateway.plist';
      await checkedExecAsRoot(ctx, [
        'mkdir -p /var/log/agenshield',
        `cat > "${gatewayPlistPath}" << 'GATEWAYPLIST_EOF'\n${gatewayPlist}\nGATEWAYPLIST_EOF`,
        `chmod 644 "${gatewayPlistPath}"`,
      ].join(' && '), 'gateway_plist', 15_000);

      ctx.onProgress('complete', 100, 'OpenClaw installation complete');
      ctx.onLog('OpenClaw installation complete.');

      // Get the installed binary path
      const binPathResult = await ctx.execAsUser(
        nvmCommand(ctx.agentHome, 'which openclaw'),
        { timeout: 10_000 },
      );

      return {
        success: true,
        appBinaryPath: binPathResult.success ? binPathResult.output.trim() : undefined,
        gatewayPlistPath,
        version,
      };
    } catch (err) {
      const message = (err as Error).message;
      const step = (err as { step?: string }).step ?? 'unknown';
      return { success: false, failedStep: step, error: message };
    }
  },
};
