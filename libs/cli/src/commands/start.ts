/**
 * Start command
 *
 * Starts the AgenShield daemon and opens the browser UI with JWT auth.
 * If the daemon is already running, fetches a fresh admin token and opens the browser.
 */

import { Command } from 'commander';
import fs from 'node:fs';
import {
  getDaemonStatus,
  startDaemon,
  readAdminToken,
  fetchAdminToken,
  DAEMON_CONFIG,
} from '../utils/daemon.js';
import { openBrowser, buildBrowserUrl, waitForAdminToken } from '../utils/browser.js';
import { ensureSudoAccess, startSudoKeepalive } from '../utils/privileges.js';
import { output } from '../utils/output.js';
import { ensureSetupComplete } from '../utils/setup-guard.js';
import { DaemonStartError } from '../errors.js';

/**
 * Create the start command
 */
export function createStartCommand(): Command {
  const cmd = new Command('start')
    .description('Start AgenShield and open the dashboard')
    .option('-f, --foreground', 'Run in foreground (blocking)')
    .option('--no-browser', 'Do not open the browser')
    .option('--seed-policies <file>', 'Seed managed policies from a JSON file on start')
    .action(async (options) => {
      ensureSetupComplete();
      const status = await getDaemonStatus();

      if (status.running) {
        const token = readAdminToken() ?? await fetchAdminToken();
        const url = buildBrowserUrl(token);

        output.success(`Daemon is already running (PID: ${status.pid ?? 'unknown'})`);
        output.info('');
        output.info('  Dashboard URL:');
        output.info(`  ${output.cyan(url)}`);
        if (token) {
          output.info('');
          output.info('  Admin token:');
          output.info(`  ${output.dim(token)}`);
        }
        output.info('');

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

      output.info('Starting AgenShield daemon...');
      const result = await startDaemon({ foreground: options.foreground, sudo: true });

      if (sudoKeepalive) {
        clearInterval(sudoKeepalive);
      }

      if (result.success) {
        const token = await waitForAdminToken();
        const url = buildBrowserUrl(token);

        output.success(`${result.message}${result.pid ? ` (PID: ${result.pid})` : ''}`);

        // Seed managed policies from file if provided
        if (options.seedPolicies) {
          await seedManagedPolicies(options.seedPolicies, token);
        }

        output.info('');
        output.info('  Dashboard URL:');
        output.info(`  ${output.cyan(url)}`);
        if (token) {
          output.info('');
          output.info('  Admin token:');
          output.info(`  ${output.dim(token)}`);
        }
        output.info('');

        if (!options.foreground && options.browser !== false) {
          openBrowser(url);
        }
      } else {
        throw new DaemonStartError(result.message);
      }
    });

  return cmd;
}

/**
 * Seed managed policies from a JSON file into the running daemon.
 * POSTs to /api/config/policies/managed/sync.
 */
async function seedManagedPolicies(filePath: string, token: string | null): Promise<void> {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    // Expect { source?: string, policies: PolicyConfig[] } or PolicyConfig[]
    const body = Array.isArray(data)
      ? { source: 'seed', policies: data }
      : { source: data.source ?? 'seed', policies: data.policies };

    if (!Array.isArray(body.policies)) {
      output.warn('Seed file must contain a policies array');
      return;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(
      `http://${DAEMON_CONFIG.HOST}:${DAEMON_CONFIG.PORT}/api/config/policies/managed/sync`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
    );

    if (res.ok) {
      output.success(`Seeded ${body.policies.length} managed policies from ${filePath}`);
    } else {
      const text = await res.text();
      output.warn(`Failed to seed policies: ${res.status} ${text.slice(0, 200)}`);
    }
  } catch (err) {
    output.warn(`Failed to read or seed policies from ${filePath}: ${(err as Error).message}`);
  }
}
