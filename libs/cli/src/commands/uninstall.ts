/**
 * Uninstall command
 *
 * Reverses the AgenShield installation using profile-based cleanup.
 * Reads profiles from storage to perform manifest-driven rollback,
 * falling back to discovery-based cleanup when storage is unavailable.
 */

import { Option } from 'clipanion';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { execSync } from 'node:child_process';
import { BaseCommand } from './base.js';
import { ensureSudoAccess } from '../utils/privileges.js';
import { stopDaemon } from '../utils/daemon.js';
import { output } from '../utils/output.js';
import { createSpinner } from '../utils/spinner.js';
import { CliError } from '../errors.js';

/**
 * Resolve the data directory (~/.agenshield) for the calling user.
 * When running under sudo, SUDO_USER points to the real user.
 */
function resolveDataDir(): string {
  const sudoUser = process.env['SUDO_USER'];
  if (sudoUser) {
    try {
      const home = execSync(`eval echo ~${sudoUser}`, { encoding: 'utf-8' }).trim();
      return path.join(home, '.agenshield');
    } catch {
      // fall through
    }
  }
  return path.join(os.homedir(), '.agenshield');
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
  const sudoUser = process.env['SUDO_USER'];
  if (sudoUser) {
    return { hostHome: `/Users/${sudoUser}`, hostUsername: sudoUser };
  }
  try {
    const consoleUser = execSync('stat -f "%Su" /dev/console', { encoding: 'utf-8', timeout: 3_000 }).trim();
    return { hostHome: `/Users/${consoleUser}`, hostUsername: consoleUser };
  } catch {
    return { hostHome: process.env['HOME'] || '', hostUsername: process.env['USER'] || '' };
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
    installManifest?: { entries: Array<{ stepId: string; status: string; changed: boolean; outputs: Record<string, string> }> };
  },
  storage: { for(scope: { profileId: string }): { policies: { deleteAll(): void } }; profiles: { delete(id: string): void } },
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
      const { removePathOverrideFromShellRc } = await import('../utils/home.js');
      const hostShell = process.env['SHELL'] || '';
      const { removed, rcFile } = removePathOverrideFromShellRc(hostHome, hostShell);
      if (removed) {
        output.success(`Removed PATH override from ${rcFile}`);
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

  const cleanupPaths = [
    '/etc/agenshield',
    '/opt/agenshield',
    '/Applications/AgenShieldES.app',
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
      output.success(`Deleted ${dataDir}`);
    } catch {
      output.warn(`Could not fully remove ${dataDir}`);
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

  storage.close();
  await systemCleanup(dataDir);

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

  const dataDir = resolveDataDir();
  if (fs.existsSync(dataDir)) {
    try {
      execSync(`sudo rm -rf "${dataDir}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      output.success(`cleanup: Deleted ${dataDir} (databases, vault, logs)`);
    } catch {
      output.warn(`cleanup: Could not fully remove ${dataDir} (may contain root-owned files)`);
    }
  }

  output.info('');

  if (result.success) {
    output.success('Force uninstall complete!');
    output.info('AgenShield artifacts have been removed.');
  } else {
    throw new CliError(result.error || 'Force uninstall failed', 'UNINSTALL_FAILED');
  }
}

export class UninstallCommand extends BaseCommand {
  static override paths = [['uninstall']];

  static override usage = BaseCommand.Usage({
    category: 'Setup & Maintenance',
    description: 'Reverse isolation and restore targets',
    examples: [
      ['Interactive uninstall', '$0 uninstall'],
      ['Skip confirmation', '$0 uninstall --force'],
      ['Dry run', '$0 uninstall --dry-run'],
    ],
  });

  force = Option.Boolean('-f,--force', false, { description: 'Skip confirmation prompt' });
  prefix = Option.String('--prefix', { description: 'Uninstall a specific prefixed installation' });
  skipBackup = Option.Boolean('--skip-backup', false, { description: 'Force discovery-based cleanup (bypass profile-based uninstall)' });
  dryRun = Option.Boolean('--dry-run', false, { description: 'Show what would be done without making changes' });

  async run(): Promise<number | void> {
    await runUninstall({
      force: this.force,
      prefix: this.prefix,
      skipBackup: this.skipBackup,
      dryRun: this.dryRun,
    });
  }
}
