/**
 * Target lifecycle management routes
 *
 * Detect, shield, unshield, start, and stop targets. Each privileged
 * operation routes through app.privilegeExecutor (persistent root helper).
 */

import type { FastifyInstance } from 'fastify';
import type { ApiResponse, DetectedTarget } from '@agenshield/ipc';
import { getStorage } from '@agenshield/storage';
import { emitEvent } from '../events/emitter';
import { ShieldLogger } from '../services/shield-logger';

// ── UID allocation helper ────────────────────────────────────────

function allocateNextUidGid(): { baseUid: number; baseGid: number } {
  const DEFAULT_BASE_UID = 5200;
  const DEFAULT_BASE_GID = 5100;
  const BLOCK = 10;
  try {
    const storage = getStorage();
    const usedUids = storage.profiles.getAll()
      .map((p: { agentUid?: number }) => p.agentUid)
      .filter((uid): uid is number => uid != null);
    if (usedUids.length === 0) return { baseUid: DEFAULT_BASE_UID, baseGid: DEFAULT_BASE_GID };
    const nextUid = Math.max(...usedUids) + BLOCK;
    return { baseUid: nextUid, baseGid: DEFAULT_BASE_GID + (nextUid - DEFAULT_BASE_UID) };
  } catch {
    return { baseUid: DEFAULT_BASE_UID, baseGid: DEFAULT_BASE_GID };
  }
}

// ── Detection helpers (extracted from setup/routes) ──────────────

export async function detectTargets(): Promise<DetectedTarget[]> {
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

  // Cross-reference with storage profiles to mark shielded targets
  try {
    const storage = getStorage();
    const profiles = storage.profiles.getAll();
    for (const target of targets) {
      const profile = profiles.find(
        (p: { presetId?: string }) => p.presetId === target.id,
      );
      if (profile) {
        target.shielded = true;
      }
    }

    // Append additional shielded profiles (multi-instance support)
    const { getPreset: getPresetFn } = await import('@agenshield/sandbox');
    const representedPresetIds = new Set(targets.filter((t) => t.shielded).map((t) => t.id));
    for (const profile of profiles) {
      if ((profile as { type?: string }).type !== 'target' || !profile.presetId) continue;
      if (representedPresetIds.has(profile.presetId)) continue; // First instance already shown

      const basePreset = getPresetFn(profile.presetId);
      targets.push({
        id: profile.id,
        name: profile.name ?? basePreset?.name ?? profile.presetId,
        type: profile.presetId,
        method: 'profile',
        shielded: true,
      });
    }
  } catch {
    // Storage not ready — leave shielded as false
  }

  return targets;
}

export async function detectOldInstallations(): Promise<import('@agenshield/ipc').OldInstallation[]> {
  const installations: import('@agenshield/ipc').OldInstallation[] = [];

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

// ── Target status type ──────────────────────────────────────────

interface TargetInfo {
  id: string;
  name: string;
  type: string;
  shielded: boolean;
  running: boolean;
  version?: string;
  binaryPath?: string;
}

// ── Route registration ──────────────────────────────────────────

export async function targetLifecycleRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /targets/lifecycle — List targets with status.
   * Combines detection scan with profile storage.
   */
  app.get('/targets/lifecycle', async (): Promise<ApiResponse<TargetInfo[]>> => {
    try {
      const detected = await detectTargets();
      const storage = getStorage();
      const profiles = storage.profiles.getAll();

      const results: TargetInfo[] = detected.map((target) => {
        const profile = profiles.find(
          (p: { presetId?: string }) => p.presetId === target.id,
        );
        return {
          id: target.id,
          name: target.name,
          type: target.type,
          shielded: !!profile,
          running: false, // Will be updated below
          version: target.version,
          binaryPath: target.binaryPath,
        };
      });

      // Check running status via launchctl
      try {
        const { execSync } = await import('node:child_process');
        for (const target of results) {
          if (target.shielded) {
            try {
              const matchedProfile = profiles.find((p: { id: string; presetId?: string }) =>
                p.id === target.id || p.presetId === target.id,
              );
              const runBaseName = matchedProfile?.agentUsername?.replace(/^ash_/, '').replace(/_agent$/, '') ?? target.id;
              const output = execSync(
                `launchctl list | grep com.agenshield.broker.${runBaseName} 2>/dev/null || true`,
                { encoding: 'utf-8', timeout: 5_000 },
              );
              target.running = output.trim().length > 0;
            } catch {
              // Can't check — leave as false
            }
          }
        }
      } catch {
        // execSync not available
      }

      return { success: true, data: results };
    } catch (err) {
      return {
        success: false,
        error: { code: 'TARGET_LIST_ERROR', message: (err as Error).message },
      };
    }
  });

  /**
   * POST /targets/lifecycle/detect — Run fresh target detection.
   */
  app.post('/targets/lifecycle/detect', async (): Promise<ApiResponse<DetectedTarget[]>> => {
    try {
      const targets = await detectTargets();
      return { success: true, data: targets };
    } catch (err) {
      return {
        success: false,
        error: { code: 'DETECT_ERROR', message: (err as Error).message },
      };
    }
  });

  /**
   * POST /targets/lifecycle/:targetId/shield — Shield a detected target.
   */
  app.post<{ Params: { targetId: string }; Body: { baseName?: string; hostUsername?: string; openclawVersion?: string } }>(
    '/targets/lifecycle/:targetId/shield',
    async (request, reply) => {
      const { targetId } = request.params;
      const body = (request.body ?? {}) as { baseName?: string; hostUsername?: string; openclawVersion?: string };
      const executor = app.privilegeExecutor;

      if (!executor) {
        return reply.code(503).send({
          success: false,
          error: { code: 'NO_EXECUTOR', message: 'Privilege executor not available. Restart the daemon.' },
        });
      }

      // Pre-flight: validate baseName format
      const baseName = body.baseName || targetId.replace(/-/g, '');
      if (!/^[a-z0-9]+$/.test(baseName)) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_BASE_NAME', message: `Invalid baseName "${baseName}": must be lowercase alphanumeric only.` },
        });
      }

      // Resolve host username (for config migration)
      const hostUsername = body.hostUsername || process.env['USER'] || process.env['LOGNAME'] || '';

      // Rate-limited log emitter — max 2 events/sec to avoid flooding SSE during install
      const LOG_MIN_INTERVAL = 500; // ms
      let lastLogTime = 0;
      let pendingLog: { message: string; stepId?: string } | null = null;
      let pendingLogTimer: ReturnType<typeof setTimeout> | null = null;

      const log = (message: string, stepId?: string) => {
        const now = Date.now();
        if (now - lastLogTime >= LOG_MIN_INTERVAL) {
          lastLogTime = now;
          emitEvent('setup:log', { targetId, message, stepId });
        } else {
          pendingLog = { message, stepId };
          if (!pendingLogTimer) {
            pendingLogTimer = setTimeout(() => {
              if (pendingLog) {
                emitEvent('setup:log', { targetId, message: pendingLog.message, stepId: pendingLog.stepId });
                lastLogTime = Date.now();
              }
              pendingLog = null;
              pendingLogTimer = null;
            }, LOG_MIN_INTERVAL);
          }
        }
      };

      /** Flush any pending log and clear the timer (call before returning). */
      const flushLog = () => {
        if (pendingLogTimer) {
          clearTimeout(pendingLogTimer);
          pendingLogTimer = null;
        }
        if (pendingLog) {
          emitEvent('setup:log', { targetId, message: pendingLog.message, stepId: pendingLog.stepId });
          pendingLog = null;
        }
      };

      let currentStep = 'initializing';
      const shieldLog = new ShieldLogger(targetId);

      try {
        emitEvent('setup:shield_progress', { targetId, step: 'initializing', progress: 0, message: 'Preparing to shield target...' });
        shieldLog.step('initializing', 'Preparing to shield target...');

        // 0. Clean up stale ash_default_* users if not associated with any profile
        log('Checking for stale default installations...', 'cleanup_stale');
        shieldLog.step('cleanup_stale', 'Checking for stale default installations...');
        try {
          const storageForCleanup = getStorage();
          const existingProfiles = storageForCleanup.profiles.getAll();
          const staleUsers = ['ash_default_agent', 'ash_default_broker'];
          for (const staleUser of staleUsers) {
            const hasProfile = existingProfiles.some(
              (p: { agentUsername?: string; brokerUsername?: string }) =>
                p.agentUsername === staleUser || p.brokerUsername === staleUser,
            );
            if (!hasProfile) {
              const exists = await executor.execAsRoot(`dscl . -read /Users/${staleUser} 2>/dev/null`, { timeout: 5_000 });
              if (exists.success) {
                log(`Removing stale user ${staleUser}...`, 'cleanup_stale');
                await executor.execAsRoot(`pkill -u ${staleUser} 2>/dev/null; sleep 1; dscl . -delete /Users/${staleUser} 2>/dev/null; true`, { timeout: 15_000 });
              }
            }
          }
          // Clean up stale groups
          for (const staleGroup of ['ash_default', 'ash_default_workspace']) {
            await executor.execAsRoot(`dscl . -delete /Groups/${staleGroup} 2>/dev/null; true`, { timeout: 5_000 }).catch(() => {});
          }
          // Clean up stale home directory, LaunchDaemon, sudoers
          await executor.execAsRoot([
            'rm -rf /Users/ash_default_agent 2>/dev/null',
            'launchctl bootout system/com.agenshield.broker.default 2>/dev/null',
            'rm -f /Library/LaunchDaemons/com.agenshield.broker.default.plist 2>/dev/null',
            'rm -f /etc/sudoers.d/agenshield-default 2>/dev/null',
          ].join('; ') + '; true', { timeout: 15_000 }).catch(() => {});
        } catch {
          // Stale cleanup is best-effort
        }

        // 1. Detect the target's preset (resolve numbered instance IDs like 'claude-code-1')
        currentStep = 'initializing';
        log('Resolving target preset...', 'initializing');
        shieldLog.step('resolve_preset', `Resolving target preset for ${targetId}...`);
        const {
          getPreset,
          resolvePresetId,
          createUserConfig,
          createPathsConfig,
          installPresetBinaries,
          generateAgentProfile,
          generateBrokerPlist,
        } = await import('@agenshield/sandbox');
        const basePresetId = resolvePresetId(targetId);
        const preset = getPreset(basePresetId);
        if (!preset) {
          return reply.code(404).send({
            success: false,
            error: { code: 'PRESET_NOT_FOUND', message: `No preset found for target: ${targetId}` },
          });
        }

        // Run detection for install context
        let detection: import('@agenshield/sandbox').PresetDetectionResult | undefined;
        try {
          const result = await preset.detect();
          if (result) detection = result;
        } catch {
          // Detection is optional for install
        }

        const resolvedBaseName = body.baseName || targetId.replace(/-/g, '');
        const { baseUid, baseGid } = allocateNextUidGid();
        const userConfig = createUserConfig({ baseName: resolvedBaseName, baseUid, baseGid });
        const pathsConfig = createPathsConfig(userConfig);

        // 2. Create sandbox users/groups
        currentStep = 'creating_users';
        emitEvent('setup:shield_progress', { targetId, step: 'creating_users', progress: 5, message: 'Creating sandbox users...' });
        const agentUser = userConfig.agentUser.username;
        const brokerUser = userConfig.brokerUser.username;
        const groupName = userConfig.groups.socket.name;
        const workspaceGroupName = userConfig.groups.workspace.name;

        log(`Creating agent user ${agentUser} (UID ${userConfig.agentUser.uid})...`, 'creating_users');
        shieldLog.step('creating_users', `Creating sandbox users (agent=${agentUser}, broker=${brokerUser}, group=${groupName})...`);
        shieldLog.info(`baseUid=${baseUid}, baseGid=${baseGid}, home=${userConfig.agentUser.home}`);

        // 2a. Create groups (socket + workspace)
        await executor.execAsRoot([
          `dscl . -create /Groups/${groupName}`,
          `dscl . -create /Groups/${groupName} PrimaryGroupID ${userConfig.groups.socket.gid}`,
          `dscl . -create /Groups/${groupName} RealName "${userConfig.groups.socket.description}"`,
          `dscl . -create /Groups/${groupName} Password "*"`,
          `dscl . -create /Groups/${workspaceGroupName}`,
          `dscl . -create /Groups/${workspaceGroupName} PrimaryGroupID ${userConfig.groups.workspace.gid}`,
          `dscl . -create /Groups/${workspaceGroupName} RealName "${userConfig.groups.workspace.description}"`,
          `dscl . -create /Groups/${workspaceGroupName} Password "*"`,
        ].join(' && '), { timeout: 30_000 }).catch(() => {
          // Best-effort — groups may already exist
        });

        // 2b. Create agent user (full record — dscl . -create is required first)
        await executor.execAsRoot([
          `dscl . -create /Users/${agentUser}`,
          `dscl . -create /Users/${agentUser} UniqueID ${userConfig.agentUser.uid}`,
          `dscl . -create /Users/${agentUser} PrimaryGroupID ${userConfig.agentUser.gid}`,
          `dscl . -create /Users/${agentUser} UserShell ${userConfig.agentUser.shell}`,
          `dscl . -create /Users/${agentUser} NFSHomeDirectory ${userConfig.agentUser.home}`,
          `dscl . -create /Users/${agentUser} RealName "${userConfig.agentUser.realname}"`,
          `dscl . -create /Users/${agentUser} Password "*"`,
          `dseditgroup -o edit -a ${agentUser} -t user ${groupName}`,
          `dseditgroup -o edit -a ${agentUser} -t user ${workspaceGroupName}`,
        ].join(' && '), { timeout: 30_000 }).catch(() => {
          // Best-effort — user may already exist
        });

        // 2c. Create broker user (full record)
        log(`Creating broker user ${brokerUser}...`, 'creating_users');
        await executor.execAsRoot([
          `dscl . -create /Users/${brokerUser}`,
          `dscl . -create /Users/${brokerUser} UniqueID ${userConfig.brokerUser.uid}`,
          `dscl . -create /Users/${brokerUser} PrimaryGroupID ${userConfig.brokerUser.gid}`,
          `dscl . -create /Users/${brokerUser} UserShell ${userConfig.brokerUser.shell}`,
          `dscl . -create /Users/${brokerUser} NFSHomeDirectory ${userConfig.brokerUser.home}`,
          `dscl . -create /Users/${brokerUser} RealName "${userConfig.brokerUser.realname}"`,
          `dscl . -create /Users/${brokerUser} Password "*"`,
          `dseditgroup -o edit -a ${brokerUser} -t user ${groupName}`,
        ].join(' && '), { timeout: 30_000 }).catch(() => {
          // Best-effort — user may already exist
        });

        // 3. Create directories
        currentStep = 'creating_directories';
        emitEvent('setup:shield_progress', { targetId, step: 'creating_directories', progress: 10, message: 'Setting up directories...' });
        const agentHome = userConfig.agentUser.home;
        log(`Creating directories under ${agentHome}...`, 'creating_directories');
        shieldLog.step('creating_directories', `Creating directories under ${agentHome}...`);
        await executor.execAsRoot([
          `mkdir -p "${agentHome}" "${agentHome}/bin" "${agentHome}/.config"`,
          `mkdir -p "${pathsConfig.configDir}" "${pathsConfig.seatbeltDir}" "${pathsConfig.socketDir}" "${pathsConfig.logDir}"`,
          `chown -R ${agentUser}:${groupName} "${agentHome}"`,
          `chmod 2775 "${agentHome}"`,
          `chown ${brokerUser}:${groupName} "${pathsConfig.socketDir}"`,
          `chmod 2770 "${pathsConfig.socketDir}"`,
        ].join(' && '), { timeout: 30_000 });

        // 3b. Create .agenshield marker (root-owned, for user identification)
        const meta = JSON.stringify({
          createdAt: new Date().toISOString(),
          version: '1.0',
          username: agentUser,
          uid: userConfig.agentUser.uid,
        }, null, 2);
        await executor.execAsRoot([
          `mkdir -p "${agentHome}/.agenshield"`,
          `cat > "${agentHome}/.agenshield/meta.json" << 'AGSMETA'\n${meta}\nAGSMETA`,
          `chown root:wheel "${agentHome}/.agenshield"`,
          `chmod 755 "${agentHome}/.agenshield"`,
          `chown root:wheel "${agentHome}/.agenshield/meta.json"`,
          `chmod 644 "${agentHome}/.agenshield/meta.json"`,
        ].join(' && '), { timeout: 15_000 });

        // 3c. Install guarded shell (required for `sudo su <agent>` to work)
        currentStep = 'installing_guarded_shell';
        emitEvent('setup:shield_progress', { targetId, step: 'installing_guarded_shell', progress: 15, message: 'Installing guarded shell...' });
        log('Installing guarded shell...', 'installing_guarded_shell');
        shieldLog.step('installing_guarded_shell', 'Installing guarded shell launcher and ZDOTDIR...');
        try {
          const {
            GUARDED_SHELL_PATH,
            GUARDED_SHELL_CONTENT,
            ZDOT_DIR,
            ZDOT_ZSHENV_CONTENT,
            ZDOT_ZSHRC_CONTENT,
          } = await import('@agenshield/sandbox');

          // Write guarded-shell launcher, make executable, add to /etc/shells
          await executor.execAsRoot([
            `cat > "${GUARDED_SHELL_PATH}" << 'GSHELL_EOF'\n${GUARDED_SHELL_CONTENT}\nGSHELL_EOF`,
            `chmod 755 "${GUARDED_SHELL_PATH}"`,
            `grep -qxF "${GUARDED_SHELL_PATH}" /etc/shells || echo "${GUARDED_SHELL_PATH}" >> /etc/shells`,
          ].join(' && '), { timeout: 15_000 });

          // Write ZDOTDIR files (.zshenv and .zshrc), root-owned
          await executor.execAsRoot([
            `mkdir -p "${ZDOT_DIR}"`,
            `cat > "${ZDOT_DIR}/.zshenv" << 'ZSHENV_EOF'\n${ZDOT_ZSHENV_CONTENT}\nZSHENV_EOF`,
            `cat > "${ZDOT_DIR}/.zshrc" << 'ZSHRC_EOF'\n${ZDOT_ZSHRC_CONTENT}\nZSHRC_EOF`,
            `chown -R root:wheel "${ZDOT_DIR}"`,
            `chmod 644 "${ZDOT_DIR}/.zshenv" "${ZDOT_DIR}/.zshrc"`,
          ].join(' && '), { timeout: 15_000 });

          shieldLog.info('Guarded shell installed successfully.');
        } catch (err) {
          request.log.warn({ targetId, err }, `Guarded shell installation failed: ${(err as Error).message}`);
          shieldLog.warn(`Guarded shell installation failed (non-fatal): ${(err as Error).message}`);
          // Non-fatal — agent user exists but interactive shell may not work
        }

        // 4. Install wrappers
        currentStep = 'installing_wrappers';
        emitEvent('setup:shield_progress', { targetId, step: 'installing_wrappers', progress: 20, message: 'Installing command wrappers...' });
        log('Installing command wrappers...', 'installing_wrappers');
        shieldLog.step('installing_wrappers', `Installing command wrappers (${preset.requiredBins.join(', ')})...`);
        try {
          await installPresetBinaries({
            requiredBins: preset.requiredBins,
            userConfig,
            binDir: `${agentHome}/bin`,
            socketGroupName: groupName,
          });
        } catch (err) {
          request.log.warn({ targetId, err }, `Wrapper installation partial: ${(err as Error).message}`);
        }

        // 4b. PATH router override
        currentStep = 'path_override';
        emitEvent('setup:shield_progress', { targetId, step: 'path_override', progress: 30, message: 'Configuring PATH router...' });
        log('Installing PATH router override...', 'path_override');
        shieldLog.step('path_override', 'Installing PATH router override...');
        try {
          const {
            findOriginalBinary,
            addRegistryInstance,
            generateRouterWrapper,
            buildInstallRouterCommands,
          } = await import('@agenshield/sandbox');

          // Determine the binary name from base preset ID (e.g. 'claude-code' → 'claude')
          const binName = basePresetId.split('-')[0];

          // Find the original binary, skipping any existing router wrappers
          const originalBinary = findOriginalBinary(binName) ?? '';

          // Register this instance in the path registry (with agentUsername for sudo delegation)
          const updatedRegistry = addRegistryInstance(binName, {
            targetId,
            profileId: `${targetId}-${Date.now().toString(36)}`,
            name: preset.name,
            agentBinPath: `${agentHome}/bin/${binName}`,
            baseName: resolvedBaseName,
            agentUsername: agentUser,
          }, originalBinary);

          // Write registry via root (it's in /etc/agenshield/)
          const registryJson = JSON.stringify(updatedRegistry, null, 2);
          await executor.execAsRoot([
            'mkdir -p /etc/agenshield',
            `cat > /etc/agenshield/path-registry.json << 'REGISTRY_EOF'\n${registryJson}\nREGISTRY_EOF`,
            'chmod 644 /etc/agenshield/path-registry.json',
          ].join(' && '), { timeout: 15_000 });

          // Generate and install the router wrapper
          const wrapperContent = generateRouterWrapper(binName);
          const installCmd = buildInstallRouterCommands(binName, wrapperContent);
          await executor.execAsRoot(installCmd, { timeout: 15_000 });
        } catch (err) {
          request.log.warn({ targetId, err }, `PATH override partial: ${(err as Error).message}`);
          // Non-fatal — continue with shield
        }

        // 5. Install target app environment (via preset.install())
        let gatewayPlistPath: string | undefined;
        if (preset.install) {
          currentStep = 'installing_target';
          emitEvent('setup:shield_progress', { targetId, step: 'installing_target', progress: 35, message: `Installing ${preset.name}...` });
          log(`Installing ${preset.name} environment...`, 'installing_target');
          shieldLog.step('installing_target', `Installing ${preset.name} environment via preset.install()...`);

          const installResult = await preset.install({
            agentHome,
            agentUsername: agentUser,
            socketGroupName: groupName,
            workspaceGroupName,
            detection,
            hostUsername,
            requestedVersion: body.openclawVersion,
            execAsRoot: (cmd, opts) => {
              shieldLog.command(cmd, { timeout: opts?.timeout });
              const p = executor.execAsRoot(cmd, opts);
              p.then(r => shieldLog.result(r.success, r.output, r.error));
              return p;
            },
            execAsUser: (cmd, opts) => {
              shieldLog.command(cmd, { user: agentUser, timeout: opts?.timeout });
              const p = executor.execAsUser(agentUser, cmd, opts);
              p.then(r => shieldLog.result(r.success, r.output, r.error));
              return p;
            },
            onProgress: (step, progress, message) => {
              // Map install sub-progress (0-100) to overall range (35-80%)
              const overallProgress = 35 + Math.round(progress * 0.45);
              emitEvent('setup:shield_progress', { targetId, step, progress: overallProgress, message });
            },
            onLog: (message) => {
              log(message, 'installing_target');
              shieldLog.info(message);
            },
          });

          if (!installResult.success) {
            shieldLog.error(`Target installation failed at step "${installResult.failedStep}": ${installResult.error}`);
            throw new Error(`Target installation failed at step "${installResult.failedStep}": ${installResult.error}`);
          }
          gatewayPlistPath = installResult.gatewayPlistPath;
          log(`${preset.name} installation complete.`, 'installing_target');
          shieldLog.info(`${preset.name} installation complete.`);
        }

        // 6. Generate seatbelt profile
        currentStep = 'generating_seatbelt';
        emitEvent('setup:shield_progress', { targetId, step: 'generating_seatbelt', progress: 82, message: 'Generating security profile...' });
        log('Generating seatbelt security profile...', 'generating_seatbelt');
        shieldLog.step('generating_seatbelt', 'Generating seatbelt security profile...');
        const seatbeltProfile = generateAgentProfile({
          workspacePath: `${agentHome}/workspace`,
          socketPath: pathsConfig.socketPath,
          agentHome,
        });
        const seatbeltPath = `${pathsConfig.seatbeltDir}/${baseName}-agent.sb`;
        shieldLog.fileContent('Seatbelt profile', seatbeltPath, seatbeltProfile);
        await executor.execAsRoot(
          `cat > "${seatbeltPath}" << 'SEATBELT_EOF'\n${seatbeltProfile}\nSEATBELT_EOF`,
          { timeout: 15_000 },
        );

        // 7. Install sudoers rules
        currentStep = 'installing_sudoers';
        emitEvent('setup:shield_progress', { targetId, step: 'installing_sudoers', progress: 85, message: 'Configuring sudo rules...' });
        log('Installing sudoers rules...', 'installing_sudoers');
        shieldLog.step('installing_sudoers', `Installing sudoers rules for ${hostUsername}...`);
        if (hostUsername) {
          const sudoersContent = [
            `# AgenShield — allows ${hostUsername} to run commands as agent/broker without password`,
            `${hostUsername} ALL=(${agentUser}) NOPASSWD: ALL`,
            `${hostUsername} ALL=(${brokerUser}) NOPASSWD: ALL`,
          ].join('\n');
          const sudoersPath = `/etc/sudoers.d/agenshield-${resolvedBaseName}`;
          await executor.execAsRoot(
            `cat > "${sudoersPath}" << 'SUDOERS_EOF'\n${sudoersContent}\nSUDOERS_EOF\n` +
            `chmod 440 "${sudoersPath}" && visudo -c -f "${sudoersPath}" 2>/dev/null || rm -f "${sudoersPath}"`,
            { timeout: 15_000 },
          );
        }

        // 8. Install broker LaunchDaemon
        currentStep = 'installing_daemon';
        emitEvent('setup:shield_progress', { targetId, step: 'installing_daemon', progress: 88, message: 'Installing broker LaunchDaemon...' });
        log('Installing broker LaunchDaemon...', 'installing_daemon');
        shieldLog.step('installing_broker_daemon', 'Installing broker LaunchDaemon...');
        const plistContent = generateBrokerPlist(userConfig, {
          baseName: resolvedBaseName,
          socketPath: pathsConfig.socketPath,
        });
        const brokerLabel = `com.agenshield.broker.${baseName}`;
        const plistPath = `/Library/LaunchDaemons/${brokerLabel}.plist`;
        shieldLog.fileContent('Broker plist', plistPath, plistContent);
        shieldLog.launchdEvent('load', brokerLabel, plistPath);
        emitEvent('process:started', { process: 'broker', action: 'spawning', pid: undefined } as import('@agenshield/ipc').ProcessEventPayload);
        shieldLog.processEvent('spawning', brokerLabel, { user: brokerUser, plistPath });
        await executor.execAsRoot(
          `cat > "${plistPath}" << 'PLIST_EOF'\n${plistContent}\nPLIST_EOF\nchmod 644 "${plistPath}"\nlaunchctl load "${plistPath}" 2>/dev/null; true`,
          { timeout: 15_000 },
        );
        shieldLog.processEvent('spawned', brokerLabel);

        // 8b. Wait for broker socket before starting gateway (prevents crash loop)
        if (gatewayPlistPath) {
          currentStep = 'waiting_broker_socket';
          emitEvent('setup:shield_progress', { targetId, step: 'waiting_broker_socket', progress: 89, message: 'Waiting for broker socket...' });
          shieldLog.step('waiting_broker_socket', `Waiting for broker socket at ${pathsConfig.socketPath}...`);
          log('Waiting for broker socket...', 'waiting_broker_socket');

          const SOCKET_WAIT_MS = 15_000;
          const POLL_MS = 500;
          const deadline = Date.now() + SOCKET_WAIT_MS;
          let socketReady = false;
          while (Date.now() < deadline) {
            const check = await executor.execAsRoot(
              `test -S "${pathsConfig.socketPath}" && echo READY || echo WAITING`,
              { timeout: 5_000 },
            );
            if (check.success && check.output.trim() === 'READY') {
              socketReady = true;
              break;
            }
            await new Promise(r => setTimeout(r, POLL_MS));
          }

          if (socketReady) {
            shieldLog.info(`Broker socket ready at ${pathsConfig.socketPath}`);
          } else {
            shieldLog.warn(`Broker socket not ready after ${SOCKET_WAIT_MS}ms — starting gateway anyway`);
          }

          // 8c. Start the gateway (deferred — plist was written but not loaded by preset)
          currentStep = 'starting_gateway';
          emitEvent('setup:shield_progress', { targetId, step: 'starting_gateway', progress: 90, message: 'Starting OpenClaw gateway...' });
          shieldLog.step('starting_gateway', 'Loading and starting OpenClaw gateway LaunchDaemon...');
          log('Starting OpenClaw gateway...', 'starting_gateway');

          const gatewayLabel = 'com.agenshield.openclaw.gateway';
          shieldLog.launchdEvent('load', gatewayLabel, gatewayPlistPath);
          shieldLog.processEvent('spawning', gatewayLabel, { user: agentUser, plistPath: gatewayPlistPath });
          emitEvent('process:started', { process: 'gateway', action: 'spawning', pid: undefined } as import('@agenshield/ipc').ProcessEventPayload);

          await executor.execAsRoot(
            `launchctl load "${gatewayPlistPath}" 2>/dev/null && launchctl kickstart system/${gatewayLabel} 2>/dev/null; true`,
            { timeout: 15_000 },
          );
          shieldLog.processEvent('spawned', gatewayLabel);
          shieldLog.info('Gateway LaunchDaemon loaded and kicked');
        }

        // 9. Create profile in storage
        currentStep = 'creating_profile';
        emitEvent('setup:shield_progress', { targetId, step: 'creating_profile', progress: 92, message: 'Saving profile...' });
        log('Creating profile in storage...', 'creating_profile');
        shieldLog.step('creating_profile', 'Creating profile in storage...');
        const storage = getStorage();
        const profileId = `${targetId}-${Date.now().toString(36)}`;
        const profile = storage.profiles.create({
          id: profileId,
          name: preset.name,
          presetId: basePresetId,
          agentUsername: agentUser,
          agentUid: userConfig.agentUser.uid,
          agentHomeDir: agentHome,
          brokerUsername: brokerUser,
          brokerUid: userConfig.brokerUser.uid,
        });

        // 10. Seed preset policies
        if (preset.policyPresetIds?.length) {
          currentStep = 'seeding_policies';
          emitEvent('setup:shield_progress', { targetId, step: 'seeding_policies', progress: 95, message: 'Applying security policies...' });
          log('Seeding preset security policies...', 'seeding_policies');
          shieldLog.step('seeding_policies', `Seeding preset policies: ${preset.policyPresetIds.join(', ')}`);
          const scopedStorage = storage.for({ profileId });
          for (const presetPolicyId of preset.policyPresetIds) {
            const count = scopedStorage.policies.seedPreset(presetPolicyId);
            log(`Seeded ${count} policies from preset "${presetPolicyId}".`, 'seeding_policies');
          }
        }

        emitEvent('setup:shield_progress', { targetId, step: 'complete', progress: 100, message: 'Shielding complete' });
        emitEvent('setup:shield_complete', { targetId, profileId: profile.id });
        log('Shielding complete.', 'complete');
        flushLog();
        shieldLog.finish(true);
        request.log.info({ targetId, logPath: shieldLog.logPath }, 'Shield log saved');

        return { success: true, data: { targetId, profileId: profile.id, logPath: shieldLog.logPath } };
      } catch (err) {
        flushLog();
        const message = (err as Error).message;
        shieldLog.error(`Shield failed at step "${currentStep}": ${message}`);
        shieldLog.finish(false, message);
        request.log.error({ targetId, err, step: currentStep, logPath: shieldLog.logPath }, `Shield failed at step "${currentStep}": ${message}`);
        emitEvent('setup:error', { targetId, error: message, step: currentStep });
        return reply.code(500).send({
          success: false,
          error: { code: 'SHIELD_ERROR', message, step: currentStep, logPath: shieldLog.logPath },
        });
      }
    },
  );

  /**
   * POST /targets/lifecycle/:targetId/unshield — Unshield a target.
   * Complete cleanup: processes, PATH, LaunchDaemons, sudoers, seatbelt,
   * home directory, users, groups, policies, and profile.
   */
  app.post<{ Params: { targetId: string } }>(
    '/targets/lifecycle/:targetId/unshield',
    async (request, reply) => {
      const { targetId } = request.params;
      const executor = app.privilegeExecutor;

      if (!executor) {
        return reply.code(503).send({
          success: false,
          error: { code: 'NO_EXECUTOR', message: 'Privilege executor not available.' },
        });
      }

      try {
        // 0. Look up profile — try exact ID match, then presetId match
        const storage = getStorage();
        const allProfiles = storage.profiles.getAll();
        const profile = allProfiles.find((p) => p.id === targetId)
          ?? allProfiles.find((p: { presetId?: string }) => p.presetId === targetId);

        if (!profile) {
          return reply.code(404).send({
            success: false,
            error: { code: 'PROFILE_NOT_FOUND', message: `No profile found for: ${targetId}` },
          });
        }

        const agentUsername = profile.agentUsername;
        const brokerUsername = profile.brokerUsername;
        const agentHomeDir = profile.agentHomeDir;
        const profileBaseName = agentUsername?.replace(/^ash_/, '').replace(/_agent$/, '') ?? targetId;

        const log = (message: string, stepId?: string) => {
          emitEvent('setup:log', { targetId, message, stepId });
        };

        // 1. Stop target app processes
        emitEvent('setup:shield_progress', { targetId, step: 'stopping_processes', progress: 5, message: 'Stopping target processes...' });
        log('Stopping all processes for agent user...', 'stopping_processes');
        if (agentUsername) {
          await executor.execAsRoot(
            `pkill -u ${agentUsername} 2>/dev/null; sleep 1; pkill -9 -u ${agentUsername} 2>/dev/null; true`,
            { timeout: 15_000 },
          ).catch(() => {});
        }

        // 2. Remove PATH override (restore original binary from backup)
        emitEvent('setup:shield_progress', { targetId, step: 'removing_path', progress: 15, message: 'Removing PATH override...' });
        log('Removing PATH router override...', 'removing_path');
        try {
          const {
            resolvePresetId,
            removeRegistryInstance,
            buildRemoveRouterCommands,
            PATH_REGISTRY_PATH: _registryPath,
          } = await import('@agenshield/sandbox');

          const basePresetId = resolvePresetId(profile.presetId ?? targetId);
          const binName = basePresetId.split('-')[0];

          const { registry, remainingCount } = removeRegistryInstance(binName, targetId);

          if (remainingCount === 0) {
            const removeCmd = buildRemoveRouterCommands(binName);
            await executor.execAsRoot(removeCmd, { timeout: 15_000 }).catch(() => {});
          }

          if (Object.keys(registry).length === 0) {
            await executor.execAsRoot(`rm -f "${_registryPath}"`, { timeout: 5_000 }).catch(() => {});
          } else {
            const registryJson = JSON.stringify(registry, null, 2);
            await executor.execAsRoot([
              `cat > "${_registryPath}" << 'REGISTRY_EOF'\n${registryJson}\nREGISTRY_EOF`,
              `chmod 644 "${_registryPath}"`,
            ].join(' && '), { timeout: 15_000 }).catch(() => {});
          }
        } catch {
          // PATH override cleanup is non-fatal
        }

        // 3. Unload & remove LaunchDaemons (broker + target-specific)
        emitEvent('setup:shield_progress', { targetId, step: 'removing_daemons', progress: 25, message: 'Removing LaunchDaemons...' });
        log('Unloading and removing LaunchDaemons...', 'removing_daemons');
        const plistLabels = [
          `com.agenshield.broker.${profileBaseName}`,
          `com.agenshield.openclaw.gateway`, // target-specific (OpenClaw)
        ];
        for (const label of plistLabels) {
          await executor.execAsRoot(
            `launchctl bootout system/${label} 2>/dev/null; rm -f "/Library/LaunchDaemons/${label}.plist" 2>/dev/null; true`,
            { timeout: 15_000 },
          ).catch(() => {});
        }

        // 4. Remove sudoers rules
        emitEvent('setup:shield_progress', { targetId, step: 'removing_sudoers', progress: 35, message: 'Removing sudo rules...' });
        log('Removing sudoers rules...', 'removing_sudoers');
        await executor.execAsRoot(
          `rm -f "/etc/sudoers.d/agenshield-${profileBaseName}" 2>/dev/null; true`,
          { timeout: 5_000 },
        ).catch(() => {});

        // 5. Remove seatbelt profile
        emitEvent('setup:shield_progress', { targetId, step: 'removing_seatbelt', progress: 45, message: 'Removing security profile...' });
        log('Removing seatbelt profile...', 'removing_seatbelt');
        await executor.execAsRoot(
          `rm -f "/etc/agenshield/seatbelt/${profileBaseName}-agent.sb" 2>/dev/null; true`,
          { timeout: 5_000 },
        ).catch(() => {});

        // 6. Delete agent home directory (includes homebrew, nvm, .openclaw, .claude, workspace)
        emitEvent('setup:shield_progress', { targetId, step: 'removing_home', progress: 55, message: 'Removing agent home directory...' });
        if (agentHomeDir) {
          log(`Removing agent home directory ${agentHomeDir}...`, 'removing_home');
          await executor.execAsRoot(
            `rm -rf "${agentHomeDir}"`,
            { timeout: 60_000 },
          ).catch(() => {});
        }

        // 7. Delete sandbox users (agent + broker)
        emitEvent('setup:shield_progress', { targetId, step: 'removing_users', progress: 65, message: 'Removing sandbox users...' });
        log('Removing sandbox users...', 'removing_users');
        const deleteUserCmds: string[] = [];
        if (agentUsername) deleteUserCmds.push(`dscl . -delete /Users/${agentUsername} 2>/dev/null`);
        if (brokerUsername) deleteUserCmds.push(`dscl . -delete /Users/${brokerUsername} 2>/dev/null`);
        if (deleteUserCmds.length > 0) {
          await executor.execAsRoot(
            deleteUserCmds.join('; ') + '; true',
            { timeout: 15_000 },
          ).catch(() => {});
        }

        // 8. Delete sandbox groups (socket + workspace)
        emitEvent('setup:shield_progress', { targetId, step: 'removing_groups', progress: 75, message: 'Removing sandbox groups...' });
        log('Removing sandbox groups...', 'removing_groups');
        const socketGroupName = `ash_${profileBaseName}`;
        const workspaceGroupName = `ash_${profileBaseName}_workspace`;
        await executor.execAsRoot([
          `dscl . -delete /Groups/${socketGroupName} 2>/dev/null`,
          `dscl . -delete /Groups/${workspaceGroupName} 2>/dev/null`,
        ].join('; ') + '; true', { timeout: 15_000 }).catch(() => {});

        // 9. Delete seeded policies
        emitEvent('setup:shield_progress', { targetId, step: 'removing_policies', progress: 82, message: 'Removing policies...' });
        log('Removing seeded policies...', 'removing_policies');
        try {
          const scopedStorage = storage.for({ profileId: profile.id });
          scopedStorage.policies.deleteAll();
        } catch {
          // Best-effort
        }

        // 10. Delete profile from storage
        emitEvent('setup:shield_progress', { targetId, step: 'removing_profile', progress: 90, message: 'Removing profile...' });
        log('Removing profile from storage...', 'removing_profile');
        storage.profiles.delete(profile.id);

        // 11. Clean up .agenshield/meta.json marker (already removed with home dir, but just in case)
        emitEvent('setup:shield_progress', { targetId, step: 'cleanup', progress: 95, message: 'Final cleanup...' });

        emitEvent('setup:shield_progress', { targetId, step: 'complete', progress: 100, message: 'Unshielding complete' });
        emitEvent('setup:shield_complete', { targetId, profileId: profile.id });
        log('Unshielding complete.', 'complete');

        return { success: true, data: { targetId, unshielded: true } };
      } catch (err) {
        const message = (err as Error).message;
        request.log.error({ targetId, err }, `Unshield failed: ${message}`);
        emitEvent('setup:error', { targetId, error: message });
        return reply.code(500).send({
          success: false,
          error: { code: 'UNSHIELD_ERROR', message },
        });
      }
    },
  );

  /**
   * POST /targets/lifecycle/:targetId/start — Start a shielded target.
   */
  app.post<{ Params: { targetId: string } }>(
    '/targets/lifecycle/:targetId/start',
    async (request, reply) => {
      const { targetId } = request.params;
      const executor = app.privilegeExecutor;

      if (!executor) {
        return reply.code(503).send({
          success: false,
          error: { code: 'NO_EXECUTOR', message: 'Privilege executor not available.' },
        });
      }

      try {
        const storage = getStorage();
        const allProfiles = storage.profiles.getAll();
        const profile = allProfiles.find((p) => p.id === targetId)
          ?? allProfiles.find((p: { presetId?: string }) => p.presetId === targetId);
        const startBaseName = profile?.agentUsername?.replace(/^ash_/, '').replace(/_agent$/, '') ?? targetId;

        // Try baseName-suffixed label first, fall back to legacy label
        const labels = [`com.agenshield.broker.${startBaseName}`, 'com.agenshield.broker'];
        let lastError: Error | undefined;
        for (const label of labels) {
          try {
            await executor.execAsRoot(`launchctl kickstart -k system/${label}`, { timeout: 15_000 });
            lastError = undefined;
            break;
          } catch (err) {
            lastError = err as Error;
          }
        }
        if (lastError) throw lastError;

        emitEvent('process:started', { process: targetId, action: 'start' });
        return { success: true, data: { targetId, started: true } };
      } catch (err) {
        return reply.code(500).send({
          success: false,
          error: { code: 'START_ERROR', message: (err as Error).message },
        });
      }
    },
  );

  /**
   * POST /targets/lifecycle/:targetId/stop — Stop a shielded target.
   */
  app.post<{ Params: { targetId: string } }>(
    '/targets/lifecycle/:targetId/stop',
    async (request, reply) => {
      const { targetId } = request.params;
      const executor = app.privilegeExecutor;

      if (!executor) {
        return reply.code(503).send({
          success: false,
          error: { code: 'NO_EXECUTOR', message: 'Privilege executor not available.' },
        });
      }

      try {
        const storage = getStorage();
        const allProfiles = storage.profiles.getAll();
        const profile = allProfiles.find((p) => p.id === targetId)
          ?? allProfiles.find((p: { presetId?: string }) => p.presetId === targetId);
        const stopBaseName = profile?.agentUsername?.replace(/^ash_/, '').replace(/_agent$/, '') ?? targetId;

        // Try baseName-suffixed label first, fall back to legacy label
        const labels = [`com.agenshield.broker.${stopBaseName}`, 'com.agenshield.broker'];
        let lastError: Error | undefined;
        for (const label of labels) {
          try {
            await executor.execAsRoot(`launchctl kill SIGTERM system/${label}`, { timeout: 15_000 });
            lastError = undefined;
            break;
          } catch (err) {
            lastError = err as Error;
          }
        }
        if (lastError) throw lastError;

        emitEvent('process:stopped', { process: targetId, action: 'stop' });
        return { success: true, data: { targetId, stopped: true } };
      } catch (err) {
        return reply.code(500).send({
          success: false,
          error: { code: 'STOP_ERROR', message: (err as Error).message },
        });
      }
    },
  );
}
