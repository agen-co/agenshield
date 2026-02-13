/**
 * Secrets Sync Handler
 *
 * Receives decrypted secrets from the daemon via IPC push.
 * Updates the SecretResolver's in-memory state — no disk I/O.
 */

import type { HandlerContext } from '../types.js';
import type { HandlerDependencies } from './types.js';

export async function handleSecretsSync(
  params: Record<string, unknown>,
  context: HandlerContext,
  deps: HandlerDependencies,
): Promise<{ success: boolean; data?: unknown; error?: { code: number; message: string } }> {
  // Secrets must only be pushed over Unix socket, never HTTP
  if (context.channel !== 'socket') {
    return {
      success: false,
      error: { code: 1002, message: 'secrets_sync is only allowed over Unix socket' },
    };
  }

  if (!deps.secretResolver) {
    return {
      success: false,
      error: { code: -32000, message: 'SecretResolver not configured' },
    };
  }

  const payload = params as {
    version?: string;
    syncedAt?: string;
    globalSecrets?: Record<string, string>;
    policyBindings?: Array<{
      policyId: string;
      target: 'url' | 'command';
      patterns: string[];
      secrets: Record<string, string>;
    }>;
    clear?: boolean;
  };

  // Handle clear request (daemon lock/shutdown)
  if (payload.clear) {
    deps.secretResolver.clear();
    return { success: true, data: { ok: true, cleared: true } };
  }

  // Validate minimal payload structure
  if (!payload.version || !payload.globalSecrets || !payload.policyBindings) {
    return {
      success: false,
      error: { code: -32602, message: 'Invalid secrets_sync payload: missing required fields' },
    };
  }

  deps.secretResolver.updateFromPush({
    version: payload.version,
    syncedAt: payload.syncedAt ?? new Date().toISOString(),
    globalSecrets: payload.globalSecrets,
    policyBindings: payload.policyBindings,
  });

  return {
    success: true,
    data: {
      ok: true,
      globalCount: Object.keys(payload.globalSecrets).length,
      bindingCount: payload.policyBindings.length,
    },
  };
}
