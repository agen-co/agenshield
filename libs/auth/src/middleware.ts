/**
 * Fastify JWT auth middleware
 *
 * Creates a Fastify preHandler hook that verifies JWTs on incoming requests.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from './verify';
import type { JwtPayload, JwtAuthHookOptions } from './types';
import { isPublicRoute, isAdminOnlyRoute } from './roles';

/**
 * Augment Fastify request with JWT payload
 */
declare module 'fastify' {
  interface FastifyRequest {
    jwtPayload?: JwtPayload;
  }
}

/**
 * Extract Bearer token from request headers or query parameter
 */
export function extractBearerToken(request: FastifyRequest): string | undefined {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Fallback: query param (for SSE connections)
  const query = request.query as Record<string, string>;
  if (query?.token) {
    return query.token;
  }

  return undefined;
}

/**
 * Create a Fastify preHandler hook for JWT authentication.
 *
 * - Public routes: no auth required
 * - Admin-only routes: require admin JWT
 * - All other routes: require any valid JWT (admin or broker)
 */
export function createJwtAuthHook(options?: JwtAuthHookOptions) {
  const publicRoutes = options?.publicRoutes ?? [];
  const adminOnlyRoutes = options?.adminOnlyRoutes ?? [];

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const urlPath = request.url.split('?')[0];

    // Skip auth for public routes
    if (isPublicRoute(urlPath) || publicRoutes.some((r) => urlPath.startsWith(r))) {
      return;
    }

    // Extract token
    const token = extractBearerToken(request);
    if (!token) {
      reply.code(401).send({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    // Verify JWT
    const result = await verifyToken(token);
    if (!result.valid || !result.payload) {
      const statusCode = result.error?.includes('expired') ? 401 : 401;
      reply.code(statusCode).send({
        success: false,
        error: result.error ?? 'Invalid token',
        code: result.error?.includes('expired') ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      });
      return;
    }

    // Attach payload to request
    request.jwtPayload = result.payload;

    // Check admin-only routes
    const method = request.method;
    const isAdminRequired =
      isAdminOnlyRoute(method, urlPath) ||
      adminOnlyRoutes.some((r) => r.method === method && urlPath.startsWith(r.path));

    if (isAdminRequired && result.payload.role !== 'admin') {
      reply.code(403).send({
        success: false,
        error: 'Admin access required',
        code: 'INSUFFICIENT_PERMISSIONS',
      });
      return;
    }
  };
}
