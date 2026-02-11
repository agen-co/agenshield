/**
 * Fastify request context middleware
 *
 * Extracts ShieldContext from request headers and decorates
 * each request for multi-tenancy, tracing, and structured logging.
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SkillManager } from '@agentshield/skills';
import {
  type ShieldContext,
  type ShieldRequestSource,
  SHIELD_HEADERS,
} from '@agenshield/ipc';

// ---------- Fastify type augmentations ----------

declare module 'fastify' {
  interface FastifyRequest {
    shieldContext: ShieldContext;
  }
  interface FastifyInstance {
    skillManager: SkillManager;
    /** @deprecated Use skillManager instead — legacy SkillsManager for AgenCo sync */
    skillsManager?: {
      syncSource(source: string, connectionId: string): Promise<{ installed: string[]; removed: string[]; updated: string[] }>;
      registerSource(source: unknown): Promise<void>;
      [key: string]: unknown;
    };
  }
}

// ---------- Valid sources ----------

const VALID_SOURCES = new Set<ShieldRequestSource>([
  'ui',
  'cli',
  'interceptor',
  'internal',
  'unknown',
]);

// ---------- Context extraction ----------

/**
 * Extract ShieldContext from a Fastify request's headers.
 * Missing values get safe defaults (auto-generated traceId, null scope, 'unknown' source).
 */
export function extractShieldContext(request: FastifyRequest): ShieldContext {
  const headers = request.headers;

  const rawSource = (headers[SHIELD_HEADERS.SOURCE] as string | undefined) ?? '';
  const source: ShieldRequestSource = VALID_SOURCES.has(rawSource as ShieldRequestSource)
    ? (rawSource as ShieldRequestSource)
    : 'unknown';

  const traceId =
    (headers[SHIELD_HEADERS.TRACE_ID] as string | undefined) || crypto.randomUUID();
  const targetId =
    (headers[SHIELD_HEADERS.TARGET_ID] as string | undefined) || null;
  const userUsername =
    (headers[SHIELD_HEADERS.USER] as string | undefined) || null;

  return {
    traceId,
    targetId,
    userUsername,
    requestedAt: new Date().toISOString(),
    source,
  };
}

// ---------- Plugin registration ----------

/**
 * Register the ShieldContext decorator and onRequest hook.
 * Call this **before** any route registration so every handler
 * has access to `request.shieldContext`.
 */
export function registerShieldContext(app: FastifyInstance): void {
  // Decorate with a null placeholder so Fastify knows about the property
  // The value is set on every request via the onRequest hook below
  app.decorateRequest('shieldContext', null as unknown as ShieldContext);

  app.addHook('onRequest', (request, _reply, done) => {
    const ctx = extractShieldContext(request);
    request.shieldContext = ctx;

    // Enrich the request logger with context fields for structured logging
    request.log = request.log.child({
      traceId: ctx.traceId,
      targetId: ctx.targetId,
      user: ctx.userUsername,
    });

    done();
  });
}
