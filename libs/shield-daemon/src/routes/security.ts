/**
 * Security status route
 */

import type { FastifyInstance } from 'fastify';
import type { GetSecurityStatusResponse } from '@agenshield/ipc';
import { checkSecurityStatus } from '@agenshield/sandbox';
import { isAuthenticated } from '../auth/middleware';
import { redactSecurityStatus } from '../auth/redact';

export async function securityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/security', async (request): Promise<GetSecurityStatusResponse> => {
    try {
      const status = checkSecurityStatus();

      // Merge secret names detected in the calling user's environment
      const userSecrets = process.env['AGENSHIELD_USER_SECRETS'];
      if (userSecrets) {
        for (const name of userSecrets.split(',').filter(Boolean)) {
          if (!status.exposedSecrets.includes(name)) {
            status.exposedSecrets.push(name);
          }
        }
      }

      const data = {
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
      };

      return {
        success: true,
        data: isAuthenticated(request) ? data : redactSecurityStatus(data),
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
