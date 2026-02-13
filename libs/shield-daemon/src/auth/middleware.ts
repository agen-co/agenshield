/**
 * Authentication middleware
 *
 * Protects routes that require authentication.
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { getStorage } from '@agenshield/storage';
import { getSessionManager } from './session';
import { isProtectionEnabled, isRunningAsRoot } from './passcode';

/**
 * Check if the vault is currently unlocked.
 * Returns false if storage is not yet initialized or vault is locked.
 */
export function isVaultUnlocked(): boolean {
  try {
    return getStorage().isUnlocked();
  } catch {
    return false;
  }
}

/**
 * Extract token from request
 * Checks Authorization header first, then query parameter
 */
export function extractToken(request: FastifyRequest): string | undefined {
  // Check Authorization header: "Bearer <token>"
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Check query parameter (for SSE connections)
  const query = request.query as Record<string, string>;
  if (query?.token) {
    return query.token;
  }

  return undefined;
}

/**
 * Check if request is authenticated
 * Returns true if:
 * - Protection is disabled
 * - Running as root (bypass)
 * - Valid session token provided
 */
export function isAuthenticated(request: FastifyRequest): boolean {
  // Root bypass
  if (isRunningAsRoot()) {
    return true;
  }

  // Protection disabled
  if (!isProtectionEnabled()) {
    return true;
  }

  // Check for valid session
  const token = extractToken(request);
  if (!token) {
    return false;
  }

  const sessionManager = getSessionManager();
  const session = sessionManager.validateSession(token);
  return session !== undefined;
}

/**
 * Authentication preHandler hook
 * Use this on routes that require authentication
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!isAuthenticated(request)) {
    reply.code(401).send({
      success: false,
      error: 'Authentication required',
      code: 'UNAUTHORIZED',
    });
    return;
  }
}

/**
 * Decorate Fastify instance with auth utilities
 */
export function decorateWithAuth(app: FastifyInstance): void {
  // Add request decorator to check if authenticated
  app.decorateRequest('isAuthenticated', false);

  // Add hook to set isAuthenticated on each request
  app.addHook('preHandler', async (request) => {
    (request as FastifyRequest & { isAuthenticated: boolean }).isAuthenticated = isAuthenticated(request);
  });
}

/**
 * Routes that should always be public (no auth required)
 */
export const PUBLIC_ROUTES = [
  '/api/health',
  '/api/status',
  '/api/config', // GET is public, PUT is protected
  '/api/security',
  '/api/secrets', // GET is public (read-only), POST/DELETE are protected
  '/api/auth/status',
  '/api/auth/unlock',
  '/api/auth/setup',
  '/api/auth/change',
];

/**
 * Routes that require authentication when protection is enabled
 */
export const PROTECTED_ROUTES = [
  { method: 'PUT', path: '/api/config' },
  { method: 'POST', path: '/api/wrappers' },
  { method: 'PUT', path: '/api/wrappers' },
  { method: 'DELETE', path: '/api/wrappers' },
  { method: 'POST', path: '/api/agenco/tool/run' },
  { method: 'POST', path: '/api/agenco/integrations/connect' },
  { method: 'POST', path: '/api/secrets' },
  { method: 'PATCH', path: '/api/secrets' },
  { method: 'DELETE', path: '/api/secrets' },
  { method: 'POST', path: '/api/config/factory-reset' },
  { method: 'POST', path: '/api/skills/install' },
  { method: 'GET', path: '/api/openclaw/dashboard-url' },
  { method: 'GET', path: '/api/config/openclaw' },
  { method: 'GET', path: '/api/config/openclaw/diff' },
  { method: 'GET', path: '/api/config/policies/instructions' },
];

/**
 * Check if a request matches a protected route
 */
export function isProtectedRoute(method: string, path: string): boolean {
  return PROTECTED_ROUTES.some(
    (route) => route.method === method && path.startsWith(route.path)
  );
}

/**
 * Global auth hook for selective route protection
 * Applies auth check to protected routes only
 */
export function createAuthHook() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const method = request.method;
    const path = request.url.split('?')[0]; // Remove query string

    // Skip auth for non-protected routes
    if (!isProtectedRoute(method, path)) {
      return;
    }

    // Check authentication
    if (!isAuthenticated(request)) {
      reply.code(401).send({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
      return;
    }
  };
}
