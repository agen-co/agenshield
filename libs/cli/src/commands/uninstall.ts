/**
 * Uninstall command
 *
 * Reverses the AgenShield installation and restores OpenClaw to its original state.
 */

import { Command } from 'commander';
import * as readline from 'node:readline';
import { ensureSudoAccess } from '../utils/privileges.js';

/**
 * Run the uninstall process
 */
async function runUninstall(options: { force?: boolean; prefix?: string }): Promise<void> {
  ensureSudoAccess();

  const { canUninstall, restoreInstallation } = await import('@agenshield/sandbox');

  // Check if backup exists
  const check = canUninstall();
  if (!check.canUninstall || !check.backup) {
    console.log('\x1b[31mNo backup found.\x1b[0m');
    console.log('Cannot safely uninstall without a backup.');
    console.log('The backup is created during "agenshield setup".');
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
    .action(async (options) => {
      await runUninstall(options);
    });

  return cmd;
}
