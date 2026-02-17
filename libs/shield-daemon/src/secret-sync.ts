/**
 * Secret Policy Sync — Daemon wrapper
 *
 * Delegates to @agenshield/policies syncSecrets, providing the
 * broker-bridge push callback.
 */

import type { PolicyConfig, ScopeFilter } from '@agenshield/ipc';
import { getStorage } from '@agenshield/storage';
import { syncSecrets as policySyncSecrets } from '@agenshield/policies';
import { pushSecretsToBroker } from './services/broker-bridge';

interface Logger {
  warn(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
}

/**
 * Sync vault secrets to the broker via IPC push.
 *
 * This is a thin wrapper around the policies library's syncSecrets,
 * providing the daemon-specific broker push callback.
 */
export async function syncSecrets(
  policies: PolicyConfig[],
  logger?: Logger,
  scope?: ScopeFilter,
): Promise<void> {
  const storage = getStorage();
  await policySyncSecrets(storage, policies, pushSecretsToBroker, logger, scope);
}
