/**
 * Health check route
 */

import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@agenshield/ipc';
import { getEventLoopStats } from '../services/event-loop-monitor';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (request): Promise<HealthResponse> => {
    return {
      success: true,
      data: {
        ok: true,
        timestamp: new Date().toISOString(),
        mode: 'daemon',
        eventLoop: getEventLoopStats() ?? undefined,
      },
    };
  });
}
