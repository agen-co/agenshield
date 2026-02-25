/**
 * Authentication middleware
 *
 * JWT-based authentication using @agenshield/auth.
 * Protects routes that require authentication.
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import {
  createJwtAuthHook,
  extractBearerToken,
  verifyToken,
  type JwtPayload,
} from '@agenshield/auth';

/**
 * Extract token from request (Bearer header or query param)
 */
export function extractToken(request: FastifyRequest): string | undefined {
  return extractBearerToken(request);
}

/**
 * Check if request is authenticated via JWT.
 * Returns true if a valid JWT is present on the request.
 */
export async function isAuthenticated(request: FastifyRequest): Promise<boolean> {
  const token = extractToken(request);
  if (!token) return false;

  const result = await verifyToken(token);
  return result.valid;
}

/**
 * Get the JWT payload from a request (must be called after auth hook)
 */
export function getJwtPayload(request: FastifyRequest): JwtPayload | undefined {
  return request.jwtPayload;
}

/**
 * Authentication preHandler hook.
 * Wraps the JWT auth hook from @agenshield/auth.
 */
export function createAuthHook() {
  return createJwtAuthHook();
}

/**
 * Require authentication — preHandler hook that returns 401 if not authenticated
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authenticated = await isAuthenticated(request);
  if (!authenticated) {
    reply.code(401).send({
      success: false,
      error: 'Authentication required',
      code: 'UNAUTHORIZED',
    });
  }
}

/**
 * Decorate Fastify instance with auth utilities
 */
export function decorateWithAuth(app: FastifyInstance): void {
  app.decorateRequest('jwtPayload', undefined);
}

// Re-export for convenience
export { extractBearerToken, verifyToken } from '@agenshield/auth';
