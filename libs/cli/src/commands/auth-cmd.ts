/**
 * Auth command group
 *
 * Provides authentication token management.
 *   - `auth token ui`              — Print the admin token for dashboard login
 *   - `auth token broker <id>`     — Generate a broker token for a specific target
 *   - `auth` (no subcommand)       — Show help
 */

import { Command, Option } from 'clipanion';
import { BaseCommand } from './base.js';
import {
  readAdminToken,
  fetchAdminToken,
  getDaemonStatus,
  DAEMON_CONFIG,
} from '../utils/daemon.js';
import { ensureSetupComplete } from '../utils/setup-guard.js';
import { DaemonNotRunningError, AuthError, ConnectionError } from '../errors.js';

/**
 * `agenshield auth` — show help for auth subcommands
 */
export class AuthHelpCommand extends BaseCommand {
  static override paths = [['auth']];

  static override usage = BaseCommand.Usage({
    category: 'Authentication',
    description: 'Authentication and token management',
    details: 'Use one of the subcommands:\n\n  auth token ui          Print admin JWT for dashboard login\n  auth token broker <id> Generate broker JWT for a target',
  });

  async run(): Promise<number | void> {
    this.context.stdout.write(this.cli.usage(AuthHelpCommand, { detailed: true }));
  }
}

/**
 * `agenshield auth token ui` — print admin JWT to stdout
 */
export class AuthTokenUiCommand extends BaseCommand {
  static override paths = [['auth', 'token', 'ui']];

  static override usage = BaseCommand.Usage({
    category: 'Authentication',
    description: 'Print the admin JWT for dashboard login (requires setup)',
    examples: [['Print admin token', '$0 auth token ui']],
  });

  async run(): Promise<number | void> {
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
  }
}

/**
 * `agenshield auth token broker <target-id>` — generate broker JWT via daemon API
 */
export class AuthTokenBrokerCommand extends BaseCommand {
  static override paths = [['auth', 'token', 'broker']];

  static override usage = BaseCommand.Usage({
    category: 'Authentication',
    description: 'Generate a broker JWT for a target profile (requires setup)',
    examples: [['Generate broker token', '$0 auth token broker my-target-id']],
  });

  targetId = Option.String({ required: true, name: 'target-id' });

  async run(): Promise<number | void> {
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
          body: JSON.stringify({ targetId: this.targetId }),
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
  }
}
