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
  isAnonymousReadOnlyAllowed,
  setAnonymousReadOnly,
  isLockedOut,
  checkPasscode,
  setPasscode,
  recordFailedAttempt,
  clearFailedAttempts,
  isRunningAsRoot,
} from '../auth/passcode';
import { getSessionManager } from '../auth/session';
import { extractToken } from '../auth/middleware';
import { getStorage } from '@agenshield/storage';
import { syncSecrets } from '../secret-sync';
import { clearBrokerSecrets } from '../services/broker-bridge';
import { emitSecurityLocked } from '../events/emitter';
import { loadConfig } from '../config/index';

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
    const allowAnonymousReadOnly = isAnonymousReadOnlyAllowed();
    const lockoutStatus = isLockedOut();

    return {
      passcodeSet,
      protectionEnabled,
      allowAnonymousReadOnly,
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

      // Unlock storage-level encryption so secrets can be decrypted
      const storage = getStorage();
      if (storage.hasPasscode()) {
        storage.unlock(passcode);
      } else {
        // First unlock after migration — initialize storage-level encryption
        storage.setPasscode(passcode);
      }

      // Create session (also starts the idle auto-lock timer)
      const sessionManager = getSessionManager();
      const session = sessionManager.createSession();

      // Push decrypted secrets to broker now that vault is accessible
      syncSecrets(loadConfig().policies).catch(() => { /* non-fatal */ });

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

      // If no active sessions remain, lock storage and clear broker's in-memory secrets
      if (invalidated && sessionManager.getActiveSessions().length === 0) {
        getStorage().lock();
        clearBrokerSecrets().catch(() => { /* non-fatal */ });
        emitSecurityLocked('manual');
      }

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

      // Set passcode (daemon-level)
      await setPasscode(passcode);

      // Initialize storage-level encryption with same passcode
      const storage = getStorage();
      if (!storage.hasPasscode()) {
        storage.setPasscode(passcode);
      }

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

      // Set new passcode (daemon-level)
      await setPasscode(newPasscode);

      // Re-encrypt storage with the new passcode
      const storage = getStorage();
      if (storage.hasPasscode() && oldPasscode) {
        storage.changePasscode(oldPasscode, newPasscode);
      } else if (!storage.hasPasscode()) {
        storage.setPasscode(newPasscode);
      }

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

  /**
   * POST /auth/anonymous-readonly - Toggle anonymous read-only access (requires auth or root)
   */
  app.post<{ Body: { allowed: boolean } }>(
    '/auth/anonymous-readonly',
    async (request: FastifyRequest<{ Body: { allowed: boolean } }>, reply: FastifyReply) => {
      // Must be authenticated or root
      if (!isRunningAsRoot()) {
        const token = extractToken(request);
        if (!token) {
          reply.code(401);
          return {
            success: false,
            error: 'Authentication required to change anonymous access',
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

      const { allowed } = request.body;
      if (typeof allowed !== 'boolean') {
        reply.code(400);
        return {
          success: false,
          error: 'Invalid request: "allowed" must be a boolean',
        };
      }

      setAnonymousReadOnly(allowed);
      return { success: true, allowAnonymousReadOnly: allowed };
    }
  );
}
