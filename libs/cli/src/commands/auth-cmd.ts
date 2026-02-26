/**
 * Auth command group
 *
 * Provides authentication token management.
 *   - `auth token ui`              — Print the admin token for dashboard login
 *   - `auth token broker <id>`     — Generate a broker token for a specific target
 *   - `auth` (no subcommand)       — Show help
 */

import type { Command } from 'commander';
import { withGlobals, withGlobalsPositional } from './base.js';
import {
  readAdminToken,
  fetchAdminToken,
  getDaemonStatus,
  DAEMON_CONFIG,
} from '../utils/daemon.js';
import { ensureSetupComplete } from '../utils/setup-guard.js';
import { DaemonNotRunningError, AuthError, ConnectionError } from '../errors.js';

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command('auth')
    .description('Authentication and token management');

  const token = auth
    .command('token')
    .description('Token operations');

  token
    .command('ui')
    .description('Print the admin JWT for dashboard login (requires setup)')
    .action(withGlobals(async () => {
      ensureSetupComplete();
      const adminToken = readAdminToken() ?? await fetchAdminToken();
      if (adminToken) {
        process.stdout.write(adminToken + '\n');
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
    }));

  token
    .command('broker')
    .description('Generate a broker JWT for a target profile (requires setup)')
    .argument('<target-id>', 'Target profile ID')
    .action(withGlobalsPositional(async (targetId, _opts) => {
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
        throw new ConnectionError(`Failed to connect to daemon \u2014 ${(err as Error).message}`);
      }
    }));
}
