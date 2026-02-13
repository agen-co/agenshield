/**
 * Shield request context
 *
 * Flows through every HTTP request to carry multi-tenancy scope,
 * tracing metadata, and request origin information.
 */

export interface ShieldContext {
  /** UUID v4, auto-generated if not provided in request header */
  traceId: string;
  /** Agent/target scope — null when unscoped */
  targetId: string | null;
  /** Authenticated user — null for anonymous requests */
  userUsername: string | null;
  /** ISO 8601 timestamp of when the request was received */
  requestedAt: string;
  /** Origin of the request */
  source: ShieldRequestSource;
}

export type ShieldRequestSource = 'ui' | 'cli' | 'interceptor' | 'internal' | 'unknown';

export const SHIELD_HEADERS = {
  TRACE_ID: 'x-shield-trace-id',
  TARGET_ID: 'x-shield-target-id',
  USER: 'x-shield-user',
  SOURCE: 'x-shield-source',
} as const;
