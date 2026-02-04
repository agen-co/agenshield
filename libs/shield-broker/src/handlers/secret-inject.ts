/**
 * Secret Inject Handler
 *
 * Retrieves secrets from the vault for injection.
 */

import type {
  HandlerContext,
  HandlerResult,
  SecretInjectParams,
  SecretInjectResult,
} from '../types.js';
import type { HandlerDependencies } from './types.js';

export async function handleSecretInject(
  params: Record<string, unknown>,
  context: HandlerContext,
  deps: HandlerDependencies
): Promise<HandlerResult<SecretInjectResult>> {
  const startTime = Date.now();

  try {
    const { name, targetEnv } = params as unknown as SecretInjectParams;

    if (!name) {
      return {
        success: false,
        error: { code: 1003, message: 'Secret name is required' },
      };
    }

    // Only allow via socket (not HTTP fallback)
    if (context.channel !== 'socket') {
      return {
        success: false,
        error: { code: 1008, message: 'Secret injection only allowed via Unix socket' },
      };
    }

    // Get secret from vault
    const secret = await deps.secretVault.get(name);

    if (!secret) {
      return {
        success: false,
        error: { code: 1007, message: `Secret not found: ${name}` },
      };
    }

    return {
      success: true,
      data: {
        value: secret.value,
        injected: true,
      },
      audit: {
        duration: Date.now() - startTime,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: { code: 1007, message: `Secret inject error: ${(error as Error).message}` },
    };
  }
}
