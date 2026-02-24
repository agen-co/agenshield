/**
 * Uninstall command
 *
 * Reverses the AgenShield installation using profile-based cleanup.
 * Reads profiles from storage to perform manifest-driven rollback,
 * falling back to discovery-based cleanup when storage is unavailable.
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { execSync } from 'node:child_process';
import { ensureSudoAccess } from '../utils/privileges.js';
import { stopDaemon } from '../utils/daemon.js';

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
 * Since the CLI runs as root via ensureSudoAccess(), execSync is sufficient.
 */
function makeExecAsRoot() {
  return async (cmd: string, opts?: { timeout?: number }): Promise<{ success: boolean; output: string; error?: string }> => {
    try {
      const output = execSync(cmd, {
        encoding: 'utf-8',
        timeout: opts?.timeout ?? 30_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return { success: true, output };
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
    // ── Manifest-driven rollback ───────────────────────────────
    console.log('  Using manifest-driven rollback...');

    const { getRollbackHandler, ROLLBACK_HANDLERS_REGISTERED } = await import('@agenshield/sandbox');
    // Ensure side-effect import happened
    void ROLLBACK_HANDLERS_REGISTERED;

    const { hostHome, hostUsername } = resolveHostInfo();

    const rollbackCtx = {
      execAsRoot: makeExecAsRoot(),
      onLog: (message: string) => console.log(`    ${message}`),
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
          console.log(`  \x1b[32m✓\x1b[0m rollback: ${entry.stepId}`);
        } catch (err) {
          console.log(`  \x1b[33m!\x1b[0m rollback: ${entry.stepId} — ${(err as Error).message}`);
        }
      } else {
        console.log(`  \x1b[90m-\x1b[0m rollback: ${entry.stepId} (no handler)`);
      }
    }

    // ── Post-rollback verification ────────────────────────────
    // Safety net: verify users/groups were actually removed.
    const execAsRoot = makeExecAsRoot();

    for (const username of [agentUsername, profile.brokerUsername].filter(Boolean) as string[]) {
      const check = await execAsRoot(`id -u ${username} 2>/dev/null`, { timeout: 5_000 });
      if (check.success) {
        console.log(`  \x1b[33m!\x1b[0m User ${username} still exists — retrying cleanup...`);
        await execAsRoot(`pkill -9 -u ${username} 2>/dev/null; true`, { timeout: 5_000 });
        await execAsRoot(`sleep 1`, { timeout: 5_000 });
        const retry = await execAsRoot(`dscl . -delete /Users/${username}`, { timeout: 15_000 });
        const verify = await execAsRoot(`id -u ${username} 2>/dev/null`, { timeout: 5_000 });
        if (verify.success) {
          console.log(`  \x1b[31m✗\x1b[0m Could not delete user ${username}: ${retry.error ?? 'unknown error'}`);
        } else {
          console.log(`  \x1b[32m✓\x1b[0m User ${username} removed on retry`);
        }
      }
    }

    const socketGroupName = `ash_${profileBaseName}`;
    const groupCheck = await execAsRoot(`dscl . -read /Groups/${socketGroupName} 2>/dev/null`, { timeout: 5_000 });
    if (groupCheck.success) {
      console.log(`  \x1b[33m!\x1b[0m Group ${socketGroupName} still exists — retrying cleanup...`);
      const retry = await execAsRoot(`dscl . -delete /Groups/${socketGroupName}`, { timeout: 10_000 });
      const verify = await execAsRoot(`dscl . -read /Groups/${socketGroupName} 2>/dev/null`, { timeout: 5_000 });
      if (verify.success) {
        console.log(`  \x1b[31m✗\x1b[0m Could not delete group ${socketGroupName}: ${retry.error ?? 'unknown error'}`);
      } else {
        console.log(`  \x1b[32m✓\x1b[0m Group ${socketGroupName} removed on retry`);
      }
    }
  } else {
    // ── Legacy fallback — hardcoded unshield ───────────────────
    console.log('  No install manifest — using legacy cleanup...');
    const execAsRoot = makeExecAsRoot();

    // 1. Stop processes
    if (agentUsername) {
      await execAsRoot(
        `ps -u $(id -u ${agentUsername} 2>/dev/null) -o pid= 2>/dev/null | xargs kill 2>/dev/null; sleep 1; ps -u $(id -u ${agentUsername} 2>/dev/null) -o pid= 2>/dev/null | xargs kill -9 2>/dev/null; true`,
        { timeout: 15_000 },
      );
      console.log(`  \x1b[32m✓\x1b[0m Stopped processes for ${agentUsername}`);
    }

    // 2. Unload & remove LaunchDaemons
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
    console.log('  \x1b[32m✓\x1b[0m Removed LaunchDaemons');

    // 3. Remove sudoers rules
    await execAsRoot(`rm -f "/etc/sudoers.d/agenshield-${profileBaseName}" 2>/dev/null; true`, { timeout: 5_000 });
    console.log('  \x1b[32m✓\x1b[0m Removed sudoers rules');

    // 4. Remove guarded shell from /etc/shells
    if (agentHomeDir) {
      await execAsRoot(`sed -i '' '\\|${agentHomeDir}/.agenshield/bin/guarded-shell|d' /etc/shells 2>/dev/null; true`, { timeout: 5_000 });
    }
    console.log('  \x1b[32m✓\x1b[0m Removed guarded shell entries');

    // 5. Delete agent home directory
    if (agentHomeDir) {
      await execAsRoot(`rm -rf "${agentHomeDir}"`, { timeout: 60_000 });
      console.log(`  \x1b[32m✓\x1b[0m Deleted ${agentHomeDir}`);
    }

    // 6. Delete sandbox users
    if (agentUsername) {
      await execAsRoot(`dscl . -delete /Users/${agentUsername} 2>/dev/null; true`, { timeout: 15_000 });
    }
    if (profile.brokerUsername) {
      await execAsRoot(`dscl . -delete /Users/${profile.brokerUsername} 2>/dev/null; true`, { timeout: 15_000 });
    }
    console.log('  \x1b[32m✓\x1b[0m Deleted sandbox users');

    // 7. Delete socket group
    const socketGroupName = `ash_${profileBaseName}`;
    await execAsRoot(`dscl . -delete /Groups/${socketGroupName} 2>/dev/null; true`, { timeout: 15_000 });
    console.log('  \x1b[32m✓\x1b[0m Deleted socket group');
  }

  // Always delete policies + profile from storage
  try {
    const scopedStorage = storage.for({ profileId: profile.id });
    scopedStorage.policies.deleteAll();
  } catch {
    // Best-effort
  }

  storage.profiles.delete(profile.id);
  console.log('  \x1b[32m✓\x1b[0m Removed profile from storage');
}

/**
 * Run system-level cleanup (guarded shell, router wrappers, dirs).
 * Called after all profiles are unshielded.
 */
async function systemCleanup(dataDir: string): Promise<void> {
  console.log('\nSystem cleanup...');

  const execAsRoot = makeExecAsRoot();

  // Remove guarded shell entries from /etc/shells
  await execAsRoot(`sed -i '' '\\|/usr/local/bin/guarded-shell|d' /etc/shells 2>/dev/null; true`);
  await execAsRoot(`sed -i '' '\\|/.agenshield/bin/guarded-shell|d' /etc/shells 2>/dev/null; true`);
  console.log('\x1b[32m✓\x1b[0m Cleaned /etc/shells');

  // Remove legacy guarded shell binary
  if (fs.existsSync('/usr/local/bin/guarded-shell')) {
    await execAsRoot('rm -f /usr/local/bin/guarded-shell');
  }

  // Remove router wrappers
  try {
    const { scanForRouterWrappers, pathRegistryPath } = await import('@agenshield/sandbox');
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
      console.log(`\x1b[32m✓\x1b[0m Removed ${wrappers.length} PATH router wrapper(s)`);
    }

    // Delete path registry
    const registryPath = pathRegistryPath(hostHome);
    if (fs.existsSync(registryPath)) {
      await execAsRoot(`rm -f "${registryPath}"`);
    }
  } catch {
    // Best effort
  }

  // Remove remaining LaunchDaemons
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

  // Remove legacy directories
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
  console.log('\x1b[32m✓\x1b[0m Cleaned legacy directories');

  // Remove agenshield sudoers files
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

  // Clean up user data directory
  if (fs.existsSync(dataDir)) {
    try {
      execSync(`sudo rm -rf "${dataDir}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      console.log(`\x1b[32m✓\x1b[0m Deleted ${dataDir}`);
    } catch {
      console.log(`\x1b[33m!\x1b[0m Could not fully remove ${dataDir}`);
    }
  }
}

/**
 * Run the uninstall process
 */
async function runUninstall(options: { force?: boolean; prefix?: string; skipBackup?: boolean }): Promise<void> {
  ensureSudoAccess();

  // --skip-backup: go straight to discovery-based force uninstall
  if (options.skipBackup) {
    await runForceUninstall(options);
    return;
  }

  const dataDir = resolveDataDir();

  // Try to open storage and read profiles
  const storage = await tryOpenStorage(dataDir);

  if (!storage) {
    console.log('\x1b[33m⚠ Storage not available — falling back to discovery-based cleanup.\x1b[0m\n');
    await runForceUninstall(options);
    return;
  }

  let profiles;
  try {
    profiles = storage.profiles.getAll().filter(p => p.type === 'target');
  } catch {
    console.log('\x1b[33m⚠ Could not read profiles — falling back to discovery-based cleanup.\x1b[0m\n');
    storage.close();
    await runForceUninstall(options);
    return;
  }

  if (profiles.length === 0) {
    console.log('\x1b[33m⚠ No target profiles found — falling back to discovery-based cleanup.\x1b[0m\n');
    storage.close();
    await runForceUninstall(options);
    return;
  }

  // Show what will be unshielded
  console.log('\x1b[31mAgenShield Uninstall\x1b[0m');
  console.log('====================\n');
  console.log('This will unshield the following targets:\n');
  for (const p of profiles) {
    const target = p.targetName ?? p.name;
    const agent = p.agentUsername ?? '(unknown)';
    console.log(`  \x1b[33m->\x1b[0m ${target} (user: ${agent})`);
  }
  console.log('');
  console.log('And then:');
  console.log('  \x1b[33m->\x1b[0m Stop and remove agenshield daemon');
  console.log('  \x1b[33m->\x1b[0m Remove guarded shell');
  console.log('  \x1b[33m->\x1b[0m Remove PATH router wrappers');
  console.log('  \x1b[33m->\x1b[0m Delete system configuration');
  console.log('  \x1b[33m->\x1b[0m Delete data directory');
  console.log('');
  console.log('\x1b[31mWARNING: This action cannot be undone!\x1b[0m');
  console.log('');

  // Confirm
  if (!options.force) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('Type UNINSTALL to confirm: ', (answer) => {
        rl.close();
        resolve(answer);
      });
    });

    if (answer !== 'UNINSTALL') {
      console.log('\nUninstall cancelled.');
      storage.close();
      process.exit(0);
    }
  }

  console.log('\nUninstalling...\n');

  // Stop daemon first
  console.log('Stopping daemon...');
  const stopResult = await stopDaemon();
  const stopIcon = stopResult.success ? '\x1b[32m✓\x1b[0m' : '\x1b[33m!\x1b[0m';
  console.log(`${stopIcon} stop-daemon: ${stopResult.message}`);
  console.log('');

  // Unshield each profile
  for (const profile of profiles) {
    const target = profile.targetName ?? profile.name;
    console.log(`Unshielding ${target}...`);
    try {
      await unshieldProfile(profile, storage);
      console.log(`\x1b[32m✓\x1b[0m ${target} unshielded\n`);
    } catch (err) {
      console.log(`\x1b[31m✗\x1b[0m ${target} unshield failed: ${(err as Error).message}\n`);
    }
  }

  storage.close();

  // System-level cleanup
  await systemCleanup(dataDir);

  console.log('');
  console.log('\x1b[32mUninstall complete!\x1b[0m');
  console.log('All AgenShield targets have been unshielded and artifacts removed.');
}

/**
 * Run discovery-based force uninstall (no storage needed).
 */
async function runForceUninstall(options: { force?: boolean }): Promise<void> {
  const { forceUninstall } = await import('@agenshield/sandbox');

  console.log('\x1b[33mForce Uninstall (Discovery-based)\x1b[0m');
  console.log('==================================\n');
  console.log('This will:');
  console.log('  \x1b[33m->\x1b[0m Stop and remove agenshield daemon');
  console.log('  \x1b[33m->\x1b[0m Delete any discovered sandbox users (ash_*)');
  console.log('  \x1b[33m->\x1b[0m Delete any discovered workspace groups (ash_*)');
  console.log('  \x1b[33m->\x1b[0m Remove guarded shell');
  console.log('  \x1b[33m->\x1b[0m Delete /etc/agenshield configuration');
  console.log('  \x1b[33m->\x1b[0m Remove databases (main + activity), vault, backups');
  console.log('');
  console.log('\x1b[31mWARNING: This will NOT restore targets to their original state!\x1b[0m');
  console.log('');

  if (!options.force) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('Type FORCE to confirm: ', (answer) => {
        rl.close();
        resolve(answer);
      });
    });

    if (answer !== 'FORCE') {
      console.log('\nUninstall cancelled.');
      process.exit(0);
    }
  }

  console.log('\nForce uninstalling...\n');

  const result = forceUninstall((progress) => {
    const icon = progress.success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`${icon} ${progress.step}: ${progress.message || progress.error || ''}`);
  });

  // Clean up user data directory
  const dataDir = resolveDataDir();
  if (fs.existsSync(dataDir)) {
    try {
      execSync(`sudo rm -rf "${dataDir}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      console.log(`\x1b[32m✓\x1b[0m cleanup: Deleted ${dataDir} (databases, vault, logs)`);
    } catch {
      console.log(`\x1b[33m!\x1b[0m cleanup: Could not fully remove ${dataDir} (may contain root-owned files)`);
    }
  }

  console.log('');

  if (result.success) {
    console.log('\x1b[32mForce uninstall complete!\x1b[0m');
    console.log('AgenShield artifacts have been removed.');
  } else {
    console.log('\x1b[31mForce uninstall failed!\x1b[0m');
    console.log(result.error || 'Unknown error');
    process.exit(1);
  }
}

/**
 * Create the uninstall command
 */
export function createUninstallCommand(): Command {
  const cmd = new Command('uninstall')
    .description('Reverse isolation and restore targets')
    .option('-f, --force', 'Skip confirmation prompt')
    .option('--prefix <prefix>', 'Uninstall a specific prefixed installation')
    .option('--skip-backup', 'Force discovery-based cleanup (bypass profile-based uninstall)')
    .action(async (options) => {
      await runUninstall(options);
    });

  return cmd;
}
