/**
 * Configuration routes
 */

import type { FastifyInstance } from 'fastify';
import type {
  GetConfigResponse,
  UpdateConfigResponse,
  UpdateConfigRequest,
} from '@agenshield/ipc';
import { loadConfig, updateConfig } from '../config/index';

export async function configRoutes(app: FastifyInstance): Promise<void> {
  // Get current configuration
  app.get('/config', async (): Promise<GetConfigResponse> => {
    const config = loadConfig();
    return {
      success: true,
      data: config,
    };
  });

  // Update configuration
  app.put<{ Body: UpdateConfigRequest }>(
    '/config',
    async (request): Promise<UpdateConfigResponse> => {
      try {
        const updated = updateConfig(request.body);
        return {
          success: true,
          data: updated,
        };
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'CONFIG_UPDATE_FAILED',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    }
  );
}
