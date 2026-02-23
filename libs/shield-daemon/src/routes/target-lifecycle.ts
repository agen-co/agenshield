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
import { ShieldStepTracker } from '../services/shield-step-tracker';
import { ManifestBuilder } from '../services/manifest-builder';
import { OPENCLAW_SHIELD_STEPS } from '@agenshield/ipc';

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
    const home = process.env['HOME'] || '';
    for (const dir of ['/opt/agenshield', '/etc/agenshield', ...(home ? [`${home}/.agenshield`] : [])]) {
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
      const homeDir = process.env['HOME'] || '';
      const migrationsPath = homeDir ? `${homeDir}/.agenshield/migrations.json` : '/etc/agenshield/migrations.json';
      const legacyMigrationsPath = '/etc/agenshield/migrations.json';
      const resolvedPath = fs.existsSync(migrationsPath) ? migrationsPath : legacyMigrationsPath;
      if (fs.existsSync(resolvedPath)) {
        const data = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
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
  app.post<{ Params: { targetId: string }; Body: { baseName?: string; hostUsername?: string; openclawVersion?: string; freshInstall?: boolean } }>(
    '/targets/lifecycle/:targetId/shield',
    async (request, reply) => {
      const { targetId } = request.params;
      const body = (request.body ?? {}) as { baseName?: string; hostUsername?: string; openclawVersion?: string; freshInstall?: boolean };
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

      // Resolve host username (for config migration + path registry).
      // The daemon may run as a LaunchDaemon (broker user / root), so
      // process.env['USER'] would be wrong. Detect the macOS console user
      // as a reliable fallback.
      let hostUsername = body.hostUsername || '';
      if (!hostUsername) {
        try {
          const { execSync } = await import('node:child_process');
          hostUsername = execSync('stat -f "%Su" /dev/console', { encoding: 'utf-8', timeout: 3_000 }).trim();
        } catch {
          hostUsername = process.env['SUDO_USER'] || process.env['USER'] || process.env['LOGNAME'] || '';
        }
      }

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
      const tracker = new ShieldStepTracker(targetId, OPENCLAW_SHIELD_STEPS);
      let manifestBuilder: ManifestBuilder | undefined;

      try {
        shieldLog.step('initializing', 'Preparing to shield target...');

        // 0. Clean up stale ash_default_* users if not associated with any profile
        tracker.startStep('cleanup_stale_check');
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
                await executor.execAsRoot(`ps -u $(id -u ${staleUser} 2>/dev/null) -o pid= 2>/dev/null | xargs kill 2>/dev/null; sleep 1; ps -u $(id -u ${staleUser} 2>/dev/null) -o pid= 2>/dev/null | xargs kill -9 2>/dev/null; dscl . -delete /Users/${staleUser} 2>/dev/null; true`, { timeout: 15_000 });
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
        tracker.completeStep('cleanup_stale_check');
        // Manifest is initialized after preset resolution — cleanup is pre-manifest

        // 1. Detect the target's preset (resolve numbered instance IDs like 'claude-code-1')
        tracker.startStep('resolve_preset');
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
        manifestBuilder = new ManifestBuilder(basePresetId);
        const { baseUid, baseGid } = allocateNextUidGid();
        const userConfig = createUserConfig({ baseName: resolvedBaseName, baseUid, baseGid });
        const pathsConfig = createPathsConfig(userConfig);

        // 2. Create sandbox users/groups
        tracker.completeStep('resolve_preset');
        currentStep = 'creating_users';
        const agentUser = userConfig.agentUser.username;
        const brokerUser = userConfig.brokerUser.username;
        const groupName = userConfig.groups.socket.name;

        tracker.startStep('create_socket_group');
        log(`Creating agent user ${agentUser} (UID ${userConfig.agentUser.uid})...`, 'creating_users');
        shieldLog.step('creating_users', `Creating sandbox users (agent=${agentUser}, broker=${brokerUser}, group=${groupName})...`);
        shieldLog.info(`baseUid=${baseUid}, baseGid=${baseGid}, home=${userConfig.agentUser.home}`);

        // 2a. Create socket group (must complete before users)
        await executor.execAsRoot([
          `dscl . -create /Groups/${groupName}`,
          `dscl . -create /Groups/${groupName} PrimaryGroupID ${userConfig.groups.socket.gid}`,
          `dscl . -create /Groups/${groupName} RealName "${userConfig.groups.socket.description}"`,
          `dscl . -create /Groups/${groupName} Password "*"`,
        ].join(' && '), { timeout: 30_000 }).catch(() => {
          // Best-effort — group may already exist
        });
        tracker.completeStep('create_socket_group');
        manifestBuilder.recordInfra('create_socket_group', 2, { groupName });

        // 2b + 2c. Create agent and broker users IN PARALLEL (both depend on group only)
        tracker.startStep('create_agent_user');
        tracker.startStep('create_broker_user');
        log(`Creating broker user ${brokerUser}...`, 'creating_users');
        await Promise.all([
          executor.execAsRoot([
            `dscl . -create /Users/${agentUser}`,
            `dscl . -create /Users/${agentUser} UniqueID ${userConfig.agentUser.uid}`,
            `dscl . -create /Users/${agentUser} PrimaryGroupID ${userConfig.agentUser.gid}`,
            `dscl . -create /Users/${agentUser} UserShell ${userConfig.agentUser.shell}`,
            `dscl . -create /Users/${agentUser} NFSHomeDirectory ${userConfig.agentUser.home}`,
            `dscl . -create /Users/${agentUser} RealName "${userConfig.agentUser.realname}"`,
            `dscl . -create /Users/${agentUser} Password "*"`,
            `dseditgroup -o edit -a ${agentUser} -t user ${groupName}`,
          ].join(' && '), { timeout: 30_000 }).catch(() => {}),
          executor.execAsRoot([
            `dscl . -create /Users/${brokerUser}`,
            `dscl . -create /Users/${brokerUser} UniqueID ${userConfig.brokerUser.uid}`,
            `dscl . -create /Users/${brokerUser} PrimaryGroupID ${userConfig.brokerUser.gid}`,
            `dscl . -create /Users/${brokerUser} UserShell ${userConfig.brokerUser.shell}`,
            `dscl . -create /Users/${brokerUser} NFSHomeDirectory ${userConfig.brokerUser.home}`,
            `dscl . -create /Users/${brokerUser} RealName "${userConfig.brokerUser.realname}"`,
            `dscl . -create /Users/${brokerUser} Password "*"`,
            `dseditgroup -o edit -a ${brokerUser} -t user ${groupName}`,
          ].join(' && '), { timeout: 30_000 }).catch(() => {}),
        ]);
        tracker.completeStep('create_agent_user');
        tracker.completeStep('create_broker_user');
        manifestBuilder.recordInfra('create_agent_user', 2, { agentUsername: agentUser });
        manifestBuilder.recordInfra('create_broker_user', 2, { brokerUsername: brokerUser });

        // 3. Create directories
        tracker.startStep('create_directories');
        currentStep = 'creating_directories';
        const agentHome = userConfig.agentUser.home;
        const hostHome = hostUsername ? `/Users/${hostUsername}` : (process.env['HOME'] || '');
        log(`Creating directories under ${agentHome}...`, 'creating_directories');
        shieldLog.step('creating_directories', `Creating directories under ${agentHome}...`);
        await executor.execAsRoot([
          `mkdir -p "${agentHome}" "${agentHome}/bin" "${agentHome}/.config"`,
          `mkdir -p "${pathsConfig.configDir}"`,
          // .agenshield subdirs (seatbelt, bin, logs, run)
          `mkdir -p "${agentHome}/.agenshield/seatbelt/ops" "${agentHome}/.agenshield/bin" "${agentHome}/.agenshield/logs" "${agentHome}/.agenshield/run"`,
          `chown -R ${agentUser}:${groupName} "${agentHome}" 2>/dev/null || true`,
          `chmod 2775 "${agentHome}"`,
          // .agenshield root is root-owned (agent cannot write)
          `chown root:wheel "${agentHome}/.agenshield" "${agentHome}/.agenshield/seatbelt" "${agentHome}/.agenshield/seatbelt/ops" "${agentHome}/.agenshield/bin"`,
          `chmod 755 "${agentHome}/.agenshield" "${agentHome}/.agenshield/seatbelt" "${agentHome}/.agenshield/seatbelt/ops" "${agentHome}/.agenshield/bin"`,
          // logs and run dirs owned by broker:socketgroup
          `chown ${brokerUser}:${groupName} "${agentHome}/.agenshield/logs" "${agentHome}/.agenshield/run"`,
          `chmod 755 "${agentHome}/.agenshield/logs"`,
          `chmod 2770 "${agentHome}/.agenshield/run"`,
        ].join(' && '), { timeout: 30_000 });

        tracker.completeStep('create_directories');
        manifestBuilder.recordInfra('create_directories', 3, { agentHome });

        // 3b. Create .agenshield marker (root-owned, for user identification)
        tracker.startStep('create_marker');
        const meta = JSON.stringify({
          createdAt: new Date().toISOString(),
          version: '1.0',
          username: agentUser,
          uid: userConfig.agentUser.uid,
        }, null, 2);
        await executor.execAsRoot(`mkdir -p "${agentHome}/.agenshield"`, { timeout: 10_000 });
        await executor.execAsRoot(
          `cat > "${agentHome}/.agenshield/meta.json" << 'AGSMETA'\n${meta}\nAGSMETA`,
          { timeout: 15_000 },
        );
        await executor.execAsRoot([
          `chown root:wheel "${agentHome}/.agenshield"`,
          `chmod 755 "${agentHome}/.agenshield"`,
          `chown root:wheel "${agentHome}/.agenshield/meta.json"`,
          `chmod 644 "${agentHome}/.agenshield/meta.json"`,
        ].join(' && '), { timeout: 15_000 });

        tracker.completeStep('create_marker');

        // 3c. Install guarded shell (required for `sudo su <agent>` to work)
        tracker.startStep('install_guarded_shell');
        currentStep = 'installing_guarded_shell';
        log('Installing guarded shell...', 'installing_guarded_shell');
        shieldLog.step('installing_guarded_shell', 'Installing guarded shell launcher and ZDOTDIR...');
        try {
          const {
            guardedShellPath,
            GUARDED_SHELL_CONTENT,
            zdotDir,
            zdotZshenvContent,
            ZDOT_ZSHRC_CONTENT,
          } = await import('@agenshield/sandbox');

          // Per-target guarded-shell binary path
          const shellPath = guardedShellPath(agentHome);
          // Per-target ZDOTDIR under agent home
          const targetZdotDir = zdotDir(agentHome);

          // Write guarded-shell launcher to per-target path (separate call — heredoc terminator
          // must be on its own line, so it can't be &&-chained with other commands)
          await executor.execAsRoot(
            `cat > "${shellPath}" << 'GSHELL_EOF'\n${GUARDED_SHELL_CONTENT}\nGSHELL_EOF`,
            { timeout: 15_000 },
          );

          // Set ownership, permissions, register per-target path in /etc/shells
          await executor.execAsRoot([
            `chown root:wheel "${shellPath}"`,
            `chmod 755 "${shellPath}"`,
            `grep -qxF "${shellPath}" /etc/shells || echo "${shellPath}" >> /etc/shells`,
          ].join(' && '), { timeout: 15_000 });

          tracker.completeStep('install_guarded_shell');

          // Write ZDOTDIR files to per-target directory (.zshenv and .zshrc)
          tracker.startStep('install_zdotdir');
          await executor.execAsRoot(`mkdir -p "${targetZdotDir}"`, { timeout: 10_000 });
          await executor.execAsRoot(
            `cat > "${targetZdotDir}/.zshenv" << 'ZSHENV_EOF'\n${zdotZshenvContent(agentHome)}\nZSHENV_EOF`,
            { timeout: 15_000 },
          );
          await executor.execAsRoot(
            `cat > "${targetZdotDir}/.zshrc" << 'ZSHRC_EOF'\n${ZDOT_ZSHRC_CONTENT}\nZSHRC_EOF`,
            { timeout: 15_000 },
          );
          await executor.execAsRoot([
            `chown -R root:wheel "${targetZdotDir}"`,
            `chmod 644 "${targetZdotDir}/.zshenv" "${targetZdotDir}/.zshrc"`,
          ].join(' && '), { timeout: 15_000 });

          tracker.completeStep('install_zdotdir');

          // Post-install verification — UserShell is already set to guarded-shell,
          tracker.startStep('verify_shell');
          // so if the binary is missing or not in /etc/shells, `su` will fail.
          const verifyResult = await executor.execAsRoot([
            `test -x "${shellPath}" && echo EXEC_OK || echo EXEC_FAIL`,
            `grep -qxF "${shellPath}" /etc/shells && echo SHELLS_OK || echo SHELLS_FAIL`,
            `ls -la "${shellPath}"`,
          ].join('; '), { timeout: 10_000 });

          const verifyOutput = verifyResult.output ?? '';
          const execOk = verifyOutput.includes('EXEC_OK');
          const shellsOk = verifyOutput.includes('SHELLS_OK');
          shieldLog.info(`Guarded shell verified: ${verifyOutput.trim()}`);

          if (!execOk || !shellsOk) {
            const detail = `executable=${execOk}, registered=${shellsOk}`;
            throw new Error(`Guarded shell verification failed (${detail}) — agent shell unusable`);
          }

          tracker.completeStep('verify_shell');
          shieldLog.info('Guarded shell installed and verified successfully.');
          manifestBuilder.recordInfra('install_guarded_shell', 3, { shellPath });
        } catch (err) {
          const msg = (err as Error).message;
          tracker.failStep('install_guarded_shell', msg);
          request.log.error({ targetId, err }, `Guarded shell installation failed: ${msg}`);
          shieldLog.error(`Guarded shell installation failed (FATAL): ${msg}`);
          throw new Error(`Guarded shell installation failed: ${msg}`);
        }

        // 4. Install wrappers
        tracker.startStep('install_wrappers');
        currentStep = 'installing_wrappers';
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

        tracker.completeStep('install_wrappers');
        manifestBuilder.recordInfra('install_wrappers', 4, {});

        // 4b. PATH router override
        tracker.startStep('install_path_registry');
        currentStep = 'path_override';
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
            agentHome,
          }, originalBinary);

          // Write registry via root (under host user's ~/.agenshield/)
          const registryDir = `${hostHome}/.agenshield`;
          const registryPath = `${registryDir}/path-registry.json`;
          const registryJson = JSON.stringify(updatedRegistry, null, 2);
          await executor.execAsRoot(`mkdir -p "${registryDir}"`, { timeout: 10_000 });
          await executor.execAsRoot(
            `cat > "${registryPath}" << 'REGISTRY_EOF'\n${registryJson}\nREGISTRY_EOF`,
            { timeout: 15_000 },
          );
          await executor.execAsRoot(`chmod 644 "${registryPath}"`, { timeout: 10_000 });

          tracker.completeStep('install_path_registry');
          manifestBuilder.recordInfra('install_path_registry', 5, { registryPath, binName, targetId });

          // Generate and install the router wrapper
          tracker.startStep('install_path_router');
          const wrapperContent = generateRouterWrapper(binName);
          const installCmd = buildInstallRouterCommands(binName, wrapperContent);
          await executor.execAsRoot(installCmd, { timeout: 15_000 });
          tracker.completeStep('install_path_router');
          manifestBuilder.recordInfra('install_path_router', 5, { binName });
        } catch (err) {
          tracker.completeStep('install_path_registry');
          tracker.skipStep('install_path_router');
          request.log.warn({ targetId, err }, `PATH override partial: ${(err as Error).message}`);
          // Non-fatal — continue with shield
        }

        // 5. Install target app environment (via preset.install())
        let gatewayPlistPath: string | undefined;
        if (preset.install) {
          currentStep = 'installing_target';
          log(`Installing ${preset.name} environment...`, 'installing_target');
          shieldLog.step('installing_target', `Installing ${preset.name} environment via preset.install()...`);

          let lastPresetTrackerStep: string | null = null;

          const installResult = await preset.install({
            agentHome,
            agentUsername: agentUser,
            socketGroupName: groupName,
            detection,
            hostUsername,
            hostHome,
            requestedVersion: body.openclawVersion,
            execAsRoot: (cmd, opts) => {
              shieldLog.command(cmd, { timeout: opts?.timeout });
              const p = executor.execAsRoot(cmd, opts);
              p.then(r => shieldLog.result(r.success, r.output, r.error), () => { /* logged by caller */ });
              return p;
            },
            execAsUser: (cmd, opts) => {
              shieldLog.command(cmd, { user: agentUser, timeout: opts?.timeout });
              const p = executor.execAsUser(agentUser, cmd, opts);
              p.then(r => shieldLog.result(r.success, r.output, r.error), () => { /* logged by caller */ });
              return p;
            },
            onProgress: (stepId, _progress, message) => {
              // Pipeline step IDs match tracker step IDs directly.
              // For dynamically injected steps, register them on the fly.
              if (!tracker.getSteps().some(s => s.id === stepId) && stepId !== 'complete') {
                tracker.addStep({ id: stepId, phase: 9, name: message, description: message });
              }
              if (lastPresetTrackerStep && lastPresetTrackerStep !== stepId) {
                tracker.completeStep(lastPresetTrackerStep);
              }
              if (stepId !== 'complete') {
                tracker.startStep(stepId);
                lastPresetTrackerStep = stepId;
              }
            },
            onLog: (message) => {
              log(message, 'installing_target');
              shieldLog.info(message);
            },
            profileBaseName: resolvedBaseName,
            freshInstall: body.freshInstall,
          });

          // Complete the last preset tracker step
          if (lastPresetTrackerStep) tracker.completeStep(lastPresetTrackerStep);

          // Merge preset manifest entries
          if (installResult.manifestEntries) {
            manifestBuilder.mergePresetEntries(installResult.manifestEntries);
          }

          if (!installResult.success) {
            shieldLog.error(`Target installation failed at step "${installResult.failedStep}": ${installResult.error}`);
            throw new Error(`Target installation failed at step "${installResult.failedStep}": ${installResult.error}`);
          }
          gatewayPlistPath = installResult.gatewayPlistPath;
          log(`${preset.name} installation complete.`, 'installing_target');
          shieldLog.info(`${preset.name} installation complete.`);
        } else {
          // No preset install — skip all preset-specific steps
          const skipSteps = ['install_homebrew', 'install_nvm', 'copy_node_binary', 'install_openclaw', 'stop_host', 'copy_config', 'verify_openclaw', 'patch_node', 'write_gateway_plist'];
          for (const stepId of skipSteps) {
            tracker.skipStep(stepId);
          }
        }

        // 6 + 7. Generate seatbelt profile AND install sudoers IN PARALLEL
        tracker.startStep('generate_seatbelt');
        tracker.startStep('install_sudoers');
        currentStep = 'generating_seatbelt';
        log('Generating seatbelt security profile...', 'generating_seatbelt');
        shieldLog.step('generating_seatbelt', 'Generating seatbelt security profile...');
        const seatbeltProfile = generateAgentProfile({
          workspacePath: `${agentHome}/workspace`,
          socketPath: pathsConfig.socketPath,
          agentHome,
        });
        const seatbeltPath = `${agentHome}/.agenshield/seatbelt/agent.sb`;
        shieldLog.fileContent('Seatbelt profile', seatbeltPath, seatbeltProfile);

        log('Installing sudoers rules...', 'installing_sudoers');
        shieldLog.step('installing_sudoers', `Installing sudoers rules for ${hostUsername}...`);

        const seatbeltPromise = executor.execAsRoot(
          `cat > "${seatbeltPath}" << 'SEATBELT_EOF'\n${seatbeltProfile}\nSEATBELT_EOF`,
          { timeout: 15_000 },
        );

        const sudoersPromise = hostUsername ? executor.execAsRoot(
          `cat > "/etc/sudoers.d/agenshield-${resolvedBaseName}" << 'SUDOERS_EOF'\n` +
          `# AgenShield — allows ${hostUsername} to run commands as agent/broker without password\n` +
          `${hostUsername} ALL=(${agentUser}) NOPASSWD: ALL\n` +
          `${hostUsername} ALL=(${brokerUser}) NOPASSWD: ALL\n` +
          `SUDOERS_EOF\n` +
          `chmod 440 "/etc/sudoers.d/agenshield-${resolvedBaseName}" && visudo -c -f "/etc/sudoers.d/agenshield-${resolvedBaseName}" 2>/dev/null || rm -f "/etc/sudoers.d/agenshield-${resolvedBaseName}"`,
          { timeout: 15_000 },
        ) : Promise.resolve({ success: true, output: '' });

        await Promise.all([seatbeltPromise, sudoersPromise]);
        tracker.completeStep('generate_seatbelt');
        tracker.completeStep('install_sudoers');
        manifestBuilder.recordInfra('generate_seatbelt', 10, { seatbeltPath });
        manifestBuilder.recordInfra('install_sudoers', 11, { sudoersPath: `/etc/sudoers.d/agenshield-${resolvedBaseName}` });

        // 8. Install broker LaunchDaemon
        tracker.startStep('install_broker_daemon');
        currentStep = 'installing_daemon';
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
          `cat > "${plistPath}" << 'PLIST_EOF'\n${plistContent}\nPLIST_EOF\nchmod 644 "${plistPath}"\nlaunchctl bootout system/${brokerLabel} 2>/dev/null; true\nlaunchctl bootstrap system "${plistPath}"`,
          { timeout: 15_000 },
        );
        shieldLog.processEvent('spawned', brokerLabel);
        tracker.completeStep('install_broker_daemon');
        manifestBuilder.recordInfra('install_broker_daemon', 11, { brokerLabel, plistPath });

        // 8b. Wait for broker socket before starting gateway (prevents crash loop)
        if (gatewayPlistPath) {
          tracker.startStep('wait_broker_socket');
          currentStep = 'waiting_broker_socket';
          shieldLog.step('waiting_broker_socket', `Waiting for broker socket at ${pathsConfig.socketPath}...`);
          log('Waiting for broker socket...', 'waiting_broker_socket');

          const SOCKET_WAIT_MS = 30_000;
          let socketReady = false;

          // Fast check — socket may already exist
          try {
            const stat = await import('node:fs').then(f => f.statSync(pathsConfig.socketPath));
            if (stat.isSocket?.()) socketReady = true;
          } catch { /* not yet */ }

          // If not ready, watch the directory for creation
          if (!socketReady) {
            const fsNode = await import('node:fs');
            const pathNode = await import('node:path');
            const socketDir = pathNode.dirname(pathsConfig.socketPath);
            const socketName = pathNode.basename(pathsConfig.socketPath);

            socketReady = await new Promise<boolean>((resolve) => {
              const timeout = setTimeout(() => {
                watcher.close();
                resolve(false);
              }, SOCKET_WAIT_MS);

              const watcher = fsNode.watch(socketDir, (_, filename) => {
                if (filename === socketName) {
                  try {
                    const s = fsNode.statSync(pathsConfig.socketPath);
                    if (s.isSocket?.()) {
                      clearTimeout(timeout);
                      watcher.close();
                      resolve(true);
                    }
                  } catch { /* not yet */ }
                }
              });

              // Handle watcher errors (e.g. dir doesn't exist)
              watcher.on('error', () => {
                clearTimeout(timeout);
                watcher.close();
                resolve(false);
              });
            });
          }

          if (socketReady) {
            shieldLog.info(`Broker socket ready at ${pathsConfig.socketPath}`);
            tracker.completeStep('wait_broker_socket');
          } else {
            // Hard gate: broker socket not available — collect diagnostics and skip gateway
            shieldLog.error(`Broker socket not ready after ${SOCKET_WAIT_MS}ms — skipping gateway start`);
            try {
              const diagResult = await executor.execAsRoot([
                `launchctl list | grep com.agenshield.broker 2>/dev/null || echo "NO_BROKER_IN_LAUNCHCTL"`,
                `tail -20 "${agentHome}/.agenshield/logs/broker.error.log" 2>/dev/null || echo "NO_BROKER_LOG"`,
              ].join('; '), { timeout: 10_000 });
              shieldLog.info(`Broker diagnostics:\n${diagResult.output ?? 'N/A'}`);
            } catch { /* best-effort diagnostics */ }
            tracker.failStep('wait_broker_socket', 'Broker socket not ready — gateway start deferred');
            log('Broker socket not ready — gateway start deferred. Use /targets/lifecycle/:targetId/start to retry.', 'waiting_broker_socket');
            gatewayPlistPath = undefined;
          }

          // 8c. Pre-flight validation before gateway load
          if (gatewayPlistPath) {
            tracker.startStep('gateway_preflight');
            currentStep = 'gateway_preflight';
            shieldLog.step('gateway_preflight', 'Running gateway pre-flight checks...');
            log('Running gateway pre-flight checks...', 'gateway_preflight');

            const preflightFailures: string[] = [];
            const nvmSh = `${agentHome}/.nvm/nvm.sh`;
            const launcherScript = `${agentHome}/.agenshield/bin/gw-launcher.sh`;

            const preflightResult = await executor.execAsRoot([
              `sudo -H -u ${agentUser} bash -c 'source ${nvmSh} 2>/dev/null && command -v openclaw' && echo OPENCLAW_OK || echo OPENCLAW_FAIL`,
              `sudo -H -u ${agentUser} bash -c 'source ${nvmSh} 2>/dev/null && command -v node' && echo NODE_OK || echo NODE_FAIL`,
              `test -s "${nvmSh}" && echo NVM_OK || echo NVM_FAIL`,
              `test -x "${launcherScript}" && echo LAUNCHER_OK || echo LAUNCHER_FAIL`,
            ].join('; '), { timeout: 30_000 });

            const pfOutput = preflightResult.output ?? '';
            if (!pfOutput.includes('OPENCLAW_OK')) preflightFailures.push('openclaw binary not found in agent PATH');
            if (!pfOutput.includes('NODE_OK')) preflightFailures.push('node binary not found in agent PATH');
            if (!pfOutput.includes('NVM_OK')) preflightFailures.push(`nvm.sh not found at ${nvmSh}`);
            if (!pfOutput.includes('LAUNCHER_OK')) preflightFailures.push(`launcher script not executable at ${launcherScript}`);

            if (preflightFailures.length > 0) {
              shieldLog.error(`Gateway pre-flight failed: ${preflightFailures.join(', ')}`);
              tracker.failStep('gateway_preflight', preflightFailures.join('; '));
              log(`Gateway pre-flight failed — gateway start deferred: ${preflightFailures.join('; ')}`, 'gateway_preflight');
              gatewayPlistPath = undefined;
            } else {
              shieldLog.info('Pre-flight OK — all gateway dependencies verified');
              tracker.completeStep('gateway_preflight');
            }
          } else {
            tracker.skipStep('gateway_preflight');
          }

          // 8d. Start the gateway (deferred — plist was written but not loaded by preset)
          if (gatewayPlistPath) {
            tracker.startStep('start_gateway');
            currentStep = 'starting_gateway';
            shieldLog.step('starting_gateway', 'Loading and starting OpenClaw gateway LaunchDaemon...');
            log('Starting OpenClaw gateway...', 'starting_gateway');

            const gatewayLabel = `com.agenshield.${resolvedBaseName}.gateway`;
            shieldLog.launchdEvent('load', gatewayLabel, gatewayPlistPath);
            shieldLog.processEvent('spawning', gatewayLabel, { user: agentUser, plistPath: gatewayPlistPath });
            emitEvent('process:started', { process: 'gateway', action: 'spawning', pid: undefined } as import('@agenshield/ipc').ProcessEventPayload);

            await executor.execAsRoot(
              `launchctl bootout system/${gatewayLabel} 2>/dev/null; true\nlaunchctl bootstrap system "${gatewayPlistPath}"\nlaunchctl kickstart system/${gatewayLabel}`,
              { timeout: 15_000 },
            );
            shieldLog.processEvent('spawned', gatewayLabel);
            shieldLog.info('Gateway LaunchDaemon loaded and kicked');
            tracker.completeStep('start_gateway');
            manifestBuilder.recordInfra('start_gateway', 12, { gatewayLabel, gatewayPlistPath });
          } else {
            tracker.skipStep('start_gateway');
            manifestBuilder.skipInfra('start_gateway', 12);
          }
        } else {
          // No gateway — skip socket wait and gateway steps
          tracker.skipStep('wait_broker_socket');
          tracker.skipStep('gateway_preflight');
          tracker.skipStep('start_gateway');
        }

        // 9. Create profile in storage
        tracker.startStep('create_profile');
        currentStep = 'creating_profile';
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

        tracker.completeStep('create_profile');

        // 9b. Persist install manifest to profile
        try {
          storage.profiles.updateManifest(profileId, manifestBuilder.build());
        } catch {
          // Best-effort — manifest persistence failure shouldn't block shield
        }

        // 10. Seed preset policies
        tracker.startStep('seed_policies');
        if (preset.policyPresetIds?.length) {
          currentStep = 'seeding_policies';
          log('Seeding preset security policies...', 'seeding_policies');
          shieldLog.step('seeding_policies', `Seeding preset policies: ${preset.policyPresetIds.join(', ')}`);
          const scopedStorage = storage.for({ profileId });
          for (const presetPolicyId of preset.policyPresetIds) {
            const count = scopedStorage.policies.seedPreset(presetPolicyId);
            log(`Seeded ${count} policies from preset "${presetPolicyId}".`, 'seeding_policies');
          }
        }
        tracker.completeStep('seed_policies');

        // 11. Finalize
        tracker.startStep('finalize');
        emitEvent('setup:shield_complete', { targetId, profileId: profile.id });
        log('Shielding complete.', 'complete');
        flushLog();
        shieldLog.finish(true);
        tracker.completeStep('finalize');
        request.log.info({ targetId, logPath: shieldLog.logPath }, 'Shield log saved');

        return { success: true, data: { targetId, profileId: profile.id, logPath: shieldLog.logPath } };
      } catch (err) {
        flushLog();
        const message = (err as Error).message;
        shieldLog.error(`Shield failed at step "${currentStep}": ${message}`);
        shieldLog.finish(false, message);
        // Fail whichever step is currently running in the tracker
        const runningStep = tracker.getSteps().find(s => s.status === 'running');
        if (runningStep) tracker.failStep(runningStep.id, message);
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

        if (profile.installManifest) {
          // ── Manifest-driven rollback ───────────────────────────────
          log('Using manifest-driven rollback...', 'rollback');
          emitEvent('setup:shield_progress', { targetId, step: 'rollback', progress: 5, message: 'Rolling back via manifest...' });

          // Import rollback registry (side-effect: registers all handlers)
          const { getRollbackHandler } = await import('@agenshield/sandbox');

          // Resolve host home for rollback context
          let hostHome = '';
          let hostUsername = '';
          try {
            const { execSync } = await import('node:child_process');
            hostUsername = execSync('stat -f "%Su" /dev/console', { encoding: 'utf-8', timeout: 3_000 }).trim();
            hostHome = `/Users/${hostUsername}`;
          } catch {
            hostHome = process.env['HOME'] || '';
            hostUsername = process.env['USER'] || '';
          }

          const rollbackCtx = {
            execAsRoot: (cmd: string, opts?: { timeout?: number }) => executor.execAsRoot(cmd, opts),
            onLog: (message: string) => log(message, 'rollback'),
            agentHome: agentHomeDir || '',
            agentUsername: agentUsername || '',
            profileBaseName,
            hostHome,
            hostUsername,
          };

          // Reverse iterate: undo completed+changed steps in reverse order
          const entries = profile.installManifest.entries
            .filter(e => e.status === 'completed' && e.changed)
            .reverse();

          const totalEntries = entries.length;
          for (let i = 0; i < totalEntries; i++) {
            const entry = entries[i]!;
            const progress = Math.round(5 + (i / totalEntries) * 80);
            emitEvent('setup:shield_progress', { targetId, step: 'rollback', progress, message: `Rolling back ${entry.stepId}...` });

            const handler = getRollbackHandler(entry.stepId);
            if (handler) {
              try {
                await handler(rollbackCtx, entry);
              } catch (err) {
                log(`Rollback handler for ${entry.stepId} failed (best-effort): ${(err as Error).message}`, 'rollback');
              }
            } else {
              log(`No rollback handler for ${entry.stepId} — skipping`, 'rollback');
            }
          }

          // Always delete policies + profile regardless of manifest
          emitEvent('setup:shield_progress', { targetId, step: 'removing_policies', progress: 88, message: 'Removing policies...' });
          log('Removing seeded policies...', 'removing_policies');
          try {
            const scopedStorage = storage.for({ profileId: profile.id });
            scopedStorage.policies.deleteAll();
          } catch {
            // Best-effort
          }

          emitEvent('setup:shield_progress', { targetId, step: 'removing_profile', progress: 95, message: 'Removing profile...' });
          log('Removing profile from storage...', 'removing_profile');
          storage.profiles.delete(profile.id);

        } else {
          // ── Legacy fallback — hardcoded unshield ───────────────────
          log('No install manifest found — using legacy unshield...', 'legacy_unshield');

          // 1. Stop target app processes
          emitEvent('setup:shield_progress', { targetId, step: 'stopping_processes', progress: 5, message: 'Stopping target processes...' });
          log('Stopping all processes for agent user...', 'stopping_processes');
          if (agentUsername) {
            await executor.execAsRoot(
              `ps -u $(id -u ${agentUsername} 2>/dev/null) -o pid= 2>/dev/null | xargs kill 2>/dev/null; sleep 1; ps -u $(id -u ${agentUsername} 2>/dev/null) -o pid= 2>/dev/null | xargs kill -9 2>/dev/null; true`,
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
              pathRegistryPath,
            } = await import('@agenshield/sandbox');

            const basePresetId = resolvePresetId(profile.presetId ?? targetId);
            const binName = basePresetId.split('-')[0];

            let hostHome = '';
            try {
              const { execSync } = await import('node:child_process');
              const consoleUser = execSync('stat -f "%Su" /dev/console', { encoding: 'utf-8', timeout: 3_000 }).trim();
              hostHome = `/Users/${consoleUser}`;
            } catch {
              hostHome = process.env['HOME'] || '';
            }

            const { registry, remainingCount } = removeRegistryInstance(binName, targetId, hostHome);
            const resolvedRegistryPath = pathRegistryPath(hostHome);

            if (remainingCount === 0) {
              const removeCmd = buildRemoveRouterCommands(binName);
              await executor.execAsRoot(removeCmd, { timeout: 15_000 }).catch(() => {});
            }

            if (Object.keys(registry).length === 0) {
              await executor.execAsRoot(`rm -f "${resolvedRegistryPath}"`, { timeout: 5_000 }).catch(() => {});
            } else {
              const registryJson = JSON.stringify(registry, null, 2);
              await executor.execAsRoot(
                `cat > "${resolvedRegistryPath}" << 'REGISTRY_EOF'\n${registryJson}\nREGISTRY_EOF`,
                { timeout: 15_000 },
              ).catch(() => {});
              await executor.execAsRoot(
                `chmod 644 "${resolvedRegistryPath}"`,
                { timeout: 10_000 },
              ).catch(() => {});
            }
          } catch {
            // PATH override cleanup is non-fatal
          }

          // 3. Unload & remove LaunchDaemons (broker + target-specific)
          emitEvent('setup:shield_progress', { targetId, step: 'removing_daemons', progress: 25, message: 'Removing LaunchDaemons...' });
          log('Unloading and removing LaunchDaemons...', 'removing_daemons');
          const plistLabels = [
            `com.agenshield.broker.${profileBaseName}`,
            `com.agenshield.${profileBaseName}.gateway`,
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

          // 5. Remove seatbelt and guarded shell from /etc/shells
          emitEvent('setup:shield_progress', { targetId, step: 'removing_seatbelt', progress: 45, message: 'Removing security profile...' });
          if (agentHomeDir) {
            await executor.execAsRoot(
              `sed -i '' '\\|${agentHomeDir}/.agenshield/bin/guarded-shell|d' /etc/shells 2>/dev/null; true`,
              { timeout: 5_000 },
            ).catch(() => {});
          }

          // 6. Delete agent home directory
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

          // 8. Delete sandbox group (socket)
          emitEvent('setup:shield_progress', { targetId, step: 'removing_groups', progress: 75, message: 'Removing sandbox groups...' });
          log('Removing sandbox groups...', 'removing_groups');
          const socketGroupName = `ash_${profileBaseName}`;
          await executor.execAsRoot(
            `dscl . -delete /Groups/${socketGroupName} 2>/dev/null; true`,
            { timeout: 15_000 },
          ).catch(() => {});

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
        }

        emitEvent('setup:shield_progress', { targetId, step: 'cleanup', progress: 98, message: 'Final cleanup...' });
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
