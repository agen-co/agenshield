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
  app.post<{ Params: { targetId: string }; Body: { baseName?: string } }>(
    '/targets/lifecycle/:targetId/shield',
    async (request, reply) => {
      const { targetId } = request.params;
      const body = (request.body ?? {}) as { baseName?: string };
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

      let currentStep = 'initializing';

      try {
        emitEvent('setup:shield_progress', { targetId, step: 'initializing', progress: 0, message: 'Preparing to shield target...' });

        // 1. Detect the target's preset (resolve numbered instance IDs like 'claude-code-1')
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

        const resolvedBaseName = body.baseName || targetId.replace(/-/g, '');
        const { baseUid, baseGid } = allocateNextUidGid();
        const userConfig = createUserConfig({ baseName: resolvedBaseName, baseUid, baseGid });
        const pathsConfig = createPathsConfig(userConfig);

        // 2. Create sandbox users/groups
        currentStep = 'creating_users';
        emitEvent('setup:shield_progress', { targetId, step: 'creating_users', progress: 10, message: 'Creating sandbox users and groups...' });
        const agentUser = userConfig.agentUser.username;
        const brokerUser = userConfig.brokerUser.username;
        const groupName = userConfig.groups.socket.name;
        const workspaceGroupName = userConfig.groups.workspace.name;

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
        emitEvent('setup:shield_progress', { targetId, step: 'creating_directories', progress: 25, message: 'Creating directories...' });
        const agentHome = userConfig.agentUser.home;
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

        // 4. Install wrappers
        currentStep = 'installing_wrappers';
        emitEvent('setup:shield_progress', { targetId, step: 'installing_wrappers', progress: 40, message: 'Installing command wrappers...' });
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
        emitEvent('setup:shield_progress', { targetId, step: 'path_override', progress: 50, message: 'Installing PATH router...' });
        try {
          const {
            findOriginalBinary,
            addRegistryInstance,
            writePathRegistry,
            generateRouterWrapper,
            buildInstallRouterCommands,
          } = await import('@agenshield/sandbox');

          // Determine the binary name from base preset ID (e.g. 'claude-code' → 'claude')
          const binName = basePresetId.split('-')[0];

          // Find the original binary, skipping any existing router wrappers
          const originalBinary = findOriginalBinary(binName) ?? '';

          // Register this instance in the path registry
          const updatedRegistry = addRegistryInstance(binName, {
            targetId,
            profileId: `${targetId}-${Date.now().toString(36)}`,
            name: preset.name,
            agentBinPath: `${agentHome}/bin/${binName}`,
            baseName: resolvedBaseName,
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

        // 5. Generate seatbelt profile
        currentStep = 'generating_seatbelt';
        emitEvent('setup:shield_progress', { targetId, step: 'generating_seatbelt', progress: 60, message: 'Generating seatbelt profile...' });
        const seatbeltProfile = generateAgentProfile({
          workspacePath: `${agentHome}/workspace`,
          socketPath: pathsConfig.socketPath,
          agentHome,
        });
        const seatbeltPath = `${pathsConfig.seatbeltDir}/${baseName}-agent.sb`;
        await executor.execAsRoot(
          `cat > "${seatbeltPath}" << 'SEATBELT_EOF'\n${seatbeltProfile}\nSEATBELT_EOF`,
          { timeout: 15_000 },
        );

        // 6. Install LaunchDaemon
        currentStep = 'installing_daemon';
        emitEvent('setup:shield_progress', { targetId, step: 'installing_daemon', progress: 75, message: 'Installing LaunchDaemon...' });
        const plistContent = generateBrokerPlist(userConfig, {
          socketPath: pathsConfig.socketPath,
        });
        const plistPath = `/Library/LaunchDaemons/com.agenshield.broker.${baseName}.plist`;
        await executor.execAsRoot(
          `cat > "${plistPath}" << 'PLIST_EOF'\n${plistContent}\nPLIST_EOF\nchmod 644 "${plistPath}"\nlaunchctl load "${plistPath}" 2>/dev/null; true`,
          { timeout: 15_000 },
        );

        // 7. Create profile in storage
        currentStep = 'creating_profile';
        emitEvent('setup:shield_progress', { targetId, step: 'creating_profile', progress: 90, message: 'Creating profile...' });
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

        emitEvent('setup:shield_progress', { targetId, step: 'complete', progress: 100, message: 'Shielding complete' });
        emitEvent('setup:shield_complete', { targetId, profileId: profile.id });

        return { success: true, data: { targetId, profileId: profile.id } };
      } catch (err) {
        const message = (err as Error).message;
        request.log.error({ targetId, err, step: currentStep }, `Shield failed at step "${currentStep}": ${message}`);
        emitEvent('setup:error', { targetId, error: message, step: currentStep });
        return reply.code(500).send({
          success: false,
          error: { code: 'SHIELD_ERROR', message, step: currentStep },
        });
      }
    },
  );

  /**
   * POST /targets/lifecycle/:targetId/unshield — Unshield a target.
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
        const profileBaseName = agentUsername?.replace(/^ash_/, '').replace(/_agent$/, '') ?? targetId;

        // 1. Remove PATH override
        try {
          const {
            resolvePresetId,
            removeRegistryInstance,
            buildRemoveRouterCommands,
            PATH_REGISTRY_PATH: _registryPath,
          } = await import('@agenshield/sandbox');

          // Derive binary name from the base preset (e.g. 'claude-code' → 'claude')
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

        // 2. Unload LaunchDaemon via privilege executor
        const plistLabel = `com.agenshield.broker.${profileBaseName}`;
        try {
          await executor.execAsRoot(
            `launchctl bootout system/${plistLabel} 2>/dev/null; true`,
            { timeout: 15_000 },
          );
        } catch {
          // May not exist
        }

        // 3. Delete sandbox users (use actual usernames from profile)
        try {
          const deleteCommands: string[] = [];
          if (agentUsername) deleteCommands.push(`dscl . -delete /Users/${agentUsername} 2>/dev/null`);
          if (brokerUsername) deleteCommands.push(`dscl . -delete /Users/${brokerUsername} 2>/dev/null`);
          if (deleteCommands.length > 0) {
            await executor.execAsRoot(
              deleteCommands.join('; ') + '; true',
              { timeout: 15_000 },
            );
          }
        } catch {
          // Best-effort
        }

        // 4. Remove profile from storage (exact ID, not find-by-presetId)
        storage.profiles.delete(profile.id);

        emitEvent('setup:shield_complete', { targetId, profileId: profile.id });
        return { success: true, data: { targetId, unshielded: true } };
      } catch (err) {
        return reply.code(500).send({
          success: false,
          error: { code: 'UNSHIELD_ERROR', message: (err as Error).message },
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
        const plistLabel = `com.agenshield.broker.${startBaseName}`;
        await executor.execAsRoot(
          `launchctl kickstart -k system/${plistLabel}`,
          { timeout: 15_000 },
        );

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
        const plistLabel = `com.agenshield.broker.${stopBaseName}`;
        await executor.execAsRoot(
          `launchctl kill SIGTERM system/${plistLabel}`,
          { timeout: 15_000 },
        );

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
