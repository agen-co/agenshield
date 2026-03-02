/**
 * Target lifecycle management routes
 *
 * Detect, shield, unshield, start, and stop targets. Each privileged
 * operation routes through app.privilegeExecutor (persistent root helper).
 */

import type { FastifyInstance } from 'fastify';
import type { ApiResponse, DetectedTarget, TargetType } from '@agenshield/ipc';
import { migrationStatePath, MIGRATION_STATE_PATH } from '@agenshield/ipc';
import { getStorage } from '@agenshield/storage';
import { emitEvent } from '../events/emitter';
import { triggerTargetCheck, checkProcessesRunning, checkOpenClawRunning, listClaudeProcesses, listOpenClawProcesses, resolveAgentUid } from '../watchers/targets';
import { ShieldLogger } from '../services/shield-logger';
import { ShieldStepTracker } from '../services/shield-step-tracker';
import { ManifestBuilder } from '../services/manifest-builder';
import { OPENCLAW_SHIELD_STEPS, isSEA, getSEAVersion } from '@agenshield/ipc';
import { registerShieldOperation, unregisterShieldOperation, getActiveShieldOperations } from '../services/shield-registry';
import { signBrokerToken } from '@agenshield/auth';
import { writeTokenFile, invalidateTokenCache } from '../services/profile-token';

// ── Gateway port allocation helper ────────────────────────────────

const GATEWAY_BASE_PORT = 18789;

function allocateGatewayPort(): number {
  try {
    const storage = getStorage();
    const profiles = storage.profiles.getAll();
    const usedPorts = new Set(
      profiles
        .map((p: { gatewayPort?: number }) => p.gatewayPort)
        .filter((port): port is number => port != null),
    );
    let port = GATEWAY_BASE_PORT;
    while (usedPorts.has(port)) {
      port++;
    }
    return port;
  } catch {
    return GATEWAY_BASE_PORT;
  }
}

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

  // Phase 1: Detect installed presets and cross-reference with profiles.
  // Each profile for a detected preset becomes a separate entry so that
  // multi-instance setups (e.g. two claude-code profiles) render as
  // separate cards on the canvas.
  const representedProfileIds = new Set<string>();

  try {
    const { listPresets } = await import('@agenshield/sandbox');
    const presets = listPresets();
    let profiles: Array<{ id: string; name?: string; presetId?: string; type?: string }> = [];

    try {
      const storage = getStorage();
      profiles = storage.profiles.getAll();
    } catch {
      // Storage not ready — proceed with empty profiles
    }

    for (const preset of presets) {
      if (preset.id === 'custom') continue;
      let detection: { version?: string; binaryPath?: string; method?: string } | null = null;
      try {
        detection = await preset.detect();
      } catch {
        // Detection failed for this preset — skip
      }
      if (!detection) continue;

      // Find ALL profiles that belong to this preset
      const matchingProfiles = profiles.filter(
        (p) => p.presetId === preset.id,
      );

      if (matchingProfiles.length === 0) {
        // Detected but unshielded — single entry with preset ID
        targets.push({
          id: preset.id,
          name: preset.name,
          type: preset.id as TargetType,
          version: detection.version,
          binaryPath: detection.binaryPath,
          method: detection.method ?? 'auto',
          shielded: false,
        });
      } else {
        // One entry per profile
        for (const profile of matchingProfiles) {
          representedProfileIds.add(profile.id);
          targets.push({
            id: profile.id,
            name: profile.name ?? preset.name,
            type: preset.id as TargetType,
            version: detection.version,
            binaryPath: detection.binaryPath,
            method: detection.method ?? 'auto',
            shielded: true,
          });
        }
      }
    }

    // Phase 2: Append profiles whose preset was NOT detected (e.g. binary
    // was uninstalled but profile still exists in storage).
    const { getPreset: getPresetFn } = await import('@agenshield/sandbox');
    for (const profile of profiles) {
      if ((profile as { type?: string }).type !== 'target' || !profile.presetId) continue;
      if (representedProfileIds.has(profile.id)) continue;

      const basePreset = getPresetFn(profile.presetId);
      targets.push({
        id: profile.id,
        name: profile.name ?? basePreset?.name ?? profile.presetId,
        type: (profile.presetId ?? 'custom') as TargetType,
        method: 'profile',
        shielded: true,
      });
      representedProfileIds.add(profile.id);
    }
  } catch {
    // Sandbox package not available — return empty
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
    for (const dir of ['/opt/agenshield', ...(home ? [`${home}/.agenshield`] : [])]) {
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
      const primaryPath = migrationStatePath();
      const legacyPath = MIGRATION_STATE_PATH;
      const resolvedPath = fs.existsSync(primaryPath) ? primaryPath : legacyPath;
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
  gatewayPort?: number;
  pid?: number;
  processes?: import('@agenshield/ipc').AgentProcessInfo[];
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
        const matchedProfile = profiles.find((p: { id: string }) => p.id === target.id);
        return {
          id: target.id,
          name: target.name,
          type: target.type,
          shielded: target.shielded,
          running: false, // Will be updated below
          version: target.version,
          binaryPath: target.binaryPath,
          gatewayPort: matchedProfile?.gatewayPort,
        };
      });

      // Check running status using type-specific detection helpers.
      // All system commands are offloaded to the worker thread (async).
      try {
        const { getSystemExecutor } = await import('../workers/system-command.js');
        for (const target of results) {
          if (!target.shielded) continue;

          try {
            const matchedProfile = profiles.find((p: { id: string }) => p.id === target.id);
            const agentUsername = matchedProfile?.agentUsername;
            if (!agentUsername) continue;

            const agentUid = await resolveAgentUid(agentUsername, (matchedProfile as { agentUid?: number }).agentUid);
            if (agentUid == null) continue;

            const runBaseName = agentUsername.replace(/^ash_/, '').replace(/_agent$/, '');

            if (target.type === 'openclaw') {
              target.running = await checkOpenClawRunning(
                agentUid,
                runBaseName,
                app.processManager ?? null,
                target.id,
              );
              target.processes = await listOpenClawProcesses(agentUid);
            } else if (target.type === 'claude-code') {
              const procs = await listClaudeProcesses(agentUid);
              target.running = procs.length > 0;
              target.processes = procs;
            } else {
              // Fallback: launchctl broker check only (direct lookup, no grep)
              try {
                const executor = getSystemExecutor();
                const brokerOutput = await executor.exec(
                  `launchctl list com.agenshield.broker.${runBaseName} 2>/dev/null || true`,
                  { timeout: 5_000 },
                );
                const trimmed = brokerOutput.trim();
                target.running = trimmed.length > 0 && !trimmed.includes('Could not find service');
              } catch {
                // leave as false
              }
            }
          } catch {
            // Can't check — leave as false
          }
        }
      } catch {
        // worker not available
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
  app.post<{ Params: { targetId: string }; Body: { baseName?: string; hostUsername?: string; openclawVersion?: string; freshInstall?: boolean; configCopyCategories?: string[] } }>(
    '/targets/lifecycle/:targetId/shield',
    async (request, reply) => {
      const { targetId } = request.params;
      const body = (request.body ?? {}) as { baseName?: string; hostUsername?: string; openclawVersion?: string; freshInstall?: boolean; configCopyCategories?: string[] };
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

      let currentStep = 'initializing';
      const shieldLog = new ShieldLogger(targetId);
      const tracker = new ShieldStepTracker(targetId, OPENCLAW_SHIELD_STEPS);

      const log = (message: string, stepId?: string) => {
        const now = Date.now();
        if (now - lastLogTime >= LOG_MIN_INTERVAL) {
          lastLogTime = now;
          emitEvent('setup:log', { targetId, message, stepId }, tracker.getProfileId());
        } else {
          pendingLog = { message, stepId };
          if (!pendingLogTimer) {
            pendingLogTimer = setTimeout(() => {
              if (pendingLog) {
                emitEvent('setup:log', { targetId, message: pendingLog.message, stepId: pendingLog.stepId }, tracker.getProfileId());
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
          emitEvent('setup:log', { targetId, message: pendingLog.message, stepId: pendingLog.stepId }, tracker.getProfileId());
          pendingLog = null;
        }
      };
      registerShieldOperation(targetId, targetId, tracker);
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
          generateAgentProfile,
          generateBrokerPlist,
          generateBrokerLauncherScript,
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

        // 1b. Stop host processes (before creating sandbox users)
        tracker.startStep('stop_host');
        log('Stopping host OpenClaw processes...', 'stop_host');
        shieldLog.step('stop_host', 'Stopping host OpenClaw processes before sandbox setup...');
        try {
          await executor.execAsRoot(
            `if ps -u $(id -u ${hostUsername}) -o command= 2>/dev/null | grep -q 'openclaw'; then ` +
            `sudo -H -u ${hostUsername} openclaw gateway stop 2>/dev/null & ` +
            `sudo -H -u ${hostUsername} openclaw daemon stop 2>/dev/null & ` +
            `wait; sleep 1; ` +
            `pkill -u $(id -u ${hostUsername}) -f 'node.*openclaw' 2>/dev/null; ` +
            `fi; true`,
            { timeout: 15_000 },
          );
        } catch {
          // Best-effort — host processes may not be running
        }
        tracker.completeStep('stop_host');

        currentStep = 'creating_users';
        const agentUser = userConfig.agentUser.username;
        const brokerUser = userConfig.brokerUser.username;
        const groupName = userConfig.groups.socket.name;

        // Kill stale processes for the target agent user from a previous failed shield attempt.
        // Without this, dozens of orphaned processes can accumulate and interfere with re-shielding.
        try {
          await executor.execAsRoot(
            `ps -u $(id -u ${agentUser} 2>/dev/null) -o pid= 2>/dev/null | xargs kill 2>/dev/null; ` +
            `sleep 1; ` +
            `ps -u $(id -u ${agentUser} 2>/dev/null) -o pid= 2>/dev/null | xargs kill -9 2>/dev/null; true`,
            { timeout: 15_000 },
          );
          log(`Killed stale processes for ${agentUser}`, 'cleanup_stale');
        } catch {
          // Best-effort — user may not exist yet on first shield
        }

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
          // .agenshield subdirs (seatbelt, bin, logs, run, policies)
          `mkdir -p "${agentHome}/.agenshield/seatbelt/ops" "${agentHome}/.agenshield/bin" "${agentHome}/.agenshield/logs" "${agentHome}/.agenshield/run" "${agentHome}/.agenshield/policies"`,
          `chown -R ${agentUser}:${groupName} "${agentHome}" 2>/dev/null || true`,
          `chmod 2775 "${agentHome}"`,
          // .agenshield root is root-owned (agent cannot write)
          `chown root:wheel "${agentHome}/.agenshield" "${agentHome}/.agenshield/seatbelt" "${agentHome}/.agenshield/seatbelt/ops" "${agentHome}/.agenshield/bin"`,
          `chmod 755 "${agentHome}/.agenshield" "${agentHome}/.agenshield/seatbelt" "${agentHome}/.agenshield/seatbelt/ops" "${agentHome}/.agenshield/bin"`,
          // logs, run, and policies dirs owned by broker:socketgroup
          `chown ${brokerUser}:${groupName} "${agentHome}/.agenshield/logs" "${agentHome}/.agenshield/run" "${agentHome}/.agenshield/policies"`,
          `chmod 755 "${agentHome}/.agenshield/logs"`,
          `chmod 755 "${agentHome}/.agenshield/policies"`,
          `chmod 2775 "${agentHome}/.agenshield/run"`,
        ].join(' && '), { timeout: 30_000 });

        tracker.completeStep('create_directories');
        manifestBuilder.recordInfra('create_directories', 3, { agentHome });

        // 3a-acl. Grant broker + agent user traversal ACL on host home (for plist binary paths and wrappers)
        await executor.execAsRoot([
          // Broker user ACLs
          `chmod -a "${brokerUser} allow search" "${hostHome}" 2>/dev/null; true`,
          `chmod +a "${brokerUser} allow search" "${hostHome}"`,
          `chmod -a "${brokerUser} allow search,list,readattr,readextattr" "${hostHome}/.agenshield" 2>/dev/null; true`,
          `chmod +a "${brokerUser} allow search,list,readattr,readextattr" "${hostHome}/.agenshield"`,
          `chmod -a "${brokerUser} allow search,list,readattr,readextattr,execute" "${hostHome}/.agenshield/bin" 2>/dev/null; true`,
          `chmod +a "${brokerUser} allow search,list,readattr,readextattr,execute" "${hostHome}/.agenshield/bin"`,
          // Broker user ACL on libexec (SEA broker binary lives here)
          `chmod -a "${brokerUser} allow search,list,readattr,readextattr,execute" "${hostHome}/.agenshield/libexec" 2>/dev/null; true`,
          `chmod +a "${brokerUser} allow search,list,readattr,readextattr,execute" "${hostHome}/.agenshield/libexec"`,
          // Broker user ACL on lib (native modules like better-sqlite3)
          `chmod -a "${brokerUser} allow search,list,readattr,readextattr" "${hostHome}/.agenshield/lib" 2>/dev/null; true`,
          `chmod +a "${brokerUser} allow search,list,readattr,readextattr" "${hostHome}/.agenshield/lib"`,
          // Agent user ACLs (wrappers exec shield-client from host .agenshield/bin)
          `chmod -a "${agentUser} allow search" "${hostHome}" 2>/dev/null; true`,
          `chmod +a "${agentUser} allow search" "${hostHome}"`,
          `chmod -a "${agentUser} allow search,list,readattr,readextattr" "${hostHome}/.agenshield" 2>/dev/null; true`,
          `chmod +a "${agentUser} allow search,list,readattr,readextattr" "${hostHome}/.agenshield"`,
          `chmod -a "${agentUser} allow search,list,readattr,readextattr,execute" "${hostHome}/.agenshield/bin" 2>/dev/null; true`,
          `chmod +a "${agentUser} allow search,list,readattr,readextattr,execute" "${hostHome}/.agenshield/bin"`,
        ].join(' && '), { timeout: 15_000 });
        shieldLog.info(`Broker + agent traversal ACL set on ${hostHome}`);

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
            zdotZshrcContent,
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
            `cat > "${targetZdotDir}/.zshenv" << 'ZSHENV_EOF'\n${zdotZshenvContent(agentHome, preset.shellFeatures)}\nZSHENV_EOF`,
            { timeout: 15_000 },
          );
          await executor.execAsRoot(
            `cat > "${targetZdotDir}/.zshrc" << 'ZSHRC_EOF'\n${zdotZshrcContent(preset.shellFeatures)}\nZSHRC_EOF`,
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

        // 4. Install wrappers (5 granular sub-steps)
        currentStep = 'installing_wrappers';
        log('Installing command wrappers...', 'installing_wrappers');
        shieldLog.step('installing_wrappers', `Installing command wrappers (${preset.requiredBins.join(', ')})...`);
        const binDir = `${agentHome}/bin`;

        const {
          deployInterceptor: deployInterceptorFn,
          installSpecificWrappers: installSpecificWrappersFn,
          installBasicCommands: installBasicCommandsFn,
          getDefaultWrapperConfig: getDefaultWrapperConfigFn,
          WRAPPER_DEFINITIONS: wrapperDefs,
        } = await import('@agenshield/sandbox');

        // 4a. Deploy interceptor (conditional — skip if no wrapper uses it)
        tracker.startStep('deploy_interceptor');
        const needsInterceptor = preset.requiredBins.some(
          (name: string) => wrapperDefs[name]?.usesInterceptor,
        );
        if (needsInterceptor) {
          log('Deploying interceptor...', 'installing_wrappers');
          shieldLog.info('Deploying interceptor to shared lib dir');
          try {
            const intResult = await deployInterceptorFn(userConfig);
            if (!intResult.success) {
              request.log.warn({ targetId }, `Interceptor deploy partial: ${intResult.message}`);
            }
            tracker.completeStep('deploy_interceptor');
            manifestBuilder.recordInfra('deploy_interceptor', 4, {});
          } catch (err) {
            request.log.warn({ targetId, err }, `Interceptor deploy failed: ${(err as Error).message}`);
            tracker.completeStep('deploy_interceptor');
            manifestBuilder.recordInfra('deploy_interceptor', 4, {});
          }
        } else {
          tracker.skipStep('deploy_interceptor');
        }

        // 4a1b. Deploy broker binary (agenshield-broker — executed by broker LaunchDaemon)
        tracker.startStep('deploy_broker_binary');
        log('Deploying broker binary...', 'installing_wrappers');
        shieldLog.info('Deploying broker binary to shared bin dir');
        try {
          const { copyBrokerBinary } = await import('@agenshield/sandbox');
          const brokerResult = await copyBrokerBinary(userConfig, hostHome);
          if (!brokerResult.success) {
            request.log.warn({ targetId }, `Broker binary deploy failed: ${brokerResult.message}`);
          }
          // In SEA mode, verify the SEA broker binary exists at libexec
          // (the LaunchDaemon plist references libexec/agenshield-broker)
          if (isSEA()) {
            const brokerSEAPath = `${hostHome}/.agenshield/libexec/agenshield-broker`;
            const { existsSync } = await import('node:fs');
            if (!existsSync(brokerSEAPath)) {
              shieldLog.error(`SEA broker binary not found at ${brokerSEAPath} — run install.sh to deploy`);
              request.log.error({ targetId }, `SEA broker binary missing at ${brokerSEAPath}`);
            }
          }
          tracker.completeStep('deploy_broker_binary');
          manifestBuilder.recordInfra('deploy_broker_binary', 4, {});
        } catch (err) {
          request.log.warn({ targetId, err }, `Broker binary deploy failed: ${(err as Error).message}`);
          tracker.completeStep('deploy_broker_binary');
          manifestBuilder.recordInfra('deploy_broker_binary', 4, {});
        }

        // 4a2. Deploy shield-client (used by curl/git wrappers to route through broker)
        tracker.startStep('deploy_shield_client');
        log('Deploying shield-client...', 'installing_wrappers');
        shieldLog.info('Deploying shield-client binary for wrapper scripts');
        try {
          const { copyShieldClient: copyShieldClientFn } = await import('@agenshield/sandbox');
          const clientResult = await copyShieldClientFn(userConfig, hostHome);
          if (!clientResult.success) {
            request.log.warn({ targetId }, `Shield-client deploy partial: ${clientResult.message}`);
          }
          // Bootstrap node-bin so shield-client's shebang works before Phase 7.
          // In SEA mode, process.execPath is the daemon binary, not a Node.js interpreter,
          // so skip this step — Phase 7 (NVM install + copyNodeBinary) will provide the real node-bin.
          if (!isSEA()) {
            const bootstrapNodeDest = `${agentHome}/bin/node-bin`;
            await executor.execAsRoot(
              `cp "${process.execPath}" "${bootstrapNodeDest}" && chown root:${groupName} "${bootstrapNodeDest}" && chmod 755 "${bootstrapNodeDest}"`,
              { timeout: 10_000 },
            );
            shieldLog.info(`Bootstrap node-bin copied from ${process.execPath} to ${bootstrapNodeDest}`);
          }
          tracker.completeStep('deploy_shield_client');
          manifestBuilder.recordInfra('deploy_shield_client', 4, {});
        } catch (err) {
          request.log.warn({ targetId, err }, `Shield-client deploy failed: ${(err as Error).message}`);
          tracker.completeStep('deploy_shield_client');
          manifestBuilder.recordInfra('deploy_shield_client', 4, {});
        }

        // 4b. Install wrapper scripts
        tracker.startStep('install_wrapper_scripts');
        log('Installing wrapper scripts...', 'installing_wrappers');
        shieldLog.info(`Installing wrapper scripts: ${preset.requiredBins.join(', ')}`);
        try {
          const wrapperConfig = getDefaultWrapperConfigFn(userConfig);
          const validNames = preset.requiredBins.filter((name: string) => wrapperDefs[name]);
          await installSpecificWrappersFn(validNames, binDir, wrapperConfig);
          tracker.completeStep('install_wrapper_scripts');
          manifestBuilder.recordInfra('install_wrapper_scripts', 4, {});
        } catch (err) {
          request.log.warn({ targetId, err }, `Wrapper scripts partial: ${(err as Error).message}`);
          tracker.completeStep('install_wrapper_scripts');
          manifestBuilder.recordInfra('install_wrapper_scripts', 4, {});
        }

        // 4c. Install seatbelt profiles (conditional — skip if no wrapper uses it)
        tracker.startStep('install_seatbelt');
        const needsSeatbelt = preset.requiredBins.some(
          (name: string) => wrapperDefs[name]?.usesSeatbelt,
        );
        if (needsSeatbelt) {
          log('Installing seatbelt profiles...', 'installing_wrappers');
          shieldLog.info('Generating and installing seatbelt profiles');
          try {
            const { installSeatbeltProfiles } = await import('@agenshield/sandbox');
            const agentProfile = generateAgentProfile({
              workspacePath: `${agentHome}/workspace`,
              socketPath: `${agentHome}/.agenshield/run/agenshield.sock`,
              agentHome,
              denyWritePaths: preset.seatbeltDenyPaths,
            });
            await installSeatbeltProfiles(userConfig, { agentProfile });
            tracker.completeStep('install_seatbelt');
            manifestBuilder.recordInfra('install_seatbelt', 4, {});
          } catch (err) {
            request.log.warn({ targetId, err }, `Seatbelt install partial: ${(err as Error).message}`);
            tracker.completeStep('install_seatbelt');
            manifestBuilder.recordInfra('install_seatbelt', 4, {});
          }
        } else {
          tracker.skipStep('install_seatbelt');
        }

        // 4d. Install basic system commands (ls, cat, grep, etc.)
        tracker.startStep('install_basic_commands');
        log('Installing basic commands...', 'installing_wrappers');
        shieldLog.info('Installing basic system command symlinks');
        try {
          await installBasicCommandsFn(binDir);
          tracker.completeStep('install_basic_commands');
          manifestBuilder.recordInfra('install_basic_commands', 4, {});
        } catch (err) {
          request.log.warn({ targetId, err }, `Basic commands partial: ${(err as Error).message}`);
          tracker.completeStep('install_basic_commands');
          manifestBuilder.recordInfra('install_basic_commands', 4, {});
        }

        // 4e. Lock down permissions (root-owned 755, then restore bin dir to broker 2775)
        tracker.startStep('lockdown_permissions');
        log('Locking down permissions...', 'installing_wrappers');
        shieldLog.info(`Locking down ${binDir}: root:${groupName} ownership`);
        try {
          await executor.execAsRoot([
            `chown -R root:${groupName} "${binDir}"`,
            `chmod -R 755 "${binDir}"`,
            `chown ${brokerUser}:${groupName} "${binDir}"`,
            `chmod 2775 "${binDir}"`,
          ].join(' && '), { timeout: 15_000 });
          tracker.completeStep('lockdown_permissions');
          manifestBuilder.recordInfra('lockdown_permissions', 4, { binDir });
        } catch (err) {
          request.log.warn({ targetId, err }, `Lockdown partial: ${(err as Error).message}`);
          tracker.completeStep('lockdown_permissions');
          manifestBuilder.recordInfra('lockdown_permissions', 4, { binDir });
        }

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
            buildInstallUserLocalRouterCommands,
          } = await import('@agenshield/sandbox');

          // Determine the binary name from base preset ID (e.g. 'claude-code' → 'claude')
          const binName = basePresetId.split('-')[0];

          // Find the original binary, skipping any existing router wrappers
          const originalBinary = findOriginalBinary(binName) ?? '';

          // Register this instance in the path registry (with agentUsername for sudo delegation)
          const updatedRegistry = addRegistryInstance(binName, {
            targetId,
            profileId: agentUser,
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
          // Also install router at ~/.agenshield/bin/<binName> (user-local, takes priority via shell rc)
          const userLocalCmd = buildInstallUserLocalRouterCommands(binName, wrapperContent, hostHome);
          await executor.execAsRoot(userLocalCmd, { timeout: 15_000 });
          // Ensure the user-local bin dir is owned by the host user
          await executor.execAsRoot(
            `chown -R ${hostUsername}:staff "${hostHome}/.agenshield/bin"`,
            { timeout: 10_000 },
          );

          tracker.completeStep('install_path_router');
          manifestBuilder.recordInfra('install_path_router', 5, { binName, hostHome });

          // Append PATH override to host shell rc (runs after NVM sourcing)
          tracker.startStep('install_path_shell_override');
          try {
            const hostShell = process.env['SHELL'] || '/bin/zsh';
            const rcFile = hostShell.endsWith('/zsh')
              ? `${hostHome}/.zshrc`
              : hostShell.endsWith('/bash')
                ? `${hostHome}/.bash_profile`
                : `${hostHome}/.profile`;

            const startMarker = '# >>> AgenShield PATH override >>>';
            const endMarker = '# <<< AgenShield PATH override <<<';

            // Only append if not already present
            const checkCmd = `grep -q '${startMarker}' "${rcFile}" 2>/dev/null`;
            const check = await executor.execAsRoot(checkCmd, { timeout: 5_000 }).catch(() => ({ success: false }));

            if (!check.success) {
              const block = [
                '',
                startMarker,
                '# DO NOT EDIT — managed by AgenShield. Remove with `agenshield uninstall`.',
                'export PATH="$HOME/.agenshield/bin:$PATH"',
                endMarker,
                '',
              ].join('\n');

              await executor.execAsRoot(
                `cat >> "${rcFile}" << 'AGENSHIELD_PATH_EOF'${block}AGENSHIELD_PATH_EOF`,
                { timeout: 10_000 },
              );
              // Restore ownership to host user
              await executor.execAsRoot(`chown ${hostUsername}:staff "${rcFile}"`, { timeout: 5_000 });
            }

            tracker.completeStep('install_path_shell_override');
            manifestBuilder.recordInfra('install_path_shell_override', 5, { rcFile, hostHome });
          } catch (shellRcErr) {
            tracker.completeStep('install_path_shell_override');
            request.log.warn({ targetId, err: shellRcErr }, `Shell rc PATH override: ${(shellRcErr as Error).message}`);
            // Non-fatal
          }

          // Seed default deny policy for router host passthrough
          try {
            const storage = getStorage();
            const repo = storage.for({ profileId: null }).policies;
            const policyId = 'managed-router-deny-host-passthrough';
            const existing = repo.getById(policyId);
            if (!existing) {
              repo.createManaged({
                id: policyId,
                name: 'Router: Deny Host Passthrough',
                action: 'deny',
                target: 'router',
                patterns: ['host-passthrough'],
                enabled: true,
              }, 'system');
              request.log.info({ targetId }, 'Seeded default router deny host-passthrough policy');
            }

            // Sync the registry flag based on current router policies
            const { syncRouterHostPassthrough } = await import('../services/router-sync');
            const allPolicies = repo.getAll();
            const syncResult = syncRouterHostPassthrough(allPolicies, hostHome);
            if (syncResult.updated) {
              const syncJson = JSON.stringify(syncResult.registry, null, 2);
              await executor.execAsRoot(
                `cat > "${registryDir}/path-registry.json" << 'REGISTRY_EOF'\n${syncJson}\nREGISTRY_EOF`,
                { timeout: 15_000 },
              );
            }
          } catch (policyErr) {
            request.log.warn({ targetId, err: policyErr }, `Router policy seeding: ${(policyErr as Error).message}`);
            // Non-fatal
          }
        } catch (err) {
          tracker.completeStep('install_path_registry');
          tracker.skipStep('install_path_router');
          tracker.skipStep('install_path_shell_override');
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
              shieldLog.resetStream();
              const onOutput = (stream: 'stdout' | 'stderr', data: string) => shieldLog.streamOutput(data, stream);
              const p = executor.execAsRoot(cmd, { ...opts, onOutput });
              p.then(r => shieldLog.result(r.success, r.output, r.error), () => { /* logged by caller */ });
              return p;
            },
            execAsUser: (cmd, opts) => {
              shieldLog.command(cmd, { user: agentUser, timeout: opts?.timeout });
              shieldLog.resetStream();
              const onOutput = (stream: 'stdout' | 'stderr', data: string) => shieldLog.streamOutput(data, stream);
              const p = executor.execAsUser(agentUser, cmd, { ...opts, onOutput });
              p.then(r => shieldLog.result(r.success, r.output, r.error), () => { /* logged by caller */ });
              return p;
            },
            execAsUserDirect: (cmd, opts) => {
              shieldLog.command(cmd, { user: agentUser, timeout: opts?.timeout, directShell: true });
              shieldLog.resetStream();
              const onOutput = (stream: 'stdout' | 'stderr', data: string) => shieldLog.streamOutput(data, stream);
              const p = executor.execAsUserDirect(agentUser, cmd, { ...opts, onOutput });
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
            onStepLog: (stepId, message) => {
              tracker.logStep(stepId, message);
            },
            profileBaseName: resolvedBaseName,
            freshInstall: body.freshInstall,
            configCopyCategories: body.configCopyCategories as import('@agenshield/sandbox').ClaudeConfigCategory[] | undefined,
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
          const skipSteps = ['install_homebrew', 'install_nvm', 'install_node', 'copy_node_binary', 'install_openclaw', 'copy_config', 'verify_openclaw', 'patch_node', 'write_gateway_plist'];
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
          denyWritePaths: preset.seatbeltDenyPaths,
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
          `\n` +
          `# AgenShield — allows broker to manage gateway LaunchDaemon without TTY\n` +
          `${brokerUser} ALL=(root) NOPASSWD: /bin/launchctl kickstart system/com.agenshield.${resolvedBaseName}.gateway\n` +
          `${brokerUser} ALL=(root) NOPASSWD: /bin/launchctl kickstart -k system/com.agenshield.${resolvedBaseName}.gateway\n` +
          `${brokerUser} ALL=(root) NOPASSWD: /bin/launchctl enable system/com.agenshield.${resolvedBaseName}.gateway\n` +
          `${brokerUser} ALL=(root) NOPASSWD: /bin/launchctl disable system/com.agenshield.${resolvedBaseName}.gateway\n` +
          `${brokerUser} ALL=(root) NOPASSWD: /bin/launchctl kill SIGTERM system/com.agenshield.${resolvedBaseName}.gateway\n` +
          `${brokerUser} ALL=(root) NOPASSWD: /bin/launchctl bootout system/com.agenshield.${resolvedBaseName}.gateway\n` +
          `${brokerUser} ALL=(root) NOPASSWD: /bin/launchctl list com.agenshield.${resolvedBaseName}.gateway\n` +
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
        // Derive daemon URL from Fastify server address for broker identity
        const addrInfo = app.server.address();
        const daemonPort = (typeof addrInfo === 'object' && addrInfo?.port) || 5200;
        const daemonUrl = `http://127.0.0.1:${daemonPort}`;

        // Resolve native module path for broker plist (SEA mode)
        let nativeModulePath: string | undefined;
        if (isSEA()) {
          try {
            const version = getSEAVersion();
            if (version) {
              const candidate = `${hostHome}/.agenshield/lib/v${version}/native/better_sqlite3.node`;
              const fsSync = await import('node:fs');
              if (fsSync.existsSync(candidate)) {
                nativeModulePath = candidate;
              }
            }
          } catch {
            // Non-fatal — broker will try AGENSHIELD_HOST_HOME fallback
          }
        }

        // Check if /Applications/AgenShieldES.app exists for AssociatedBundleIdentifiers
        let hostAppInstalled = false;
        const hostAppPath = '/Applications/AgenShieldES.app';
        try {
          const fsSync = await import('node:fs');
          if (fsSync.existsSync(hostAppPath)) {
            hostAppInstalled = true;
            shieldLog.info('Host app found at /Applications/AgenShieldES.app');
          } else {
            // Try to install from embedded bundle (best-effort)
            try {
              const { getESExtensionAppPath } = await import('@agenshield/sandbox');
              const embeddedApp = getESExtensionAppPath();
              if (embeddedApp) {
                const cpResult = await executor.execAsRoot(
                  `cp -r "${embeddedApp}" "${hostAppPath}" && chown -R root:wheel "${hostAppPath}"`,
                  { timeout: 15_000 },
                );
                if (cpResult.success) {
                  hostAppInstalled = true;
                  shieldLog.info(`Installed AgenShieldES.app from embedded bundle to ${hostAppPath}`);
                } else {
                  shieldLog.warn(`Failed to install AgenShieldES.app: ${cpResult.error ?? cpResult.output}`);
                }
              } else {
                shieldLog.info('Host app not bundled — omitting AssociatedBundleIdentifiers');
              }
            } catch {
              shieldLog.info('Host app not found — omitting AssociatedBundleIdentifiers');
            }
          }
        } catch {
          shieldLog.info('Could not check host app — omitting AssociatedBundleIdentifiers');
        }

        // In SEA mode, use a launcher shell script so ProgramArguments references /bin/bash
        // (Apple-signed) instead of the SEA binary directly — avoids AMFI validation failures
        // on macOS Sequoia (Bootstrap failed: 5: Input/output error).
        const brokerLauncherPath = isSEA()
          ? `${agentHome}/.agenshield/bin/broker-launcher.sh`
          : undefined;

        const plistContent = generateBrokerPlist(userConfig, {
          baseName: resolvedBaseName,
          socketPath: pathsConfig.socketPath,
          hostHome,
          isSEABinary: isSEA(),
          daemonUrl,
          nativeModulePath,
          includeAssociatedBundle: hostAppInstalled,
          launcherScriptPath: brokerLauncherPath,
        });
        const brokerLabel = `com.agenshield.broker.${baseName}`;
        const plistPath = `/Library/LaunchDaemons/${brokerLabel}.plist`;
        shieldLog.fileContent('Broker plist', plistPath, plistContent);
        shieldLog.launchdEvent('load', brokerLabel, plistPath);
        emitEvent('process:started', { process: 'broker', action: 'spawning', pid: undefined } as import('@agenshield/ipc').ProcessEventPayload);
        shieldLog.processEvent('spawning', brokerLabel, { user: brokerUser, plistPath });

        // Fix log directory permissions BEFORE bootstrap so broker can write logs immediately
        const logDir = `${agentHome}/.agenshield/logs`;
        try {
          await executor.execAsRoot(
            `mkdir -p "${logDir}" && chown ${brokerUser}:${groupName} "${logDir}" && chmod 2775 "${logDir}"`,
            { timeout: 10_000 },
          );
        } catch {
          shieldLog.warn(`Failed to fix log dir permissions for ${logDir}`);
        }

        // Verify broker binary exists and is executable by broker user before bootstrap (SEA mode)
        if (isSEA()) {
          const brokerBinaryPath = `${hostHome}/.agenshield/libexec/agenshield-broker`;
          const verifyResult = await executor.execAsRoot(
            [
              `test -f "${brokerBinaryPath}" && echo "EXISTS" || echo "MISSING"`,
              `sudo -u ${brokerUser} test -x "${brokerBinaryPath}" && echo "EXEC_OK" || echo "EXEC_FAIL"`,
            ].join('; '),
            { timeout: 5_000 },
          );
          const out = verifyResult.output ?? '';
          if (out.includes('MISSING')) {
            shieldLog.error(`Broker binary not found at ${brokerBinaryPath}`);
          } else if (out.includes('EXEC_FAIL')) {
            shieldLog.warn(`Broker binary not executable by ${brokerUser} — ACL or permission issue`);
          } else {
            shieldLog.info(`Broker binary verified: accessible by ${brokerUser}`);
          }
        }

        // Write broker launcher script (SEA mode) — the primary fix for AMFI validation
        // failures on macOS Sequoia. The launcher wraps the SEA binary so launchctl
        // bootstraps /bin/bash (Apple-signed) and `exec` preserves PID tracking.
        if (isSEA() && brokerLauncherPath) {
          const brokerBinaryPath = `${hostHome}/.agenshield/libexec/agenshield-broker`;
          const configFilePath = `${agentHome}/.agenshield/config/shield.json`;
          const logDirPath = `${agentHome}/.agenshield/logs`;
          const launcherContent = generateBrokerLauncherScript({
            brokerBinaryPath,
            configPath: configFilePath,
            socketPath: pathsConfig.socketPath,
            agentHome,
            hostHome,
            logDir: logDirPath,
            daemonUrl,
            profileId: userConfig.agentUser.username,
            nativeModulePath,
          });
          try {
            await executor.execAsRoot(
              `mkdir -p "${agentHome}/.agenshield/bin" && cat > "${brokerLauncherPath}" << 'LAUNCHER_EOF'\n${launcherContent}\nLAUNCHER_EOF\nchown root:wheel "${brokerLauncherPath}" && chmod 755 "${brokerLauncherPath}"`,
              { timeout: 10_000 },
            );
            shieldLog.info(`Broker launcher script written: ${brokerLauncherPath}`);
          } catch (launcherErr) {
            shieldLog.error(`Failed to write broker launcher script: ${(launcherErr as Error).message}`);
          }
        }

        // Fix ownership, quarantine, and code signature for launchctl bootstrap (defense-in-depth).
        // The primary fix is the launcher script above; code-signing provides additional
        // defense-in-depth for other validation points.
        try {
          const brokerBin = `${hostHome}/.agenshield/libexec/agenshield-broker`;
          const tmpEnt = `/tmp/agenshield-ent-${Date.now()}.plist`;
          const entXml = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/><key>com.apple.security.cs.disable-library-validation</key><true/></dict></plist>';
          await executor.execAsRoot(
            [
              `chown root:wheel "${hostHome}/.agenshield/libexec"`,
              `chown root:wheel "${brokerBin}"`,
              `xattr -d com.apple.quarantine "${brokerBin}" 2>/dev/null; true`,
              `printf '%s' '${entXml}' > "${tmpEnt}"`,
              `codesign --force --sign - --options runtime --entitlements "${tmpEnt}" "${brokerBin}"`,
              `rm -f "${tmpEnt}"`,
            ].join(' && '),
            { timeout: 15_000 },
          );
          try {
            const signInfo = await executor.execAsRoot(
              `codesign -dvv "${brokerBin}" 2>&1 | head -5`,
              { timeout: 5_000 },
            );
            if (signInfo.output) {
              shieldLog.info(`Broker binary signing: ${signInfo.output.trim()}`);
            }
          } catch { /* diagnostic logging is best-effort */ }
        } catch {
          shieldLog.warn('Failed to fix libexec for bootstrap — bootstrap may fail');
        }

        let brokerBootstrapOk = true;

        // Step A: Write plist and set permissions
        const writePlistResult = await executor.execAsRoot(
          `cat > "${plistPath}" << 'PLIST_EOF'\n${plistContent}\nPLIST_EOF\nchown root:wheel "${plistPath}"\nchmod 644 "${plistPath}"`,
          { timeout: 10_000 },
        );
        if (!writePlistResult.success) {
          shieldLog.error(`Failed to write broker plist: ${writePlistResult.error ?? writePlistResult.output}`);
          brokerBootstrapOk = false;
        }

        // Step B: Validate plist (catches XML/encoding errors)
        if (brokerBootstrapOk) {
          const plutilResult = await executor.execAsRoot(`plutil -lint "${plistPath}"`, { timeout: 5_000 });
          if (!plutilResult.success || !(plutilResult.output ?? '').includes('OK')) {
            shieldLog.error(`Plist validation failed: ${plutilResult.output ?? plutilResult.error}`);
            brokerBootstrapOk = false;
          }
        }

        // Step C: Pre-bootstrap verification
        if (brokerBootstrapOk && brokerLauncherPath) {
          const launcherCheck = await executor.execAsRoot(
            `test -x "${brokerLauncherPath}" && echo "LAUNCHER_OK" || echo "LAUNCHER_MISSING"; ls -la "${brokerLauncherPath}" 2>&1`,
            { timeout: 5_000 },
          );
          shieldLog.info(`Pre-bootstrap launcher check: ${launcherCheck.output?.trim()}`);
        }

        // Step D: Bootout stale service + bootstrap (sudo forces new audit session for system domain access)
        if (brokerBootstrapOk) {
          const bootoutResult = await executor.execAsRoot(
            `sudo launchctl bootout system/${brokerLabel} 2>&1; echo "BOOTOUT_EXIT=$?"`,
            { timeout: 10_000 },
          );
          if (bootoutResult.output) {
            shieldLog.info(`Broker bootout: ${bootoutResult.output.trim()}`);
          }

          const bootstrapResult = await executor.execAsRoot(
            `sudo launchctl bootstrap system "${plistPath}" 2>&1`,
            { timeout: 15_000 },
          );
          if (!bootstrapResult.success) {
            shieldLog.error(`launchctl bootstrap failed: ${bootstrapResult.output ?? bootstrapResult.error}`);

            // Capture launchd syslog for bootstrap failure diagnostics
            try {
              const syslog = await executor.execAsRoot(
                `log show --predicate 'subsystem == "com.apple.launchd"' --last 1m --style syslog 2>/dev/null | grep -i "${brokerLabel}" | tail -5 || echo "NO_SYSLOG"`,
                { timeout: 10_000 },
              );
              if (syslog.output) shieldLog.info(`launchd syslog: ${syslog.output.trim()}`);
            } catch { /* best-effort diagnostics */ }

            // Fallback: try deprecated launchctl load -w (looser session requirements)
            shieldLog.warn(`bootstrap failed, trying deprecated launchctl load -w as fallback...`);
            const loadResult = await executor.execAsRoot(
              `sudo launchctl load -w "${plistPath}" 2>&1`,
              { timeout: 15_000 },
            );
            if (loadResult.success) {
              shieldLog.info(`launchctl load -w succeeded for ${brokerLabel}`);
              brokerBootstrapOk = true;
            } else {
              shieldLog.error(`launchctl load -w also failed: ${loadResult.output ?? loadResult.error}`);
              brokerBootstrapOk = false;
            }
          } else {
            shieldLog.info(`launchctl bootstrap succeeded for ${brokerLabel}`);
            // Kickstart to ensure immediate start
            await executor.execAsRoot(`sudo launchctl kickstart system/${brokerLabel} 2>/dev/null; true`, { timeout: 10_000 });
          }
        }

        // Step E: Post-bootstrap verification
        if (brokerBootstrapOk) {
          const verifyResult = await executor.execAsRoot(`launchctl list ${brokerLabel} 2>&1`, { timeout: 5_000 });
          if (verifyResult.success && verifyResult.output) {
            shieldLog.info(`Post-bootstrap: ${verifyResult.output.trim()}`);
          } else {
            shieldLog.warn(`Service ${brokerLabel} not visible after bootstrap`);
          }
        }

        if (!brokerBootstrapOk) {
          tracker.failStep('install_broker_daemon', 'Broker bootstrap failed — see logs for details');
        } else {
          shieldLog.processEvent('spawned', brokerLabel);
          tracker.completeStep('install_broker_daemon');
        }
        manifestBuilder.recordInfra('install_broker_daemon', 11, { brokerLabel, plistPath });

        // 8a. Generate broker JWT and write token file to agent home
        const profileId = agentUser;
        const brokerJwt = await signBrokerToken(profileId, profileId);
        try {
          const tokenFilePath = `${agentHome}/.agenshield-token`;
          await executor.execAsRoot(
            `printf '%s\\n' '${brokerJwt}' > "${tokenFilePath}" && chmod 640 "${tokenFilePath}" && chown ${brokerUser}:${groupName} "${tokenFilePath}"`,
            { timeout: 10_000 },
          );
          shieldLog.info(`Broker token file written to ${tokenFilePath}`);
        } catch (err) {
          shieldLog.warn(`Failed to write broker token file: ${(err as Error).message} — broker will use plist env vars`);
        }

        // Helper: collect broker diagnostics (used by both bootstrap-failure and socket-timeout paths)
        const collectBrokerDiagnostics = async () => {
          try {
            const diagResult = await executor.execAsRoot([
              `launchctl print system/${brokerLabel} 2>&1 || echo "NO_BROKER_PRINT"`,
              `launchctl list | grep ${brokerLabel} 2>/dev/null || echo "NO_BROKER_IN_LAUNCHCTL"`,
              `id ${brokerUser} 2>&1 || echo "USER_NOT_FOUND"`,
              `sudo -u ${brokerUser} test -x "${hostHome}/.agenshield/libexec/agenshield-broker" && echo "BINARY_ACCESSIBLE" || echo "BINARY_NOT_ACCESSIBLE"`,
              `sudo -u ${brokerUser} test -w "${agentHome}/.agenshield/logs" && echo "LOG_DIR_WRITABLE" || echo "LOG_DIR_NOT_WRITABLE"`,
              `ls -la "${hostHome}/.agenshield/libexec/" 2>/dev/null || echo "NO_LIBEXEC_DIR"`,
              `sudo -u ${brokerUser} timeout 3 "${hostHome}/.agenshield/libexec/agenshield-broker" --version 2>&1 || echo "DRY_RUN_FAILED"`,
              `tail -30 "${agentHome}/.agenshield/logs/broker.error.log" 2>/dev/null || echo "NO_BROKER_LOG"`,
              `log show --predicate 'subsystem == "com.apple.launchd"' --last 3m --style syslog 2>/dev/null | grep -i agenshield | tail -10 || echo "NO_LAUNCHD_LOG"`,
            ].join('; '), { timeout: 20_000 });
            shieldLog.info(`Broker diagnostics:\n${diagResult.output ?? 'N/A'}`);
          } catch { /* best-effort diagnostics */ }
        };

        // 8b. Wait for broker socket before starting gateway (prevents crash loop)
        if (gatewayPlistPath && brokerBootstrapOk) {
          tracker.startStep('wait_broker_socket');
          currentStep = 'waiting_broker_socket';
          shieldLog.step('waiting_broker_socket', `Waiting for broker socket at ${pathsConfig.socketPath}...`);
          log('Waiting for broker socket...', 'waiting_broker_socket');

          const SOCKET_WAIT_MS = 45_000;
          let socketReady = false;

          const fsNode = await import('node:fs');
          const pathNode = await import('node:path');
          const socketDir = pathNode.dirname(pathsConfig.socketPath);
          const socketName = pathNode.basename(pathsConfig.socketPath);

          // Ensure socket directory exists before watching (fs.watch fails otherwise)
          try { fsNode.mkdirSync(socketDir, { recursive: true }); } catch { /* best effort */ }

          // Fast check — socket may already exist
          try {
            const stat = fsNode.statSync(pathsConfig.socketPath);
            if (stat.isSocket?.()) socketReady = true;
          } catch { /* not yet */ }

          // Helper: poll for socket existence (backup for macOS fs.watch misses)
          const pollForSocket = (sockPath: string, timeoutMs: number): Promise<boolean> => {
            return new Promise<boolean>((resolve) => {
              const deadline = setTimeout(() => {
                clearInterval(poller);
                watcher.close();
                resolve(false);
              }, timeoutMs);

              // Parallel polling at 500ms intervals — macOS fs.watch can miss socket events
              const poller = setInterval(() => {
                try {
                  const s = fsNode.statSync(sockPath);
                  if (s.isSocket?.()) {
                    clearTimeout(deadline);
                    clearInterval(poller);
                    watcher.close();
                    resolve(true);
                  }
                } catch { /* not yet */ }
              }, 500);

              const watcher = fsNode.watch(socketDir, (_, filename) => {
                if (filename === socketName) {
                  try {
                    const s = fsNode.statSync(sockPath);
                    if (s.isSocket?.()) {
                      clearTimeout(deadline);
                      clearInterval(poller);
                      watcher.close();
                      resolve(true);
                    }
                  } catch { /* not yet */ }
                }
              });

              watcher.on('error', () => {
                // Watcher failed — polling continues as fallback
              });
            });
          };

          // If not ready, watch + poll for creation
          if (!socketReady) {
            socketReady = await pollForSocket(pathsConfig.socketPath, SOCKET_WAIT_MS);
          }

          // Retry with kickstart -k if first wait failed (helps under multi-target load)
          if (!socketReady) {
            shieldLog.info('Broker socket not ready — retrying with kickstart -k...');
            try {
              await executor.execAsRoot(
                `launchctl kickstart -k system/${brokerLabel} 2>/dev/null; true`,
                { timeout: 10_000 },
              );
            } catch (kickErr) {
              shieldLog.info(`Kickstart retry failed: ${(kickErr as Error).message} — continuing to poll...`);
            }
            socketReady = await pollForSocket(pathsConfig.socketPath, 15_000);
          }

          if (socketReady) {
            shieldLog.info(`Broker socket ready at ${pathsConfig.socketPath}`);
            tracker.completeStep('wait_broker_socket');
          } else {
            // Hard gate: broker socket not available — collect diagnostics and skip gateway
            shieldLog.error(`Broker socket not ready after ${SOCKET_WAIT_MS}ms — skipping gateway start`);
            await collectBrokerDiagnostics();
            tracker.failStep('wait_broker_socket', 'Broker socket not ready — gateway start deferred');
            log('Broker socket not ready — gateway start deferred. Use /targets/lifecycle/:targetId/start to retry.', 'waiting_broker_socket');

            // Rollback: restart host processes since shielded replacement failed
            if (hostUsername && basePresetId === 'openclaw') {
              shieldLog.info('Rolling back: restarting host OpenClaw processes...');
              try {
                await executor.execAsRoot(
                  `sudo -H -u ${hostUsername} openclaw daemon start 2>/dev/null || true; sudo -H -u ${hostUsername} openclaw gateway start 2>/dev/null || true`,
                  { timeout: 30_000 },
                );
                shieldLog.info('Host OpenClaw processes restarted.');
              } catch {
                shieldLog.error('Failed to restart host OpenClaw processes.');
              }
            }

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
              `sudo launchctl bootout system/${gatewayLabel} 2>/dev/null; true\nsudo launchctl bootstrap system "${gatewayPlistPath}"\nsudo launchctl kickstart system/${gatewayLabel}`,
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
        } else if (gatewayPlistPath && !brokerBootstrapOk) {
          // Bootstrap failed — skip socket wait entirely (fail fast)
          shieldLog.error('Broker bootstrap failed — skipping socket wait');
          tracker.startStep('wait_broker_socket');
          tracker.failStep('wait_broker_socket', 'Broker bootstrap failed');
          await collectBrokerDiagnostics();
          log('Broker bootstrap failed — skipping socket wait. See logs for details.', 'waiting_broker_socket');

          // Rollback: restart host processes since shielded replacement failed
          if (hostUsername && basePresetId === 'openclaw') {
            shieldLog.info('Rolling back: restarting host OpenClaw processes...');
            try {
              await executor.execAsRoot(
                `sudo -H -u ${hostUsername} openclaw daemon start 2>/dev/null || true; sudo -H -u ${hostUsername} openclaw gateway start 2>/dev/null || true`,
                { timeout: 30_000 },
              );
              shieldLog.info('Host OpenClaw processes restarted.');
            } catch {
              shieldLog.error('Failed to restart host OpenClaw processes.');
            }
          }

          tracker.skipStep('gateway_preflight');
          tracker.skipStep('start_gateway');
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

        // Allocate gateway port for openclaw targets
        const gatewayPort = basePresetId === 'openclaw' ? allocateGatewayPort() : undefined;

        const profile = storage.profiles.create({
          id: profileId,
          name: agentUser,
          presetId: basePresetId,
          agentUsername: agentUser,
          agentUid: userConfig.agentUser.uid,
          agentHomeDir: agentHome,
          brokerUsername: brokerUser,
          brokerUid: userConfig.brokerUser.uid,
          brokerHomeDir: agentHome,
          brokerToken: brokerJwt,
        });
        invalidateTokenCache();

        // Persist gateway port if allocated
        if (gatewayPort != null) {
          storage.profiles.update(profileId, { gatewayPort });
        }

        tracker.setProfileId(profile.id);
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

        // Check for critical infrastructure failures
        const failedSteps = tracker.getSteps().filter(s => s.status === 'failed');
        const criticalFailures = failedSteps.filter(s =>
          ['wait_broker_socket', 'install_broker_daemon', 'gateway_preflight'].includes(s.id)
        );
        const brokerFailed = criticalFailures.length > 0;

        emitEvent('setup:shield_complete', { targetId, profileId: profile.id }, profile.id);
        log('Shielding complete.', 'complete');
        flushLog();
        shieldLog.finish(!brokerFailed, brokerFailed ? 'Broker socket not ready' : undefined);
        tracker.completeStep('finalize');
        request.log.info({ targetId, logPath: shieldLog.logPath }, 'Shield log saved');

        triggerTargetCheck();
        unregisterShieldOperation(targetId);
        return {
          success: true,
          data: {
            targetId,
            profileId: profile.id,
            logPath: shieldLog.logPath,
            ...(brokerFailed && {
              warning: 'Broker did not start — gateway deferred',
              failedSteps: criticalFailures.map(s => s.id),
            }),
          },
        };
      } catch (err) {
        flushLog();
        unregisterShieldOperation(targetId);
        const message = (err as Error).message;
        shieldLog.error(`Shield failed at step "${currentStep}": ${message}`);
        shieldLog.finish(false, message);
        // Fail whichever step is currently running in the tracker
        const runningStep = tracker.getSteps().find(s => s.status === 'running');
        if (runningStep) tracker.failStep(runningStep.id, message);
        request.log.error({ targetId, err, step: currentStep, logPath: shieldLog.logPath }, `Shield failed at step "${currentStep}": ${message}`);
        emitEvent('setup:error', { targetId, error: message, step: currentStep }, tracker.getProfileId());

        // ── Rollback completed steps so the target can be re-shielded ──
        if (manifestBuilder) {
          try {
            const { getRollbackHandler } = await import('@agenshield/sandbox');
            const manifest = manifestBuilder.build();
            const entries = manifest.entries
              .filter(e => e.status === 'completed' && e.changed)
              .reverse();

            if (entries.length > 0) {
              shieldLog.info(`Rolling back ${entries.length} completed steps...`);
              emitEvent('setup:shield_progress', { targetId, step: 'rollback', progress: 0, message: 'Rolling back failed shield...' }, tracker.getProfileId());

              const hostHome = hostUsername ? `/Users/${hostUsername}` : (process.env['HOME'] || '');
              const rollbackCtx = {
                execAsRoot: (cmd: string, opts?: { timeout?: number }) => executor.execAsRoot(cmd, opts),
                onLog: (msg: string) => shieldLog.info(`  ${msg}`),
                agentHome: manifest.entries.find(e => e.outputs['agentHome'])?.outputs['agentHome'] ?? '',
                agentUsername: manifest.entries.find(e => e.outputs['agentUsername'])?.outputs['agentUsername'] ?? '',
                profileBaseName: baseName,
                hostHome,
                hostUsername,
              };

              for (const entry of entries) {
                const handler = getRollbackHandler(entry.stepId);
                if (handler) {
                  try {
                    await handler(rollbackCtx, entry);
                  } catch (rbErr) {
                    shieldLog.info(`Rollback of ${entry.stepId} failed (best-effort): ${(rbErr as Error).message}`);
                  }
                }
              }
              shieldLog.info('Rollback complete.');
            }
          } catch (rollbackErr) {
            shieldLog.error(`Rollback failed: ${(rollbackErr as Error).message}`);
          }
        }

        return reply.code(500).send({
          success: false,
          error: { code: 'SHIELD_ERROR', message, step: currentStep, logPath: shieldLog.logPath },
        });
      }
    },
  );

  /**
   * GET /targets/lifecycle/active-operations — List in-progress shield operations.
   * Used by the frontend to recover progress state after page refresh.
   */
  app.get('/targets/lifecycle/active-operations', async () => {
    return { success: true, data: getActiveShieldOperations() };
  });

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
          emitEvent('setup:log', { targetId, message, stepId }, profile.id);
        };

        if (profile.installManifest) {
          // ── Manifest-driven rollback ───────────────────────────────
          log('Using manifest-driven rollback...', 'rollback');
          emitEvent('setup:shield_progress', { targetId, step: 'rollback', progress: 5, message: 'Rolling back via manifest...' }, profile.id);

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
            emitEvent('setup:shield_progress', { targetId, step: 'rollback', progress, message: `Rolling back ${entry.stepId}...` }, profile.id);

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
          emitEvent('setup:shield_progress', { targetId, step: 'removing_policies', progress: 88, message: 'Removing policies...' }, profile.id);
          log('Removing seeded policies...', 'removing_policies');
          try {
            const scopedStorage = storage.for({ profileId: profile.id });
            scopedStorage.policies.deleteAll();
          } catch {
            // Best-effort
          }

          emitEvent('setup:shield_progress', { targetId, step: 'removing_profile', progress: 95, message: 'Removing profile...' }, profile.id);
          log('Removing profile from storage...', 'removing_profile');
          storage.profiles.delete(profile.id);

        } else {
          // ── Legacy fallback — hardcoded unshield ───────────────────
          log('No install manifest found — using legacy unshield...', 'legacy_unshield');

          // 1. Stop target app processes
          emitEvent('setup:shield_progress', { targetId, step: 'stopping_processes', progress: 5, message: 'Stopping target processes...' }, profile.id);
          log('Stopping all processes for agent user...', 'stopping_processes');
          if (agentUsername) {
            await executor.execAsRoot(
              `ps -u $(id -u ${agentUsername} 2>/dev/null) -o pid= 2>/dev/null | xargs kill 2>/dev/null; sleep 1; ps -u $(id -u ${agentUsername} 2>/dev/null) -o pid= 2>/dev/null | xargs kill -9 2>/dev/null; true`,
              { timeout: 15_000 },
            ).catch(() => {});
          }

          // 2. Remove PATH override (restore original binary from backup)
          emitEvent('setup:shield_progress', { targetId, step: 'removing_path', progress: 15, message: 'Removing PATH override...' }, profile.id);
          log('Removing PATH router override...', 'removing_path');
          try {
            const {
              resolvePresetId,
              removeRegistryInstance,
              buildRemoveRouterCommands,
              buildRemoveUserLocalRouterCommands,
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

              // Also remove user-local router at ~/.agenshield/bin/<binName>
              const removeUserLocalCmd = buildRemoveUserLocalRouterCommands(binName, hostHome);
              await executor.execAsRoot(removeUserLocalCmd, { timeout: 5_000 }).catch(() => {});
            }

            if (Object.keys(registry).length === 0) {
              await executor.execAsRoot(`rm -f "${resolvedRegistryPath}"`, { timeout: 5_000 }).catch(() => {});

              // Remove shell rc PATH override block when no targets remain
              const startMarker = '# >>> AgenShield PATH override >>>';
              const endMarker = '# <<< AgenShield PATH override <<<';
              const hostShell = process.env['SHELL'] || '/bin/zsh';
              const rcFile = hostShell.endsWith('/zsh')
                ? `${hostHome}/.zshrc`
                : hostShell.endsWith('/bash')
                  ? `${hostHome}/.bash_profile`
                  : `${hostHome}/.profile`;
              await executor.execAsRoot(
                `sed -i '' '/${startMarker.replace(/[/]/g, '\\/')}/,/${endMarker.replace(/[/]/g, '\\/')}/d' "${rcFile}" 2>/dev/null; true`,
                { timeout: 10_000 },
              ).catch(() => {});
              // Restore ownership
              try {
                const { execSync } = await import('node:child_process');
                const consoleUser = execSync('stat -f "%Su" /dev/console', { encoding: 'utf-8', timeout: 3_000 }).trim();
                await executor.execAsRoot(`chown ${consoleUser}:staff "${rcFile}"`, { timeout: 5_000 }).catch(() => {});
              } catch { /* best effort */ }
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
          emitEvent('setup:shield_progress', { targetId, step: 'removing_daemons', progress: 25, message: 'Removing LaunchDaemons...' }, profile.id);
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
          emitEvent('setup:shield_progress', { targetId, step: 'removing_sudoers', progress: 35, message: 'Removing sudo rules...' }, profile.id);
          log('Removing sudoers rules...', 'removing_sudoers');
          await executor.execAsRoot(
            `rm -f "/etc/sudoers.d/agenshield-${profileBaseName}" 2>/dev/null; true`,
            { timeout: 5_000 },
          ).catch(() => {});

          // 5. Remove seatbelt and guarded shell from /etc/shells
          emitEvent('setup:shield_progress', { targetId, step: 'removing_seatbelt', progress: 45, message: 'Removing security profile...' }, profile.id);
          if (agentHomeDir) {
            await executor.execAsRoot(
              `sed -i '' '\\|${agentHomeDir}/.agenshield/bin/guarded-shell|d' /etc/shells 2>/dev/null; true`,
              { timeout: 5_000 },
            ).catch(() => {});
          }

          // 6. Delete agent home directory
          emitEvent('setup:shield_progress', { targetId, step: 'removing_home', progress: 55, message: 'Removing agent home directory...' }, profile.id);
          if (agentHomeDir) {
            log(`Removing agent home directory ${agentHomeDir}...`, 'removing_home');
            await executor.execAsRoot(
              `rm -rf "${agentHomeDir}"`,
              { timeout: 60_000 },
            ).catch(() => {});
          }

          // 7. Delete sandbox users (agent + broker)
          emitEvent('setup:shield_progress', { targetId, step: 'removing_users', progress: 65, message: 'Removing sandbox users...' }, profile.id);
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
          emitEvent('setup:shield_progress', { targetId, step: 'removing_groups', progress: 75, message: 'Removing sandbox groups...' }, profile.id);
          log('Removing sandbox groups...', 'removing_groups');
          const socketGroupName = `ash_${profileBaseName}`;
          await executor.execAsRoot(
            `dscl . -delete /Groups/${socketGroupName} 2>/dev/null; true`,
            { timeout: 15_000 },
          ).catch(() => {});

          // 9. Delete seeded policies
          emitEvent('setup:shield_progress', { targetId, step: 'removing_policies', progress: 82, message: 'Removing policies...' }, profile.id);
          log('Removing seeded policies...', 'removing_policies');
          try {
            const scopedStorage = storage.for({ profileId: profile.id });
            scopedStorage.policies.deleteAll();
          } catch {
            // Best-effort
          }

          // 10. Delete profile from storage
          emitEvent('setup:shield_progress', { targetId, step: 'removing_profile', progress: 90, message: 'Removing profile...' }, profile.id);
          log('Removing profile from storage...', 'removing_profile');
          storage.profiles.delete(profile.id);
        }

        emitEvent('setup:shield_progress', { targetId, step: 'cleanup', progress: 98, message: 'Final cleanup...' }, profile.id);
        emitEvent('setup:shield_progress', { targetId, step: 'complete', progress: 100, message: 'Unshielding complete' }, profile.id);
        emitEvent('setup:shield_complete', { targetId, profileId: profile.id }, profile.id);
        log('Unshielding complete.', 'complete');

        triggerTargetCheck();
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

      // Claude Code is terminal-launched — no daemon to start
      try {
        const storage = getStorage();
        const startProfile = storage.profiles.getAll().find((p) => p.id === targetId)
          ?? storage.profiles.getAll().find((p: { presetId?: string }) => p.presetId === targetId);
        if ((startProfile as { presetId?: string })?.presetId === 'claude-code') {
          return reply.code(400).send({
            success: false,
            error: { code: 'NOT_STARTABLE', message: 'Claude Code is launched from the terminal. Start a claude session manually.' },
          });
        }
      } catch { /* fall through to normal flow */ }

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
          const result = await executor.execAsRoot(`launchctl kickstart -k system/${label}`, { timeout: 15_000 });
          if (result.success) {
            lastError = undefined;
            break;
          }
          lastError = new Error(result.error || `Failed to start ${label}`);
        }
        if (lastError) throw lastError;

        // Also start gateway for OpenClaw targets
        const presetId = (profile as { presetId?: string })?.presetId;
        if (presetId === 'openclaw') {
          const agentUsername = profile?.agentUsername;
          const agentHome = profile?.agentHomeDir;
          const processManager = app.processManager;

          if (processManager && agentUsername && agentHome) {
            // Use ProcessManager for direct gateway lifecycle management
            try {
              // Read gateway config if available
              const configPath = `${agentHome}/.agenshield/config/gateway.json`;
              let gwCommand = 'openclaw gateway run';
              let gwPort: number | undefined;
              let gwEnv: Record<string, string> = {};
              try {
                const fs = await import('node:fs');
                if (fs.existsSync(configPath)) {
                  const gwConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                  gwCommand = gwConfig.command ?? gwCommand;
                  gwPort = gwConfig.port;
                  gwEnv = gwConfig.env ?? {};
                  if (gwPort) gwCommand += ` --port ${gwPort}`;
                }
              } catch { /* use defaults */ }

              const guardedShell = `${agentHome}/.agenshield/bin/guarded-shell`;
              processManager.spawn({
                targetId,
                profileId: profile.id,
                command: gwCommand,
                runAsUser: agentUsername,
                agentHome,
                env: gwEnv,
                gatewayPort: gwPort,
                guardedShell,
              });
            } catch (gwErr) {
              request.log.warn({ err: gwErr }, 'Gateway spawn via ProcessManager failed');
            }
          } else {
            // Fallback to launchctl if ProcessManager not available
            const gwLabel = `com.agenshield.${startBaseName}.gateway`;
            await executor.execAsRoot(
              `launchctl enable system/${gwLabel} 2>/dev/null; true\nlaunchctl kickstart system/${gwLabel}`,
              { timeout: 15_000 },
            ).catch(() => { /* gateway start is best-effort */ });
          }
        }

        emitEvent('process:started', { process: targetId, action: 'start' }, profile?.id);
        triggerTargetCheck();
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

      // Claude Code is terminal-launched — no daemon to stop
      try {
        const storage = getStorage();
        const stopProfile = storage.profiles.getAll().find((p) => p.id === targetId)
          ?? storage.profiles.getAll().find((p: { presetId?: string }) => p.presetId === targetId);
        if ((stopProfile as { presetId?: string })?.presetId === 'claude-code') {
          return reply.code(400).send({
            success: false,
            error: { code: 'NOT_STOPPABLE', message: 'Claude Code is launched from the terminal. Close your claude sessions manually.' },
          });
        }
      } catch { /* fall through to normal flow */ }

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
          const result = await executor.execAsRoot(`launchctl kill SIGTERM system/${label}`, { timeout: 15_000 });
          if (result.success) {
            lastError = undefined;
            break;
          }
          lastError = new Error(result.error || `Failed to stop ${label}`);
        }
        if (lastError) throw lastError;

        // Also stop gateway for OpenClaw targets
        const presetId = (profile as { presetId?: string })?.presetId;
        if (presetId === 'openclaw') {
          const processManager = app.processManager;

          if (processManager) {
            // Use ProcessManager for direct gateway lifecycle management
            try {
              await processManager.stop(targetId);
            } catch (gwErr) {
              request.log.warn({ err: gwErr }, 'Gateway stop via ProcessManager failed');
            }
          }

          // Also try launchctl as fallback (for pre-existing plist-managed gateways)
          const gwLabel = `com.agenshield.${stopBaseName}.gateway`;
          await executor.execAsRoot(
            `launchctl disable system/${gwLabel} 2>/dev/null; true\nlaunchctl kill SIGTERM system/${gwLabel}`,
            { timeout: 15_000 },
          ).catch((gwErr) => {
            request.log.debug({ err: gwErr }, `Gateway launchctl stop for ${gwLabel} failed (best-effort)`);
          });

          // Final safety net: pkill user gateway processes
          const agentUsername = profile?.agentUsername;
          if (agentUsername) {
            await executor.execAsRoot(
              `pkill -TERM -u ${agentUsername} -f 'openclaw.*gateway' 2>/dev/null || true`,
              { timeout: 5_000 },
            ).catch(() => { /* best-effort */ });

            // Delayed SIGKILL for anything that survived SIGTERM
            setTimeout(async () => {
              try {
                await executor.execAsRoot(
                  `pkill -KILL -u ${agentUsername} -f 'openclaw.*gateway' 2>/dev/null || true`,
                  { timeout: 5_000 },
                );
              } catch {
                // best-effort
              }
            }, 3_000);
          }
        }

        emitEvent('process:stopped', { process: targetId, action: 'stop' }, profile?.id);
        triggerTargetCheck();
        return { success: true, data: { targetId, stopped: true } };
      } catch (err) {
        return reply.code(500).send({
          success: false,
          error: { code: 'STOP_ERROR', message: (err as Error).message },
        });
      }
    },
  );

  // ── Dismissed targets ──────────────────────────────────────────

  /**
   * GET /targets/lifecycle/dismissed — List dismissed target IDs.
   */
  app.get('/targets/lifecycle/dismissed', async (): Promise<ApiResponse<string[]>> => {
    try {
      const storage = getStorage();
      return { success: true, data: storage.getDismissedTargets() };
    } catch (err) {
      return { success: false, error: { code: 'DISMISSED_LIST_ERROR', message: (err as Error).message } };
    }
  });

  /**
   * POST /targets/lifecycle/dismissed — Dismiss a target.
   */
  app.post<{ Body: { targetId: string } }>(
    '/targets/lifecycle/dismissed',
    async (request): Promise<ApiResponse<{ targetId: string }>> => {
      try {
        const { targetId } = (request.body ?? {}) as { targetId: string };
        if (!targetId) {
          return { success: false, error: { code: 'INVALID_INPUT', message: 'targetId is required' } };
        }
        const storage = getStorage();
        storage.dismissTarget(targetId);
        return { success: true, data: { targetId } };
      } catch (err) {
        return { success: false, error: { code: 'DISMISS_ERROR', message: (err as Error).message } };
      }
    },
  );

  /**
   * DELETE /targets/lifecycle/dismissed/:targetId — Restore a dismissed target.
   */
  app.delete<{ Params: { targetId: string } }>(
    '/targets/lifecycle/dismissed/:targetId',
    async (request): Promise<ApiResponse<{ targetId: string }>> => {
      try {
        const { targetId } = request.params;
        const storage = getStorage();
        storage.restoreTarget(targetId);
        return { success: true, data: { targetId } };
      } catch (err) {
        return { success: false, error: { code: 'RESTORE_ERROR', message: (err as Error).message } };
      }
    },
  );

  // ── Post-upgrade regeneration ──────────────────────────────────

  /**
   * POST /system/post-upgrade — Reapply on-disk artifacts after a binary upgrade.
   *
   * Regenerates guarded-shell, ZDOTDIR files, and router wrappers for every
   * active target profile so that script-level fixes ship with the new binary.
   */
  app.post('/system/post-upgrade', async (): Promise<ApiResponse<{
    profiles: Array<{ id: string; name: string; status: string }>;
    routerWrappers: string[];
  }>> => {
    const executor = app.privilegeExecutor;
    if (!executor) {
      return {
        success: false,
        error: { code: 'NO_EXECUTOR', message: 'Privilege executor not available. Restart the daemon.' },
      };
    }

    const profileResults: Array<{ id: string; name: string; status: string }> = [];
    const routerWrapperResults: string[] = [];

    try {
      const storage = getStorage();
      const allProfiles = storage.profiles.getAll() as import('@agenshield/ipc').Profile[];
      const targetProfiles = allProfiles.filter(
        (p) => p.type === 'target' && p.agentHomeDir && p.presetId,
      );

      const {
        guardedShellPath,
        GUARDED_SHELL_CONTENT,
        zdotDir,
        zdotZshenvContent,
        zdotZshrcContent,
        getPreset,
        scanForRouterWrappers,
        generateRouterWrapper,
        buildInstallRouterCommands,
        buildInstallUserLocalRouterCommands,
      } = await import('@agenshield/sandbox');

      // Resolve host username (daemon may run as root / LaunchDaemon)
      let hostUsername = '';
      try {
        const { execSync } = await import('node:child_process');
        hostUsername = execSync('stat -f "%Su" /dev/console', { encoding: 'utf-8', timeout: 3_000 }).trim();
      } catch {
        hostUsername = process.env['SUDO_USER'] || process.env['USER'] || process.env['LOGNAME'] || '';
      }
      const hostHome = hostUsername ? `/Users/${hostUsername}` : (process.env['HOME'] || '');

      // 1. Regenerate guarded-shell + ZDOTDIR for each target profile
      for (const profile of targetProfiles) {
        const agentHome = profile.agentHomeDir!;
        const presetId = profile.presetId!;
        const preset = getPreset(presetId);
        const shellFeatures = preset?.shellFeatures ?? {};

        try {
          // Guarded shell
          const shellPath = guardedShellPath(agentHome);
          await executor.execAsRoot(
            `cat > "${shellPath}" << 'GSHELL_EOF'\n${GUARDED_SHELL_CONTENT}\nGSHELL_EOF`,
            { timeout: 15_000 },
          );
          await executor.execAsRoot([
            `chown root:wheel "${shellPath}"`,
            `chmod 755 "${shellPath}"`,
          ].join(' && '), { timeout: 15_000 });

          // ZDOTDIR .zshenv and .zshrc
          const targetZdotDir = zdotDir(agentHome);
          await executor.execAsRoot(`mkdir -p "${targetZdotDir}"`, { timeout: 10_000 });
          await executor.execAsRoot(
            `cat > "${targetZdotDir}/.zshenv" << 'ZSHENV_EOF'\n${zdotZshenvContent(agentHome, shellFeatures)}\nZSHENV_EOF`,
            { timeout: 15_000 },
          );
          await executor.execAsRoot(
            `cat > "${targetZdotDir}/.zshrc" << 'ZSHRC_EOF'\n${zdotZshrcContent(shellFeatures)}\nZSHRC_EOF`,
            { timeout: 15_000 },
          );
          await executor.execAsRoot([
            `chown -R root:wheel "${targetZdotDir}"`,
            `chmod 644 "${targetZdotDir}/.zshenv" "${targetZdotDir}/.zshrc"`,
          ].join(' && '), { timeout: 15_000 });

          profileResults.push({ id: profile.id, name: profile.name, status: 'ok' });
        } catch (err) {
          profileResults.push({ id: profile.id, name: profile.name, status: `error: ${(err as Error).message}` });
        }
      }

      // 2. Regenerate router wrappers (system-wide + user-local)
      try {
        const existingRouterBins = scanForRouterWrappers();
        for (const binName of existingRouterBins) {
          try {
            const wrapperContent = generateRouterWrapper(binName);
            const installCmd = buildInstallRouterCommands(binName, wrapperContent);
            await executor.execAsRoot(installCmd, { timeout: 15_000 });

            if (hostHome) {
              const userLocalCmd = buildInstallUserLocalRouterCommands(binName, wrapperContent, hostHome);
              await executor.execAsRoot(userLocalCmd, { timeout: 15_000 });
              await executor.execAsRoot(
                `chown -R ${hostUsername}:staff "${hostHome}/.agenshield/bin"`,
                { timeout: 10_000 },
              );
            }

            routerWrapperResults.push(binName);
          } catch {
            // Best-effort per wrapper
          }
        }
      } catch {
        // scanForRouterWrappers failed — skip router regeneration
      }

      return {
        success: true,
        data: { profiles: profileResults, routerWrappers: routerWrapperResults },
      };
    } catch (err) {
      return {
        success: false,
        error: { code: 'POST_UPGRADE_ERROR', message: (err as Error).message },
      };
    }
  });
}
