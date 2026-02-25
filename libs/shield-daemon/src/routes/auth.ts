/**
 * Authentication routes
 *
 * JWT-based authentication with sudo login and token refresh.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  SudoLoginRequestSchema,
} from '@agenshield/ipc';
import type {
  AuthStatusResponse,
  SudoLoginRequest,
  SudoLoginResponse,
  RefreshResponse,
} from '@agenshield/ipc';
import {
  signAdminToken,
  verifyToken,
  verifySudoPassword,
  getAdminTtlSeconds,
} from '@agenshield/auth';
import { extractToken } from '../auth/middleware';
import { isRunningAsRoot } from '../auth/passcode';

/**
 * Register authentication routes
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /auth/status - Check authentication status
   */
  app.get('/auth/status', async (request: FastifyRequest): Promise<AuthStatusResponse> => {
    const token = extractToken(request);
    if (!token) {
      return { authenticated: false };
    }

    const result = await verifyToken(token);
    if (!result.valid || !result.payload) {
      return { authenticated: false };
    }

    return {
      authenticated: true,
      role: result.payload.role,
      expiresAt: result.payload.role === 'admin'
        ? (result.payload as { exp: number }).exp * 1000
        : undefined,
    };
  });

  /**
   * POST /auth/sudo-login - Authenticate with macOS sudo credentials
   */
  app.post<{ Body: SudoLoginRequest }>(
    '/auth/sudo-login',
    async (request: FastifyRequest<{ Body: SudoLoginRequest }>, reply: FastifyReply): Promise<SudoLoginResponse> => {
      const parseResult = SudoLoginRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        reply.code(400);
        return {
          success: false,
          error: 'Invalid request: ' + parseResult.error.message,
        };
      }

      const { username, password } = parseResult.data;

      try {
        const sudoResult = await verifySudoPassword(username, password);
        if (!sudoResult.valid) {
          reply.code(401);
          return {
            success: false,
            error: 'Invalid credentials',
          };
        }

        // Issue admin JWT
        const token = await signAdminToken();
        const expiresAt = Date.now() + getAdminTtlSeconds() * 1000;

        return {
          success: true,
          token,
          expiresAt,
        };
      } catch (err) {
        const error = err as Error;
        if (error.name === 'RateLimitError') {
          reply.code(429);
          return {
            success: false,
            error: error.message,
          };
        }
        reply.code(500);
        return {
          success: false,
          error: 'Authentication failed',
        };
      }
    },
  );

  /**
   * POST /auth/refresh - Refresh an admin JWT
   */
  app.post(
    '/auth/refresh',
    async (request: FastifyRequest, reply: FastifyReply): Promise<RefreshResponse> => {
      const token = extractToken(request);
      if (!token) {
        reply.code(401);
        return { success: false, error: 'No token provided' };
      }

      const result = await verifyToken(token);
      if (!result.valid || !result.payload) {
        reply.code(401);
        return { success: false, error: 'Invalid or expired token' };
      }

      if (result.payload.role !== 'admin') {
        reply.code(403);
        return { success: false, error: 'Only admin tokens can be refreshed' };
      }

      // Issue a new admin JWT
      const newToken = await signAdminToken();
      const expiresAt = Date.now() + getAdminTtlSeconds() * 1000;

      return {
        success: true,
        token: newToken,
        expiresAt,
      };
    },
  );

  /**
   * POST /auth/admin-token - Generate admin JWT (root-only, used by CLI)
   */
  app.post(
    '/auth/admin-token',
    async (_request: FastifyRequest, reply: FastifyReply): Promise<SudoLoginResponse> => {
      if (!isRunningAsRoot()) {
        reply.code(403);
        return {
          success: false,
          error: 'This endpoint requires root access',
        };
      }

      const token = await signAdminToken();
      const expiresAt = Date.now() + getAdminTtlSeconds() * 1000;

      return {
        success: true,
        token,
        expiresAt,
      };
    },
  );
}
