/**
 * Security status route
 */

import type { FastifyInstance } from 'fastify';
import type { GetSecurityStatusResponse } from '@agenshield/ipc';
import { checkSecurityStatus } from '@agenshield/sandbox';

export async function securityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/security', async (): Promise<GetSecurityStatusResponse> => {
    try {
      const status = checkSecurityStatus();

      return {
        success: true,
        data: {
          runningAsRoot: status.runningAsRoot,
          currentUser: status.currentUser,
          sandboxUserExists: status.sandboxUserExists,
          isIsolated: status.isIsolated,
          guardedShellInstalled: status.guardedShellInstalled,
          exposedSecrets: status.exposedSecrets,
          warnings: status.warnings,
          critical: status.critical,
          recommendations: status.recommendations,
          level: status.level,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'SECURITY_CHECK_FAILED',
          message: error instanceof Error ? error.message : 'Failed to check security status',
        },
      };
    }
  });
}
