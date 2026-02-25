/**
 * Start command
 *
 * Starts the AgenShield daemon and opens the browser UI with JWT auth.
 * If the daemon is already running, fetches a fresh admin token and opens the browser.
 */

import { Command } from 'commander';
import {
  getDaemonStatus,
  startDaemon,
  readAdminToken,
  DAEMON_CONFIG,
} from '../utils/daemon.js';
import { ensureSudoAccess, startSudoKeepalive } from '../utils/privileges.js';

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
 * Build the browser URL with optional JWT token in hash
 */
function buildBrowserUrl(token: string | null): string {
  const base = `http://${DAEMON_CONFIG.DISPLAY_HOST}:${DAEMON_CONFIG.PORT}`;
  if (token) {
    return `${base}/#access_token=${token}`;
  }
  return base;
}

/**
 * Wait for the admin token file to appear (daemon writes it at startup)
 */
async function waitForAdminToken(maxWaitMs = 5000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const token = readAdminToken();
    if (token) return token;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
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
      const status = await getDaemonStatus();

      if (status.running) {
        console.log(`\x1b[32m✓ Daemon is already running (PID: ${status.pid ?? 'unknown'})\x1b[0m`);

        // Read existing admin token or request a fresh one
        const token = readAdminToken();
        const url = buildBrowserUrl(token);
        console.log(`  URL: ${url}`);

        if (options.browser !== false) {
          openBrowser(url);
        }
        return;
      }

      // Ensure sudo credentials are cached before spawning the daemon
      ensureSudoAccess();

      let sudoKeepalive: NodeJS.Timeout | undefined;
      if (options.foreground) {
        sudoKeepalive = startSudoKeepalive();
      }

      console.log('Starting AgenShield daemon...');
      const result = await startDaemon({ foreground: options.foreground, sudo: true });

      if (sudoKeepalive) {
        clearInterval(sudoKeepalive);
      }

      if (result.success) {
        console.log(`\x1b[32m✓ ${result.message}\x1b[0m`);
        if (result.pid) {
          console.log(`  PID: ${result.pid}`);
        }

        // Wait for the daemon to write the admin token, then include it in the URL
        const token = await waitForAdminToken();
        const url = buildBrowserUrl(token);
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
