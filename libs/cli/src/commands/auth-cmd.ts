/**
 * Auth command group
 *
 * Provides authentication token management.
 *   - `auth token ui`              — Print the admin token for dashboard login
 *   - `auth token broker <id>`     — Generate a broker token for a specific target
 */

import { Command } from 'commander';
import {
  readAdminToken,
  fetchAdminToken,
  getDaemonStatus,
  DAEMON_CONFIG,
} from '../utils/daemon.js';
import { ensureSetupComplete } from '../utils/setup-guard.js';
import { DaemonNotRunningError, AuthError, ConnectionError } from '../errors.js';

/**
 * Create the auth command group
 */
export function createAuthCommand(): Command {
  const cmd = new Command('auth')
    .description('Authentication and token management');

  const tokenCmd = new Command('token')
    .description('Get authentication tokens for the dashboard or broker targets');

  /**
   * auth token ui — print admin JWT to stdout
   */
  tokenCmd
    .command('ui')
    .description('Print the admin JWT for dashboard login')
    .action(async () => {
      ensureSetupComplete();
      const token = readAdminToken() ?? await fetchAdminToken();
      if (token) {
        process.stdout.write(token + '\n');
        return;
      }

      const status = await getDaemonStatus();
      if (!status.running) {
        throw new DaemonNotRunningError();
      }

      throw new AuthError(
        'Could not retrieve admin token from daemon.\n' +
        '  Possible causes:\n' +
        '  - Daemon needs restart after code changes: agenshield stop && agenshield start\n' +
        '  - Token file permissions issue\n' +
        '  Set AGENSHIELD_DEBUG=1 for details.',
      );
    });

  /**
   * auth token broker <target-id> — generate broker JWT via daemon API
   */
  tokenCmd
    .command('broker <target-id>')
    .description('Generate a broker JWT for a target profile')
    .action(async (targetId: string) => {
      ensureSetupComplete();
      const adminToken = readAdminToken() ?? await fetchAdminToken();
      if (!adminToken) {
        const status = await getDaemonStatus();
        if (!status.running) {
          throw new DaemonNotRunningError();
        }
        throw new AuthError('Could not retrieve admin token from daemon');
      }

      try {
        const res = await fetch(
          `http://${DAEMON_CONFIG.HOST}:${DAEMON_CONFIG.PORT}/api/auth/broker-token`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({ targetId }),
          },
        );

        const data = await res.json() as { success: boolean; token?: string; error?: string };

        if (!res.ok || !data.success) {
          throw new AuthError(data.error || `Request failed (${res.status})`);
        }

        process.stdout.write(data.token + '\n');
      } catch (err) {
        if (err instanceof AuthError) throw err;
        throw new ConnectionError(`Failed to connect to daemon — ${(err as Error).message}`);
      }
    });

  // Default action for token (no subcommand) — show help
  tokenCmd.action(() => {
    tokenCmd.help();
  });

  cmd.addCommand(tokenCmd);

  // Default action for auth (no subcommand) — show help
  cmd.action(() => {
    cmd.help();
  });

  return cmd;
}
