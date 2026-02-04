/**
 * Authentication routes
 *
 * Handles passcode setup, authentication, and session management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  UnlockRequestSchema,
  SetupPasscodeRequestSchema,
  ChangePasscodeRequestSchema,
} from '@agenshield/ipc';
import type {
  AuthStatusResponse,
  UnlockRequest,
  UnlockResponse,
  LockRequest,
  LockResponse,
  SetupPasscodeRequest,
  SetupPasscodeResponse,
  ChangePasscodeRequest,
  ChangePasscodeResponse,
} from '@agenshield/ipc';
import {
  isPasscodeSet,
  isProtectionEnabled,
  setProtectionEnabled,
  isLockedOut,
  checkPasscode,
  setPasscode,
  recordFailedAttempt,
  clearFailedAttempts,
  isRunningAsRoot,
} from '../auth/passcode';
import { getSessionManager } from '../auth/session';
import { extractToken } from '../auth/middleware';

/**
 * Register authentication routes
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /auth/status - Check passcode protection status
   */
  app.get('/auth/status', async (): Promise<AuthStatusResponse> => {
    const passcodeSet = await isPasscodeSet();
    const protectionEnabled = isProtectionEnabled();
    const lockoutStatus = isLockedOut();

    return {
      passcodeSet,
      protectionEnabled,
      lockedOut: lockoutStatus.locked,
      lockedUntil: lockoutStatus.lockedUntil,
    };
  });

  /**
   * POST /auth/unlock - Authenticate with passcode
   */
  app.post<{ Body: UnlockRequest }>(
    '/auth/unlock',
    async (request: FastifyRequest<{ Body: UnlockRequest }>, reply: FastifyReply): Promise<UnlockResponse> => {
      // Validate request body
      const parseResult = UnlockRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        reply.code(400);
        return {
          success: false,
          error: 'Invalid request: ' + parseResult.error.message,
        };
      }

      const { passcode } = parseResult.data;

      // Check if locked out
      const lockoutStatus = isLockedOut();
      if (lockoutStatus.locked) {
        reply.code(429);
        return {
          success: false,
          error: 'Too many failed attempts. Try again later.',
          remainingAttempts: 0,
        };
      }

      // Check if passcode is set
      const passcodeSet = await isPasscodeSet();
      if (!passcodeSet) {
        reply.code(400);
        return {
          success: false,
          error: 'Passcode not configured. Use /auth/setup first.',
        };
      }

      // Verify passcode
      const valid = await checkPasscode(passcode);
      if (!valid) {
        const remainingAttempts = recordFailedAttempt();
        reply.code(401);
        return {
          success: false,
          error: 'Invalid passcode',
          remainingAttempts,
        };
      }

      // Clear failed attempts on success
      clearFailedAttempts();

      // Create session
      const sessionManager = getSessionManager();
      const session = sessionManager.createSession();

      return {
        success: true,
        token: session.token,
        expiresAt: session.expiresAt,
      };
    }
  );

  /**
   * POST /auth/lock - Invalidate session
   */
  app.post<{ Body: LockRequest }>(
    '/auth/lock',
    async (request: FastifyRequest<{ Body: LockRequest }>, reply: FastifyReply): Promise<LockResponse> => {
      // Get token from body or header
      const token = (request.body as LockRequest)?.token || extractToken(request);

      if (!token) {
        reply.code(400);
        return { success: false };
      }

      const sessionManager = getSessionManager();
      const invalidated = sessionManager.invalidateSession(token);

      return { success: invalidated };
    }
  );

  /**
   * POST /auth/setup - Set initial passcode (only when none set)
   */
  app.post<{ Body: SetupPasscodeRequest }>(
    '/auth/setup',
    async (request: FastifyRequest<{ Body: SetupPasscodeRequest }>, reply: FastifyReply): Promise<SetupPasscodeResponse> => {
      // Validate request body
      const parseResult = SetupPasscodeRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        reply.code(400);
        return {
          success: false,
          error: 'Invalid request: ' + parseResult.error.message,
        };
      }

      const { passcode, enableProtection = true } = parseResult.data;

      // Check if passcode already set
      const alreadySet = await isPasscodeSet();
      if (alreadySet) {
        reply.code(409);
        return {
          success: false,
          error: 'Passcode already configured. Use /auth/change to update.',
        };
      }

      // Set passcode
      await setPasscode(passcode);

      // Enable protection if requested
      if (enableProtection) {
        setProtectionEnabled(true);
      }

      return { success: true };
    }
  );

  /**
   * POST /auth/change - Change passcode (requires old passcode or root)
   */
  app.post<{ Body: ChangePasscodeRequest }>(
    '/auth/change',
    async (request: FastifyRequest<{ Body: ChangePasscodeRequest }>, reply: FastifyReply): Promise<ChangePasscodeResponse> => {
      // Validate request body
      const parseResult = ChangePasscodeRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        reply.code(400);
        return {
          success: false,
          error: 'Invalid request: ' + parseResult.error.message,
        };
      }

      const { oldPasscode, newPasscode } = parseResult.data;

      // Check if passcode is set
      const passcodeSet = await isPasscodeSet();
      if (!passcodeSet) {
        reply.code(400);
        return {
          success: false,
          error: 'Passcode not configured. Use /auth/setup first.',
        };
      }

      // Verify old passcode (unless running as root)
      if (!isRunningAsRoot()) {
        if (!oldPasscode) {
          reply.code(400);
          return {
            success: false,
            error: 'Old passcode required',
          };
        }

        const valid = await checkPasscode(oldPasscode);
        if (!valid) {
          const remainingAttempts = recordFailedAttempt();
          reply.code(401);
          return {
            success: false,
            error: 'Invalid old passcode',
          };
        }

        // Clear failed attempts on success
        clearFailedAttempts();
      }

      // Set new passcode
      await setPasscode(newPasscode);

      // Invalidate all existing sessions
      const sessionManager = getSessionManager();
      sessionManager.clearAllSessions();

      return { success: true };
    }
  );

  /**
   * POST /auth/refresh - Refresh session token
   */
  app.post(
    '/auth/refresh',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractToken(request);
      if (!token) {
        reply.code(401);
        return {
          success: false,
          error: 'No token provided',
        };
      }

      const sessionManager = getSessionManager();
      const refreshed = sessionManager.refreshSession(token);

      if (!refreshed) {
        reply.code(401);
        return {
          success: false,
          error: 'Invalid or expired token',
        };
      }

      return {
        success: true,
        token: refreshed.token,
        expiresAt: refreshed.expiresAt,
      };
    }
  );

  /**
   * POST /auth/enable - Enable passcode protection
   */
  app.post(
    '/auth/enable',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Check if passcode is set
      const passcodeSet = await isPasscodeSet();
      if (!passcodeSet) {
        reply.code(400);
        return {
          success: false,
          error: 'Passcode not configured. Use /auth/setup first.',
        };
      }

      setProtectionEnabled(true);
      return { success: true };
    }
  );

  /**
   * POST /auth/disable - Disable passcode protection (requires auth or root)
   */
  app.post(
    '/auth/disable',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Must be authenticated or root
      if (!isRunningAsRoot()) {
        const token = extractToken(request);
        if (!token) {
          reply.code(401);
          return {
            success: false,
            error: 'Authentication required to disable protection',
          };
        }

        const sessionManager = getSessionManager();
        const session = sessionManager.validateSession(token);
        if (!session) {
          reply.code(401);
          return {
            success: false,
            error: 'Invalid or expired token',
          };
        }
      }

      setProtectionEnabled(false);
      return { success: true };
    }
  );
}
