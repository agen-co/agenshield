/**
 * Uninstall command
 *
 * Reverses the AgenShield installation using profile-based cleanup.
 * Reads profiles from storage to perform manifest-driven rollback,
 * falling back to discovery-based cleanup when storage is unavailable.
 */

import type { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { execSync } from 'node:child_process';
import { withGlobals } from './base.js';
import { ensureSudoAccess } from '../utils/privileges.js';
import { stopDaemon } from '../utils/daemon.js';
import { output } from '../utils/output.js';
import { createSpinner } from '../utils/spinner.js';
import { CliError } from '../errors.js';
import { inkMultiSelect } from '../prompts/index.js';
import { resolveHostUser, resolveHostHome } from '../utils/host-user.js';

/**
 * Resolve the data directory (~/.agenshield) for the calling user.
 * When running under sudo or as root, detects the real human user.
 */
function resolveDataDir(): string {
  return path.join(resolveHostHome(), '.agenshield');
}

/**
 * Try to open storage and read profiles.
 * Returns null if storage is unavailable or DB doesn't exist.
 */
async function tryOpenStorage(dataDir: string) {
  const { Storage, DB_FILENAME, ACTIVITY_DB_FILENAME } = await import('@agenshield/storage');

  const dbPath = path.join(dataDir, DB_FILENAME);
  const activityDbPath = path.join(dataDir, ACTIVITY_DB_FILENAME);

  if (!fs.existsSync(dbPath)) {
    return null;
  }

  try {
    return Storage.open(dbPath, activityDbPath);
  } catch {
    return null;
  }
}

/**
 * Create an execAsRoot wrapper for CLI context.
 */
function makeExecAsRoot() {
  return async (cmd: string, opts?: { timeout?: number }): Promise<{ success: boolean; output: string; error?: string }> => {
    try {
      const cmdOutput = execSync(`sudo ${cmd}`, {
        encoding: 'utf-8',
        timeout: opts?.timeout ?? 30_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return { success: true, output: cmdOutput };
    } catch (err) {
      const message = (err as Error).message;
      return { success: false, output: '', error: message };
    }
  };
}

/**
 * Resolve the host user's home directory and username.
 */
function resolveHostInfo(): { hostHome: string; hostUsername: string } {
  const { username, home } = resolveHostUser();
  return { hostHome: home, hostUsername: username };
}

/**
 * Kill all processes and unload all LaunchDaemons for a profile.
 * Must run BEFORE manifest-driven rollback to prevent respawning
 * and ensure file handles are released before directory cleanup.
 */
async function killAllProfileProcesses(
  execAsRoot: (cmd: string, opts?: { timeout?: number }) => Promise<{ success: boolean; output: string; error?: string }>,
  manifest: { entries: Array<{ stepId: string; status: string; changed: boolean; outputs: Record<string, string> }> },
  agentUsername: string | undefined,
  brokerUsername: string | undefined,
  profileBaseName: string,
): Promise<void> {
  // 1. Collect service labels from manifest entries + well-known patterns
  const labels = new Set<string>();

  for (const entry of manifest.entries) {
    if (entry.stepId === 'start_gateway' && entry.outputs['gatewayLabel']) {
      labels.add(entry.outputs['gatewayLabel']);
    }
    if (entry.stepId === 'write_gateway_plist' && entry.outputs['gatewayPlistPath']) {
      const label = entry.outputs['gatewayPlistPath'].replace('/Library/LaunchDaemons/', '').replace('.plist', '');
      if (label) labels.add(label);
    }
    if (entry.stepId === 'install_broker_daemon' && entry.outputs['brokerLabel']) {
      labels.add(entry.outputs['brokerLabel']);
    }
  }

  // Fallback well-known patterns
  labels.add(`com.agenshield.${profileBaseName}.gateway`);
  labels.add(`com.agenshield.broker.${profileBaseName}`);

  // 2. Unload all LaunchDaemons (prevents KeepAlive from respawning killed processes)
  for (const label of labels) {
    await execAsRoot(`launchctl bootout system/${label} 2>/dev/null; true`, { timeout: 15_000 });
  }

  // 3. Resolve UIDs early (before any user records get deleted)
  const usernames = [agentUsername, brokerUsername].filter(Boolean) as string[];

  // 4. Force-kill all processes owned by these users: SIGTERM → wait → SIGKILL → verify
  for (const username of usernames) {
    // Check if user exists before attempting pkill
    const uidCheck = await execAsRoot(`id -u ${username} 2>/dev/null`, { timeout: 5_000 });
    if (!uidCheck.success) continue;

    // SIGTERM first (graceful)
    await execAsRoot(`pkill -u ${username} 2>/dev/null; true`, { timeout: 5_000 });
    // Brief grace period
    await execAsRoot(`sleep 1`, { timeout: 5_000 });
    // SIGKILL (force)
    await execAsRoot(`pkill -9 -u ${username} 2>/dev/null; true`, { timeout: 5_000 });
    // Wait for processes to exit
    await execAsRoot(`sleep 2`, { timeout: 5_000 });

    // Verify no processes remain
    const psCheck = await execAsRoot(`ps -u ${username} -o pid= 2>/dev/null`, { timeout: 5_000 });
    if (psCheck.success && psCheck.output.trim()) {
      // One more SIGKILL attempt
      await execAsRoot(`pkill -9 -u ${username} 2>/dev/null; true`, { timeout: 5_000 });
      await execAsRoot(`sleep 1`, { timeout: 5_000 });
    }
  }
}

/**
 * Remove all ACL entries for a user from a single path.
 * Best-effort: failures are logged but never thrown.
 */
function removeUserAclFromPath(targetPath: string, userName: string): void {
  try {
    if (!fs.existsSync(targetPath)) return;

    const lsOutput = execSync(`ls -led "${targetPath}" 2>/dev/null || true`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const indices: number[] = [];
    for (const line of lsOutput.split('\n')) {
      const match = line.match(/^\s*(\d+):\s+user:(\S+)\s+/);
      if (match && match[2] === userName) {
        indices.push(Number(match[1]));
      }
    }

    // Remove highest index first so lower indices stay valid
    indices.sort((a, b) => b - a);
    for (const idx of indices) {
      try {
        execSync(`chmod -a# ${idx} "${targetPath}"`, { stdio: 'pipe' });
      } catch {
        try { execSync(`sudo chmod -a# ${idx} "${targetPath}"`, { stdio: 'pipe' }); } catch { /* best-effort */ }
      }
    }
  } catch {
    // Best-effort
  }
}

/**
 * Remove orphaned (bare-UUID) ACL entries from a single path.
 * Best-effort: failures are silently ignored.
 */
function removeOrphanedAclsFromPath(targetPath: string): void {
  try {
    if (!fs.existsSync(targetPath)) return;

    const lsOutput = execSync(`ls -led "${targetPath}" 2>/dev/null || true`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const UUID_RE = /^\s*(\d+):\s+[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\s+(?:allow|deny)\s+/;
    const indices: number[] = [];
    for (const line of lsOutput.split('\n')) {
      const match = line.match(UUID_RE);
      if (match) {
        indices.push(Number(match[1]));
      }
    }

    indices.sort((a, b) => b - a);
    for (const idx of indices) {
      try {
        execSync(`chmod -a# ${idx} "${targetPath}"`, { stdio: 'pipe' });
      } catch {
        try { execSync(`sudo chmod -a# ${idx} "${targetPath}"`, { stdio: 'pipe' }); } catch { /* best-effort */ }
      }
    }
  } catch {
    // Best-effort
  }
}

const WORLD_TRAVERSABLE_PATHS = new Set([
  '/', '/Users', '/tmp', '/private', '/private/tmp', '/private/var',
  '/var', '/opt', '/usr', '/usr/local', '/Applications', '/Library',
  '/System', '/Volumes',
]);

/**
 * Remove ACLs for a user from workspace paths and their traversal ancestors.
 * Must be called before deleting the macOS user.
 */
function cleanupProfileAcls(userName: string, workspacePaths: string[]): void {
  const cleaned = new Set<string>();

  for (const ws of workspacePaths) {
    if (!cleaned.has(ws)) {
      removeOrphanedAclsFromPath(ws);
      removeUserAclFromPath(ws, userName);
      cleaned.add(ws);
    }
    // Walk up ancestors that need traversal ACLs
    let dir = path.dirname(ws);
    let prev = ws;
    while (dir !== prev && dir !== '/') {
      if (!WORLD_TRAVERSABLE_PATHS.has(dir) && !cleaned.has(dir)) {
        removeOrphanedAclsFromPath(dir);
        removeUserAclFromPath(dir, userName);
        cleaned.add(dir);
      }
      prev = dir;
      dir = path.dirname(dir);
    }
  }
}

/**
 * Unshield a single profile using manifest-driven rollback.
 */
async function unshieldProfile(
  profile: {
    id: string;
    agentUsername?: string;
    brokerUsername?: string;
    agentHomeDir?: string;
    presetId?: string;
    workspacePaths?: string[];
    installManifest?: { entries: Array<{ stepId: string; status: string; changed: boolean; outputs: Record<string, string> }> };
  },
  storage: { for(scope: { profileId: string }): { policies: { deleteAll(): void; getAll(): Array<{ enabled?: boolean; target: string; action: string; operations?: string[]; patterns: string[] }> } }; profiles: { delete(id: string): void } },
): Promise<void> {
  const agentUsername = profile.agentUsername;
  const agentHomeDir = profile.agentHomeDir;
  const profileBaseName = agentUsername?.replace(/^ash_/, '').replace(/_agent$/, '') ?? profile.id;

  if (profile.installManifest) {
    output.info('  Using manifest-driven rollback...');

    const { getRollbackHandler, ROLLBACK_HANDLERS_REGISTERED } = await import('@agenshield/sandbox');
    void ROLLBACK_HANDLERS_REGISTERED;

    const { hostHome, hostUsername } = resolveHostInfo();

    const rollbackCtx = {
      execAsRoot: makeExecAsRoot(),
      onLog: (message: string) => output.info(`    ${message}`),
      agentHome: agentHomeDir || '',
      agentUsername: agentUsername || '',
      profileBaseName,
      hostHome,
      hostUsername,
    };

    // Pre-rollback: kill all processes and unload services BEFORE any rollback steps
    output.info('  Stopping all services and processes...');
    await killAllProfileProcesses(
      rollbackCtx.execAsRoot,
      profile.installManifest,
      agentUsername,
      profile.brokerUsername,
      profileBaseName,
    );
    output.success('  All profile processes stopped');

    const entries = profile.installManifest.entries
      .filter(e => e.status === 'completed' && e.changed)
      .reverse();

    for (const entry of entries) {
      const handler = getRollbackHandler(entry.stepId);
      if (handler) {
        try {
          await handler(rollbackCtx, entry as Parameters<typeof handler>[1]);
          output.success(`rollback: ${entry.stepId}`);
        } catch (err) {
          output.warn(`rollback: ${entry.stepId} \u2014 ${(err as Error).message}`);
        }
      } else {
        output.info(`  ${output.dim('-')} rollback: ${entry.stepId} (no handler)`);
      }
    }

    // Clean up filesystem ACLs before user deletion
    if (agentUsername) {
      output.info('  Cleaning up filesystem ACLs...');
      cleanupProfileAcls(agentUsername, profile.workspacePaths ?? []);
      output.success('Cleaned up filesystem ACLs');
    }

    // Post-rollback verification
    const execAsRoot = makeExecAsRoot();

    for (const username of [agentUsername, profile.brokerUsername].filter(Boolean) as string[]) {
      const check = await execAsRoot(`id -u ${username} 2>/dev/null`, { timeout: 5_000 });
      if (check.success) {
        output.warn(`User ${username} still exists \u2014 retrying cleanup...`);
        await execAsRoot(`pkill -9 -u ${username} 2>/dev/null; true`, { timeout: 5_000 });
        await execAsRoot(`sleep 1`, { timeout: 5_000 });
        const retry = await execAsRoot(`dscl . -delete /Users/${username}`, { timeout: 15_000 });
        const verify = await execAsRoot(`id -u ${username} 2>/dev/null`, { timeout: 5_000 });
        if (verify.success) {
          output.error(`Could not delete user ${username}: ${retry.error ?? 'unknown error'}`);
        } else {
          output.success(`User ${username} removed on retry`);
        }
      }
    }

    // Post-rollback: verify home directory was deleted, retry if needed
    if (agentHomeDir) {
      try {
        if (fs.existsSync(agentHomeDir)) {
          output.warn(`Home directory ${agentHomeDir} still exists — retrying cleanup...`);
          const retryRm = await execAsRoot(`rm -rf "${agentHomeDir}"`, { timeout: 60_000 });
          if (fs.existsSync(agentHomeDir)) {
            output.error(`Could not delete ${agentHomeDir}: ${retryRm.error ?? 'unknown error'}`);
          } else {
            output.success(`Home directory ${agentHomeDir} removed on retry`);
          }
        }
      } catch {
        // Best-effort
      }
    }

    const socketGroupName = `ash_${profileBaseName}`;
    const groupCheck = await execAsRoot(`dscl . -read /Groups/${socketGroupName} 2>/dev/null`, { timeout: 5_000 });
    if (groupCheck.success) {
      output.warn(`Group ${socketGroupName} still exists \u2014 retrying cleanup...`);
      const retry = await execAsRoot(`dscl . -delete /Groups/${socketGroupName}`, { timeout: 10_000 });
      const verify = await execAsRoot(`dscl . -read /Groups/${socketGroupName} 2>/dev/null`, { timeout: 5_000 });
      if (verify.success) {
        output.error(`Could not delete group ${socketGroupName}: ${retry.error ?? 'unknown error'}`);
      } else {
        output.success(`Group ${socketGroupName} removed on retry`);
      }
    }
  } else {
    output.info('  No install manifest \u2014 using legacy cleanup...');
    const execAsRoot = makeExecAsRoot();

    if (agentUsername) {
      await execAsRoot(
        `ps -u $(id -u ${agentUsername} 2>/dev/null) -o pid= 2>/dev/null | xargs kill 2>/dev/null; sleep 1; ps -u $(id -u ${agentUsername} 2>/dev/null) -o pid= 2>/dev/null | xargs kill -9 2>/dev/null; true`,
        { timeout: 15_000 },
      );
      output.success(`Stopped processes for ${agentUsername}`);
    }

    const plistLabels = [
      `com.agenshield.broker.${profileBaseName}`,
      `com.agenshield.${profileBaseName}.gateway`,
    ];
    for (const label of plistLabels) {
      await execAsRoot(
        `launchctl bootout system/${label} 2>/dev/null; rm -f "/Library/LaunchDaemons/${label}.plist" 2>/dev/null; true`,
        { timeout: 15_000 },
      );
    }
    output.success('Removed LaunchDaemons');

    await execAsRoot(`rm -f "/etc/sudoers.d/agenshield-${profileBaseName}" 2>/dev/null; true`, { timeout: 5_000 });
    output.success('Removed sudoers rules');

    if (agentHomeDir) {
      await execAsRoot(`sed -i '' '\\|${agentHomeDir}/.agenshield/bin/guarded-shell|d' /etc/shells 2>/dev/null; true`, { timeout: 5_000 });
    }
    output.success('Removed guarded shell entries');

    if (agentHomeDir) {
      await execAsRoot(`rm -rf "${agentHomeDir}"`, { timeout: 60_000 });
      output.success(`Deleted ${agentHomeDir}`);
    }

    // Clean up filesystem ACLs before user deletion
    if (agentUsername) {
      cleanupProfileAcls(agentUsername, profile.workspacePaths ?? []);
      output.success('Cleaned up filesystem ACLs');
    }

    if (agentUsername) {
      await execAsRoot(`dscl . -delete /Users/${agentUsername} 2>/dev/null; true`, { timeout: 15_000 });
    }
    if (profile.brokerUsername) {
      await execAsRoot(`dscl . -delete /Users/${profile.brokerUsername} 2>/dev/null; true`, { timeout: 15_000 });
    }
    output.success('Deleted sandbox users');

    const socketGroupName = `ash_${profileBaseName}`;
    await execAsRoot(`dscl . -delete /Groups/${socketGroupName} 2>/dev/null; true`, { timeout: 15_000 });
    output.success('Deleted socket group');
  }

  try {
    const scopedStorage = storage.for({ profileId: profile.id });
    scopedStorage.policies.deleteAll();
  } catch {
    // Best-effort
  }

  storage.profiles.delete(profile.id);
  output.success('Removed profile from storage');
}

/**
 * Run system-level cleanup (guarded shell, router wrappers, dirs).
 */
async function systemCleanup(dataDir: string): Promise<void> {
  output.info('\nSystem cleanup...');

  const execAsRoot = makeExecAsRoot();

  await execAsRoot(`sed -i '' '\\|/usr/local/bin/guarded-shell|d' /etc/shells 2>/dev/null; true`);
  await execAsRoot(`sed -i '' '\\|/.agenshield/bin/guarded-shell|d' /etc/shells 2>/dev/null; true`);
  output.success('Cleaned /etc/shells');

  if (fs.existsSync('/usr/local/bin/guarded-shell')) {
    await execAsRoot('rm -f /usr/local/bin/guarded-shell');
  }

  try {
    const { scanForRouterWrappers, pathRegistryPath, ROUTER_MARKER } = await import('@agenshield/sandbox');
    const { hostHome } = resolveHostInfo();
    const wrappers = scanForRouterWrappers();
    for (const binName of wrappers) {
      const targetPath = `/usr/local/bin/${binName}`;
      const backupPath = `/usr/local/bin/.${binName}.agenshield-backup`;
      if (fs.existsSync(backupPath)) {
        await execAsRoot(`mv "${backupPath}" "${targetPath}"`);
      } else {
        await execAsRoot(`rm -f "${targetPath}"`);
      }
    }
    if (wrappers.length > 0) {
      output.success(`Removed ${wrappers.length} PATH router wrapper(s)`);
    }

    const userLocalBinDir = path.join(hostHome, '.agenshield', 'bin');
    try {
      if (fs.existsSync(userLocalBinDir)) {
        let removedCount = 0;
        for (const file of fs.readdirSync(userLocalBinDir)) {
          if (file === 'agenshield') continue;
          const fullPath = path.join(userLocalBinDir, file);
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            if (content.includes(ROUTER_MARKER)) {
              await execAsRoot(`rm -f "${fullPath}"`);
              removedCount++;
            }
          } catch { /* skip unreadable files */ }
        }
        if (removedCount > 0) {
          output.success(`Removed ${removedCount} user-local router wrapper(s)`);
        }
      }
    } catch {
      // Best effort
    }

    const registryPath = pathRegistryPath(hostHome);
    if (fs.existsSync(registryPath)) {
      await execAsRoot(`rm -f "${registryPath}"`);
    }

    try {
      const { removePathOverrideFromShellRc, removeCliPathFromShellRc } = await import('../utils/home.js');
      const hostShell = process.env['SHELL'] || '';
      const { removed, rcFile } = removePathOverrideFromShellRc(hostHome, hostShell);
      if (removed) {
        output.success(`Removed PATH override from ${rcFile}`);
      }
      const cli = removeCliPathFromShellRc(hostHome, hostShell);
      if (cli.removed) {
        output.success(`Removed CLI PATH entry from ${cli.rcFile}`);
      }
    } catch {
      // Best effort
    }
  } catch {
    // Best effort
  }

  const plistDir = '/Library/LaunchDaemons';
  try {
    if (fs.existsSync(plistDir)) {
      for (const file of fs.readdirSync(plistDir)) {
        if (file.startsWith('com.agenshield.') && file.endsWith('.plist')) {
          const label = file.replace('.plist', '');
          await execAsRoot(`launchctl bootout system/${label} 2>/dev/null; true`);
          await execAsRoot(`rm -f "${path.join(plistDir, file)}"`);
        }
      }
    }
  } catch {
    // Best effort
  }

  // Remove menu bar LaunchAgent and app (user-level, no sudo needed)
  try {
    const { uninstallMenuBarAgent } = await import('@agenshield/seatbelt');
    await uninstallMenuBarAgent();
  } catch { /* best effort */ }

  const cleanupPaths = [
    '/etc/agenshield',
    '/opt/agenshield',
    '/Applications/AgenShield.app',
  ];
  for (const p of cleanupPaths) {
    if (fs.existsSync(p)) {
      await execAsRoot(`rm -rf "${p}"`);
    }
  }
  output.success('Cleaned legacy directories');

  try {
    const sudoersDir = '/etc/sudoers.d';
    if (fs.existsSync(sudoersDir)) {
      for (const file of fs.readdirSync(sudoersDir)) {
        if (file.startsWith('agenshield-')) {
          await execAsRoot(`rm -f "${path.join(sudoersDir, file)}"`);
        }
      }
    }
  } catch {
    // Best effort
  }

  if (fs.existsSync(dataDir)) {
    try {
      execSync(`sudo rm -rf "${dataDir}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { /* handled below */ }

    // Verify removal — if directory persists, try chown + rm as current user
    if (fs.existsSync(dataDir)) {
      try {
        execSync(`sudo chown -R $(whoami) "${dataDir}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch { /* handled below */ }
    }

    if (fs.existsSync(dataDir)) {
      output.warn(`Could not fully remove ${dataDir} — remove manually with: sudo rm -rf "${dataDir}"`);
    } else {
      output.success(`Deleted ${dataDir} (databases, vault, logs)`);
    }
  }
}

/**
 * Run the uninstall process
 */
async function runUninstall(options: { force?: boolean; prefix?: string; skipBackup?: boolean; dryRun?: boolean }): Promise<void> {
  if (options.dryRun) {
    output.info('[dry-run] Would perform uninstall. No changes made.');
    return;
  }

  ensureSudoAccess();

  if (options.skipBackup) {
    await runForceUninstall(options);
    return;
  }

  const dataDir = resolveDataDir();
  const storage = await tryOpenStorage(dataDir);

  if (!storage) {
    output.warn('Storage not available \u2014 falling back to discovery-based cleanup.\n');
    await runForceUninstall(options);
    return;
  }

  let profiles;
  try {
    profiles = storage.profiles.getAll().filter(p => p.type === 'target');
  } catch {
    output.warn('Could not read profiles \u2014 falling back to discovery-based cleanup.\n');
    storage.close();
    await runForceUninstall(options);
    return;
  }

  if (profiles.length === 0) {
    output.warn('No target profiles found \u2014 falling back to discovery-based cleanup.\n');
    storage.close();
    await runForceUninstall(options);
    return;
  }

  output.info(`${output.red('AgenShield Uninstall')}`);
  output.info('====================\n');
  output.info('This will unshield the following targets:\n');
  for (const p of profiles) {
    const target = p.targetName ?? p.name;
    const agent = p.agentUsername ?? '(unknown)';
    output.info(`  ${output.yellow('->')} ${target} (user: ${agent})`);
  }
  output.info('');
  output.info('And then:');
  output.info(`  ${output.yellow('->')} Stop and remove agenshield daemon`);
  output.info(`  ${output.yellow('->')} Remove guarded shell`);
  output.info(`  ${output.yellow('->')} Remove PATH router wrappers`);
  output.info(`  ${output.yellow('->')} Delete system configuration`);
  output.info(`  ${output.yellow('->')} Delete data directory`);
  output.info('');
  output.info(`${output.red('WARNING: This action cannot be undone!')}`);
  output.info('');

  if (!options.force) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('Type UNINSTALL to confirm: ', (ans) => {
        rl.close();
        resolve(ans);
      });
    });

    if (answer !== 'UNINSTALL') {
      output.info('\nUninstall cancelled.');
      storage.close();
      return;
    }
  }

  output.info('\nUninstalling...\n');

  const stopSpinner = await createSpinner('Stopping daemon...');
  let stopResult: { success: boolean; message: string } = { success: false, message: '' };
  for (let attempt = 1; attempt <= 3; attempt++) {
    stopResult = await stopDaemon();
    if (stopResult.success) break;
    if (attempt < 3) {
      stopSpinner.update(`Attempt ${attempt} failed, retrying...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (stopResult.success) {
    stopSpinner.succeed(`stop-daemon: ${stopResult.message}`);
  } else {
    stopSpinner.fail(`stop-daemon: ${stopResult.message}`);
  }
  output.info('');

  for (const profile of profiles) {
    const target = profile.targetName ?? profile.name;
    output.info(`Unshielding ${target}...`);
    try {
      await unshieldProfile(profile, storage);
      output.success(`${target} unshielded\n`);
    } catch (err) {
      output.error(`${target} unshield failed: ${(err as Error).message}\n`);
    }
  }

  // Collect entity names that were just unshielded so the orphan scan can skip them
  const unshieldedNames = new Set<string>();
  for (const profile of profiles) {
    if (profile.agentUsername) unshieldedNames.add(profile.agentUsername);
    if (profile.brokerUsername) unshieldedNames.add(profile.brokerUsername);
    const baseName = profile.agentUsername?.replace(/^ash_/, '').replace(/_agent$/, '') ?? profile.id;
    unshieldedNames.add(`ash_${baseName}`); // socket group
  }

  storage.close();

  // Remove daemon LaunchDaemon service (macOS)
  if (process.platform === 'darwin') {
    try {
      const { uninstallDaemonService } = await import('@agenshield/seatbelt');
      const result = await uninstallDaemonService();
      if (result.success) {
        output.success('Removed daemon LaunchDaemon service');
      }
    } catch {
      // Best effort — service may not be installed
    }
  }

  await systemCleanup(dataDir);

  // Orphan cleanup — best-effort, failure doesn't affect main uninstall
  try {
    await cleanupOrphanedEntities(options, unshieldedNames);
  } catch (err) {
    output.warn(`Orphan cleanup encountered an error: ${(err as Error).message}`);
  }

  output.info('');
  output.success('Uninstall complete!');
  output.info('All AgenShield targets have been unshielded and artifacts removed.');
}

/**
 * Run discovery-based force uninstall (no storage needed).
 */
async function runForceUninstall(options: { force?: boolean }): Promise<void> {
  const { forceUninstall } = await import('@agenshield/sandbox');

  output.info(`${output.yellow('Force Uninstall (Discovery-based)')}`);
  output.info('==================================\n');
  output.info('This will:');
  output.info(`  ${output.yellow('->')} Stop and remove agenshield daemon`);
  output.info(`  ${output.yellow('->')} Delete any discovered sandbox users (ash_*)`);
  output.info(`  ${output.yellow('->')} Delete any discovered workspace groups (ash_*)`);
  output.info(`  ${output.yellow('->')} Remove guarded shell`);
  output.info(`  ${output.yellow('->')} Delete /etc/agenshield configuration`);
  output.info(`  ${output.yellow('->')} Remove databases (main + activity), vault, backups`);
  output.info('');
  output.info(`${output.red('WARNING: This will NOT restore targets to their original state!')}`);
  output.info('');

  if (!options.force) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('Type FORCE to confirm: ', (ans) => {
        rl.close();
        resolve(ans);
      });
    });

    if (answer !== 'FORCE') {
      output.info('\nUninstall cancelled.');
      return;
    }
  }

  output.info('\nForce uninstalling...\n');

  const result = forceUninstall((progress: { success: boolean; step: string; message?: string; error?: string }) => {
    if (progress.success) {
      output.success(`${progress.step}: ${progress.message || progress.error || ''}`);
    } else {
      output.error(`${progress.step}: ${progress.message || progress.error || ''}`);
    }
  });

  // Remove menu bar LaunchAgent and app (user-level, no sudo needed)
  try {
    const { uninstallMenuBarAgent } = await import('@agenshield/seatbelt');
    await uninstallMenuBarAgent();
  } catch { /* best effort */ }

  const dataDir = resolveDataDir();
  if (fs.existsSync(dataDir)) {
    try {
      execSync(`sudo rm -rf "${dataDir}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { /* handled below */ }

    // Verify removal — if directory persists, try chown + rm as current user
    if (fs.existsSync(dataDir)) {
      try {
        execSync(`sudo chown -R $(whoami) "${dataDir}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch { /* handled below */ }
    }

    if (fs.existsSync(dataDir)) {
      output.warn(`cleanup: Could not fully remove ${dataDir} — remove manually with: sudo rm -rf "${dataDir}"`);
    } else {
      output.success(`cleanup: Deleted ${dataDir} (databases, vault, logs)`);
    }
  }

  output.info('');

  // Orphan cleanup — best-effort, failure doesn't affect main uninstall
  try {
    await cleanupOrphanedEntities(options);
  } catch (err) {
    output.warn(`Orphan cleanup encountered an error: ${(err as Error).message}`);
  }

  if (result.success) {
    output.success('Force uninstall complete!');
    output.info('AgenShield artifacts have been removed.');
  } else {
    throw new CliError(result.error || 'Force uninstall failed', 'UNINSTALL_FAILED');
  }
}

/**
 * Discover and clean up orphaned ash_* entities left behind by incomplete uninstalls.
 *
 * In interactive mode, presents a multi-select list so users choose which entities
 * to remove. In force mode (or non-TTY), auto-removes only verified entities
 * (those with `.agenshield/meta.json`).
 */
async function cleanupOrphanedEntities(
  options: { force?: boolean },
  exclude?: Set<string>,
): Promise<void> {
  const { discoverOrphanedEntities } = await import('@agenshield/sandbox');
  const allOrphans = discoverOrphanedEntities();
  const orphans = exclude ? allOrphans.filter(e => !exclude.has(e.name)) : allOrphans;

  if (orphans.length === 0) {
    return;
  }

  output.info('\nOrphaned ash_* entities detected:');
  output.info('');

  for (const entity of orphans) {
    const parts: string[] = [];
    if (entity.hasHomeDir) parts.push('home dir');
    if (entity.hasDsclUser) parts.push('dscl user');
    if (entity.hasDsclGroup) parts.push('dscl group');
    const status = entity.verified ? output.green('verified') : output.yellow('unverified');
    const date = entity.meta?.createdAt ? ` (created ${entity.meta.createdAt.slice(0, 10)})` : '';
    output.info(`  ${output.yellow('->')} ${entity.name} [${status}] — ${parts.join(', ')}${date}`);
  }
  output.info('');

  let selected: string[];

  const isInteractive = !options.force && process.stdin.isTTY && process.stderr.isTTY;

  if (isInteractive) {
    const selectOptions = orphans.map((e) => {
      const parts: string[] = [];
      if (e.hasHomeDir) parts.push(`home: /Users/${e.name}`);
      if (e.hasDsclUser) parts.push('dscl user');
      if (e.hasDsclGroup) parts.push('dscl group');
      const date = e.meta?.createdAt ? `, created ${e.meta.createdAt.slice(0, 10)}` : '';
      const tag = e.verified ? 'verified' : 'unverified — may not be AgenShield';
      return {
        label: `${e.name} (${tag})`,
        value: e.name,
        description: `${parts.join(', ')}${date}`,
      };
    });

    selected = await inkMultiSelect(selectOptions, {
      title: 'Select entities to remove:',
    });
  } else {
    // Force / non-TTY: auto-select only verified entities
    selected = orphans.filter((e) => e.verified).map((e) => e.name);
    const skipped = orphans.filter((e) => !e.verified);
    if (skipped.length > 0) {
      output.warn(
        `Skipping ${skipped.length} unverified entit${skipped.length === 1 ? 'y' : 'ies'} (no .agenshield/meta.json): ${skipped.map((e) => e.name).join(', ')}`,
      );
    }
    if (selected.length > 0) {
      output.info(`Auto-removing ${selected.length} verified entit${selected.length === 1 ? 'y' : 'ies'}...`);
    }
  }

  if (selected.length === 0) {
    output.info('No orphaned entities selected for removal.');
    return;
  }

  const execAsRoot = makeExecAsRoot();
  const entityMap = new Map(orphans.map((e) => [e.name, e]));

  for (const name of selected) {
    const entity = entityMap.get(name);
    if (!entity) continue;

    output.info(`\nCleaning up ${name}...`);

    // Kill processes owned by this user (best-effort)
    if (entity.hasDsclUser) {
      try {
        await execAsRoot(`pkill -9 -u $(id -u ${name} 2>/dev/null) 2>/dev/null; true`, { timeout: 10_000 });
      } catch { /* best effort */ }
    }

    // Delete dscl user record
    if (entity.hasDsclUser) {
      const result = await execAsRoot(`dscl . -delete /Users/${name}`, { timeout: 15_000 });
      if (result.success) {
        output.success(`Deleted dscl user ${name}`);
      } else {
        output.warn(`Could not delete dscl user ${name}: ${result.error ?? 'unknown'}`);
      }
    }

    // Delete dscl group record
    if (entity.hasDsclGroup) {
      const result = await execAsRoot(`dscl . -delete /Groups/${name}`, { timeout: 15_000 });
      if (result.success) {
        output.success(`Deleted dscl group ${name}`);
      } else {
        output.warn(`Could not delete dscl group ${name}: ${result.error ?? 'unknown'}`);
      }
    }

    // Remove home directory
    if (entity.hasHomeDir) {
      const result = await execAsRoot(`rm -rf /Users/${name}`, { timeout: 60_000 });
      if (result.success) {
        output.success(`Deleted /Users/${name}`);
      } else {
        output.warn(`Could not delete /Users/${name}: ${result.error ?? 'unknown'}`);
      }
    }
  }

  output.info('');
  output.success(`Orphan cleanup complete (${selected.length} entit${selected.length === 1 ? 'y' : 'ies'} processed).`);
}

export function registerUninstallCommand(program: Command): void {
  program
    .command('uninstall')
    .description('Reverse isolation and restore targets')
    .option('-f, --force', 'Skip confirmation prompt', false)
    .option('--prefix <prefix>', 'Uninstall a specific prefixed installation')
    .option('--skip-backup', 'Force discovery-based cleanup (bypass profile-based uninstall)', false)
    .option('--dry-run', 'Show what would be done without making changes', false)
    .action(withGlobals(async (opts) => {
      await runUninstall({
        force: opts['force'] as boolean,
        prefix: opts['prefix'] as string | undefined,
        skipBackup: opts['skipBackup'] as boolean,
        dryRun: opts['dryRun'] as boolean,
      });
    }));
}
