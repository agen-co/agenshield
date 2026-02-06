/**
 * Uninstall command
 *
 * Reverses the AgenShield installation and restores OpenClaw to its original state.
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { ensureSudoAccess } from '../utils/privileges.js';
import { stopDaemon } from '../utils/daemon.js';

/**
 * Run the uninstall process
 */
async function runUninstall(options: { force?: boolean; prefix?: string; skipBackup?: boolean }): Promise<void> {
  ensureSudoAccess();

  const { canUninstall, restoreInstallation, forceUninstall } = await import('@agenshield/sandbox');

  // Check if backup exists
  const check = canUninstall();

  // Handle --skip-backup flag for force uninstall without backup
  if (options.skipBackup) {
    console.log('\x1b[33mForce Uninstall (No Backup)\x1b[0m');
    console.log('============================\n');
    console.log('This will:');
    console.log('  \x1b[33m->\x1b[0m Stop and remove agenshield daemon');
    console.log('  \x1b[33m->\x1b[0m Delete any discovered sandbox users (ash_*)');
    console.log('  \x1b[33m->\x1b[0m Delete any discovered workspace groups (ash_*_workspace)');
    console.log('  \x1b[33m->\x1b[0m Remove guarded shell');
    console.log('  \x1b[33m->\x1b[0m Delete /etc/agenshield configuration');
    console.log('');
    console.log('\x1b[31mWARNING: This will NOT restore OpenClaw to its original state!\x1b[0m');
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

    console.log('');

    if (result.success) {
      console.log('\x1b[32mForce uninstall complete!\x1b[0m');
      console.log('AgenShield artifacts have been removed.');
    } else {
      console.log('\x1b[31mForce uninstall failed!\x1b[0m');
      console.log(result.error || 'Unknown error');
      process.exit(1);
    }
    return;
  }

  if (!check.canUninstall || !check.backup) {
    console.log('\x1b[31mNo backup found.\x1b[0m');
    console.log('Cannot safely uninstall without a backup.');
    console.log('The backup is created during "agenshield setup".');
    console.log('');
    console.log('To force uninstall without a backup, use:');
    console.log('  \x1b[36msudo agenshield uninstall --skip-backup\x1b[0m');
    process.exit(1);
  }

  const backup = check.backup;

  // Show warning
  console.log('\x1b[31mAgenShield Uninstall\x1b[0m');
  console.log('====================\n');
  console.log('This will:');
  console.log('  \x1b[33m->\x1b[0m Stop and remove agenshield daemon');
  console.log('  \x1b[33m->\x1b[0m Restore OpenClaw to original location');
  console.log(`  \x1b[33m->\x1b[0m Delete sandbox user "${backup.sandboxUser.username}"`);
  console.log('  \x1b[33m->\x1b[0m Remove guarded shell');
  console.log('  \x1b[33m->\x1b[0m Delete /etc/agenshield configuration');
  console.log('');
  console.log(`Backup found: ${backup.timestamp}`);
  console.log('');
  console.log('\x1b[31mWARNING: This action cannot be undone!\x1b[0m');
  console.log('');

  // Skip confirmation if --force
  if (!options.force) {
    // Prompt for confirmation
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
      process.exit(0);
    }
  }

  console.log('\nUninstalling...\n');

  // Stop daemon first (handles launchctl, PID, port fallback)
  console.log('Stopping daemon...');
  const stopResult = await stopDaemon();
  const stopIcon = stopResult.success ? '\x1b[32m✓\x1b[0m' : '\x1b[33m!\x1b[0m';
  console.log(`${stopIcon} stop-daemon: ${stopResult.message}`);
  console.log('');

  // Run the uninstall process
  const result = restoreInstallation(backup, (progress) => {
    const icon = progress.success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`${icon} ${progress.step}: ${progress.message || progress.error || ''}`);
  });

  console.log('');

  if (result.success) {
    console.log('\x1b[32mUninstall complete!\x1b[0m');
    console.log('OpenClaw has been restored to its original location.');
    console.log('Run "openclaw --version" to verify.');

    // Offer to delete ~/.agenshield data directory
    const agenshieldDir = path.join(os.homedir(), '.agenshield');
    if (!options.force && fs.existsSync(agenshieldDir)) {
      console.log('');
      const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
      const deleteData = await new Promise<string>((resolve) => {
        rl2.question(
          `Delete ${agenshieldDir} to remove all data (config, vault, logs)? [y/N] `,
          (answer) => { rl2.close(); resolve(answer); }
        );
      });

      if (deleteData.toLowerCase() === 'y' || deleteData.toLowerCase() === 'yes') {
        fs.rmSync(agenshieldDir, { recursive: true, force: true });
        console.log(`\x1b[32m✓\x1b[0m Deleted ${agenshieldDir}`);
      } else {
        console.log(`Kept ${agenshieldDir} (contains config, vault, activity logs)`);
      }
    }
  } else {
    console.log('\x1b[31mUninstall failed!\x1b[0m');
    console.log(result.error || 'Unknown error');
    console.log('Please check the errors above and try again.');
    process.exit(1);
  }
}

/**
 * Create the uninstall command
 */
export function createUninstallCommand(): Command {
  const cmd = new Command('uninstall')
    .description('Reverse isolation and restore OpenClaw')
    .option('-f, --force', 'Skip confirmation prompt')
    .option('--prefix <prefix>', 'Uninstall a specific prefixed installation')
    .option('--skip-backup', 'Force uninstall without a backup (will not restore OpenClaw)')
    .action(async (options) => {
      await runUninstall(options);
    });

  return cmd;
}
