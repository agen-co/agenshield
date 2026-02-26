/**
 * Start command
 *
 * Starts the AgenShield daemon and displays the dashboard URL.
 */

import type { Command } from 'commander';
import fs from 'node:fs';
import { withGlobals } from './base.js';
import {
  getDaemonStatus,
  startDaemon,
  readAdminToken,
  fetchAdminToken,
  DAEMON_CONFIG,
} from '../utils/daemon.js';
import { buildBrowserUrl, waitForAdminToken } from '../utils/browser.js';
import { ensureSudoAccess, startSudoKeepalive } from '../utils/privileges.js';
import { output } from '../utils/output.js';
import { ensureSetupComplete } from '../utils/setup-guard.js';
import { createSpinner } from '../utils/spinner.js';
import { DaemonStartError } from '../errors.js';

export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start the AgenShield daemon (requires setup)')
    .option('-f, --foreground', 'Run in foreground (blocking)', false)
    .option('--seed-policies <path>', 'Seed managed policies from a JSON file on start')
    .action(withGlobals(async (opts) => {
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
        return;
      }

      // Ensure sudo credentials are cached before spawning the daemon
      ensureSudoAccess();

      let sudoKeepalive: NodeJS.Timeout | undefined;
      if (opts['foreground']) {
        sudoKeepalive = startSudoKeepalive();
      }

      const spinner = await createSpinner('Starting AgenShield daemon...');
      const result = await startDaemon({ foreground: opts['foreground'] as boolean, sudo: true });

      if (sudoKeepalive) {
        clearInterval(sudoKeepalive);
      }

      if (result.success) {
        spinner.succeed(`${result.message}${result.pid ? ` (PID: ${result.pid})` : ''}`);

        const token = await waitForAdminToken();
        const url = buildBrowserUrl(token);

        // Seed managed policies from file if provided
        if (opts['seedPolicies']) {
          await seedManagedPolicies(opts['seedPolicies'] as string, token);
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
      } else {
        spinner.fail('Failed to start daemon');
        throw new DaemonStartError(result.message);
      }
    }));
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
