/**
 * Configuration routes
 */

import type { FastifyInstance } from 'fastify';
import type {
  GetConfigResponse,
  UpdateConfigResponse,
  UpdateConfigRequest,
} from '@agenshield/ipc';
import { loadConfig, updateConfig, saveConfig, getDefaultConfig } from '../config/index';
import { getDefaultState, saveState } from '../state/index';
import { getVault } from '../vault';
import { getSessionManager } from '../auth/session';

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

  // Factory reset — wipe all user data and restore defaults
  app.post('/config/factory-reset', async (): Promise<{ success: boolean; error?: { message: string } }> => {
    try {
      // 1. Reset config to defaults
      saveConfig(getDefaultConfig());

      // 2. Destroy vault (secrets, passcode, OAuth tokens)
      const vault = getVault();
      await vault.destroy();

      // 3. Reset state to defaults
      saveState(getDefaultState());

      // 4. Clear all active sessions
      getSessionManager().clearAllSessions();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Factory reset failed',
        },
      };
    }
  });
}
