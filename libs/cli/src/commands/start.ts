/**
 * Start command
 *
 * Starts the AgenShield daemon and opens the browser UI.
 * If the daemon is already running, just opens the browser.
 */

import { Command } from 'commander';
import {
  getDaemonStatus,
  startDaemon,
  DAEMON_CONFIG,
} from '../utils/daemon.js';

/**
 * Open the daemon UI in the default browser
 */
async function openBrowser(url: string): Promise<void> {
  try {
    const { exec } = await import('node:child_process');
    exec(`open "${url}"`);
  } catch {
    // Non-fatal — user can open manually
  }
}

/**
 * Create the start command
 */
export function createStartCommand(): Command {
  const cmd = new Command('start')
    .description('Start AgenShield and open the dashboard')
    .option('-f, --foreground', 'Run in foreground (blocking)')
    .option('--no-browser', 'Do not open the browser')
    .action(async (options) => {
      const url = `http://${DAEMON_CONFIG.DISPLAY_HOST}:${DAEMON_CONFIG.PORT}`;
      const status = await getDaemonStatus();

      if (status.running) {
        console.log(`\x1b[32m✓ Daemon is already running (PID: ${status.pid ?? 'unknown'})\x1b[0m`);
        console.log(`  URL: ${url}`);

        if (options.browser !== false) {
          openBrowser(url);
        }
        return;
      }

      console.log('Starting AgenShield daemon...');
      const result = await startDaemon({ foreground: options.foreground });

      if (result.success) {
        console.log(`\x1b[32m✓ ${result.message}\x1b[0m`);
        if (result.pid) {
          console.log(`  PID: ${result.pid}`);
        }
        console.log(`  URL: ${url}`);

        if (!options.foreground && options.browser !== false) {
          openBrowser(url);
        }
      } else {
        console.log(`\x1b[31m✗ ${result.message}\x1b[0m`);
        process.exit(1);
      }
    });

  return cmd;
}
