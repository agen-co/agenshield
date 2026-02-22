/**
 * Setup command (deprecated)
 *
 * The daemon now always starts in full mode. The UI handles passcode creation
 * and target shielding directly via the canvas.
 *
 * This command is kept for backwards compatibility but redirects to `agenshield start`.
 */

import { Command } from 'commander';

/**
 * Create the setup command
 */
export function createSetupCommand(): Command {
  const cmd = new Command('setup')
    .description('(Deprecated) Run the setup wizard — use `agenshield start` instead')
    .allowUnknownOption(true)
    .action(async () => {
      console.log('');
      console.log('  \x1b[33m⚠  `agenshield setup` has been deprecated.\x1b[0m');
      console.log('');
      console.log('  The daemon now handles setup automatically.');
      console.log('  Use \x1b[1magenshield start\x1b[0m to start the daemon,');
      console.log('  then open the dashboard to detect and shield targets.');
      console.log('');
      console.log('  Starting daemon...');
      console.log('');

      try {
        const { startDaemon } = await import('../utils/daemon.js');
        const result = await startDaemon();
        if (result.success) {
          console.log(`  \x1b[32m✓\x1b[0m Daemon started (PID: ${result.pid})`);
          console.log(`  Dashboard: http://localhost:5200`);
        } else {
          console.log(`  ${result.message}`);
        }
      } catch (err) {
        console.error(`  Failed to start daemon: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return cmd;
}
