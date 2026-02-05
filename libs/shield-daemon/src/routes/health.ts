/**
 * Health check route
 */

import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@agenshield/ipc';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (): Promise<HealthResponse> => {
    return {
      success: true,
      data: {
        ok: true,
        timestamp: new Date().toISOString(),
        mode: 'daemon' as const,
      },
    };
  });
}
