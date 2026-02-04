/**
 * Ping Handler
 *
 * Health check endpoint.
 */

import type { HandlerContext, HandlerResult, PingParams, PingResult } from '../types.js';
import type { HandlerDependencies } from './types.js';

const VERSION = '0.1.0';

export async function handlePing(
  params: Record<string, unknown>,
  context: HandlerContext,
  deps: HandlerDependencies
): Promise<HandlerResult<PingResult>> {
  const { echo } = params as unknown as PingParams;

  return {
    success: true,
    data: {
      pong: true,
      echo,
      timestamp: new Date().toISOString(),
      version: VERSION,
    },
    audit: {
      duration: 0,
    },
  };
}
