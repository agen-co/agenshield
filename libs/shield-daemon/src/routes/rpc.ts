/**
 * JSON-RPC endpoint for the interceptor
 *
 * Handles policy_check, events_batch, http_request, and ping methods.
 * Registered at root level (not under /api) so it skips auth middleware.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { loadConfig } from '../config/index';
import { emitInterceptorEvent } from '../events/emitter';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Convert a glob pattern to a RegExp (same algorithm as broker's PolicyEnforcer.matchPattern)
 */
function globToRegex(pattern: string): RegExp {
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars except * and ?
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/{{GLOBSTAR}}/g, '.*');

  return new RegExp(`^${regexPattern}$`, 'i');
}

/**
 * Match a command target against a Claude Code-style command pattern.
 *
 * Semantics:
 * - `git`         → exact match only "git" (no args)
 * - `git:*`       → matches "git" or "git <anything>"
 * - `git push`    → exact match "git push" only
 * - `git push:*`  → matches "git push" or "git push <anything>"
 * - `*`           → wildcard, matches any command
 *
 * No ** or ? glob syntax for commands.
 */
function matchCommandPattern(pattern: string, target: string): boolean {
  const trimmed = pattern.trim();

  // Wildcard: matches everything
  if (trimmed === '*') return true;

  // Claude Code-style: ":*" suffix = prefix match with optional args
  if (trimmed.endsWith(':*')) {
    const prefix = trimmed.slice(0, -2);
    const lowerTarget = target.toLowerCase();
    const lowerPrefix = prefix.toLowerCase();
    return lowerTarget === lowerPrefix || lowerTarget.startsWith(lowerPrefix + ' ');
  }

  // No ":*" = exact match (case-insensitive)
  return target.toLowerCase() === trimmed.toLowerCase();
}

/**
 * Normalize a URL pattern base:
 * - Strip trailing slashes
 * - If pattern is a bare domain (no protocol), prefix with https:// (HTTP is blocked by default)
 *
 * Does NOT append wildcards — the matching logic handles exact + sub-path matching.
 *
 * Examples:
 *   "example.com"           -> "https://example.com"
 *   "https://example.com/"  -> "https://example.com"
 *   "http://example.com"    -> "http://example.com" (explicit http preserved)
 *   "*://example.com/*"     -> "*://example.com/*" (wildcards preserved)
 */
function normalizeUrlBase(pattern: string): string {
  let p = pattern.trim();

  // Strip trailing slashes (but not from protocol)
  p = p.replace(/\/+$/, '');

  // If pattern doesn't start with a protocol or wildcard protocol, add https://
  // (HTTP is blocked by default - users must explicitly use http:// patterns)
  if (!p.match(/^(\*|https?):\/\//i)) {
    p = `https://${p}`;
  }

  return p;
}

/**
 * Match a URL target against a URL pattern.
 * For patterns without wildcards, matches both the exact URL and any sub-paths.
 * For patterns with wildcards, matches as-is.
 *
 * Examples:
 *   "https://example.com/api" matches "https://example.com/api" (exact)
 *   "https://example.com/api" matches "https://example.com/api/users" (sub-path)
 *   "https://example.com/api" does NOT match "https://example.com/api-evil"
 *   "https://example.com/*"   matches "https://example.com/anything"
 */
function matchUrlPattern(pattern: string, target: string): boolean {
  const base = normalizeUrlBase(pattern);
  const trimmed = pattern.trim().replace(/\/+$/, '');

  if (trimmed.endsWith('*')) {
    // User already provided wildcards — match as-is
    return globToRegex(base).test(target);
  }

  // No wildcards — match exact URL OR any sub-path
  return globToRegex(base).test(target) || globToRegex(`${base}/**`).test(target);
}

/**
 * Normalize a URL target for matching:
 * - Ensures there's always a path (at least '/') for matching against ** patterns
 * - Strips trailing slashes from paths (but keeps root '/')
 */
function normalizeUrlTarget(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    // Normalize path: URL constructor converts empty path to '/'
    let path = parsed.pathname;
    // Strip trailing slashes from paths longer than root, but keep root '/'
    if (path.length > 1) {
      path = path.replace(/\/+$/, '');
    }
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
  } catch {
    // Invalid URL, just strip trailing slashes
    return trimmed.replace(/\/+$/, '');
  }
}

/**
 * Map interceptor operations to policy target types
 */
function operationToTarget(operation: string): string {
  switch (operation) {
    case 'http_request':
      return 'url';
    case 'exec':
      return 'command';
    case 'file_read':
    case 'file_write':
    case 'file_list':
      return 'filesystem';
    default:
      return operation;
  }
}

/**
 * Evaluate a policy check against loaded config policies
 */
function evaluatePolicyCheck(
  operation: string,
  target: string
): { allowed: boolean; policyId?: string; reason?: string } {
  const config = loadConfig();
  const policies = config.policies || [];

  // Filter enabled policies, sort by priority desc
  const applicable = policies
    .filter((p) => p.enabled)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const targetType = operationToTarget(operation);

  console.log('[policy_check] operation:', operation, 'target:', target, 'targetType:', targetType);
  console.log('[policy_check] enabled policies:', applicable.length);

  // Block plain HTTP requests by default (security best practice)
  if (targetType === 'url' && target.match(/^http:\/\//i)) {
    // Check if there's an explicit allow policy for this HTTP URL first
    let explicitHttpAllow = false;
    for (const policy of applicable) {
      if (policy.target !== 'url' || policy.action !== 'allow') continue;
      for (const pattern of policy.patterns) {
        // Only check patterns that explicitly allow http://
        if (!pattern.match(/^http:\/\//i)) continue;
        const effectiveTarget = normalizeUrlTarget(target);
        if (matchUrlPattern(pattern, effectiveTarget)) {
          explicitHttpAllow = true;
          break;
        }
      }
      if (explicitHttpAllow) break;
    }

    if (!explicitHttpAllow) {
      console.log('[policy_check] DENIED: plain HTTP blocked by default (use HTTPS or add explicit http:// allow policy)');
      return {
        allowed: false,
        reason: 'Plain HTTP is blocked by default. Use HTTPS or create an explicit http:// allow policy.',
      };
    }
  }

  for (const policy of applicable) {
    // Check if policy target type matches
    if (policy.target !== targetType) continue;

    // Check if operations filter matches (if specified)
    if (policy.operations && policy.operations.length > 0) {
      if (!policy.operations.includes(operation)) continue;
    }

    console.log('[policy_check] checking policy:', policy.name, 'target:', policy.target, 'action:', policy.action);

    // Check if target matches any pattern
    for (const pattern of policy.patterns) {
      const effectiveTarget = targetType === 'url' ? normalizeUrlTarget(target) : target;

      let matches: boolean;
      if (targetType === 'url') {
        matches = matchUrlPattern(pattern, effectiveTarget);
      } else if (targetType === 'command') {
        matches = matchCommandPattern(pattern, effectiveTarget);
      } else {
        const regex = globToRegex(pattern);
        matches = regex.test(effectiveTarget);
      }

      console.log('[policy_check]   pattern:', pattern, '-> base:', targetType === 'url' ? normalizeUrlBase(pattern) : pattern, '| target:', effectiveTarget, '| matches:', matches);

      if (matches) {
        console.log('[policy_check] MATCHED policy:', policy.name, 'action:', policy.action);
        return {
          allowed: policy.action === 'allow',
          policyId: policy.id,
          reason: policy.action === 'allow'
            ? `Allowed by policy: ${policy.name}`
            : `Denied by policy: ${policy.name}`,
        };
      }
    }
  }

  // Default: allow (no matching policy)
  console.log('[policy_check] no matching policy, allowing by default');
  return { allowed: true };
}

/**
 * Handle events_batch: broadcast each interceptor event via SSE
 */
function handleEventsBatch(params: Record<string, unknown>): { received: number } {
  const events = params['events'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(events)) {
    return { received: 0 };
  }

  for (const event of events) {
    emitInterceptorEvent({
      type: String(event['type'] ?? 'unknown'),
      operation: String(event['operation'] ?? ''),
      target: String(event['target'] ?? ''),
      timestamp: String(event['timestamp'] ?? new Date().toISOString()),
      duration: typeof event['duration'] === 'number' ? event['duration'] : undefined,
      policyId: typeof event['policyId'] === 'string' ? event['policyId'] : undefined,
      error: typeof event['error'] === 'string' ? event['error'] : undefined,
    });
  }

  return { received: events.length };
}

/**
 * Handle http_request: proxy an HTTP request via native fetch
 */
async function handleHttpRequest(
  params: Record<string, unknown>
): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string }> {
  const url = String(params['url'] ?? '');
  const method = String(params['method'] ?? 'GET').toUpperCase();
  const headers = (params['headers'] as Record<string, string>) ?? {};
  const body = params['body'] as string | undefined;

  const response = await fetch(url, {
    method,
    headers,
    body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
  });

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  const responseBody = await response.text();

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: responseBody,
  };
}

type RpcHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

const handlers: Record<string, RpcHandler> = {
  policy_check: (params) =>
    evaluatePolicyCheck(
      String(params['operation'] ?? ''),
      String(params['target'] ?? '')
    ),
  events_batch: (params) => handleEventsBatch(params),
  http_request: (params) => handleHttpRequest(params),
  ping: () => ({ status: 'ok' }),
};

export async function rpcRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/rpc',
    async (
      request: FastifyRequest<{ Body: JsonRpcRequest }>,
      reply: FastifyReply
    ): Promise<JsonRpcResponse> => {
      const { id, method, params } = request.body ?? {} as Partial<JsonRpcRequest>;

      if (!id || !method) {
        reply.code(400);
        return {
          jsonrpc: '2.0',
          id: id ?? 'unknown',
          error: { code: -32600, message: 'Invalid request' },
        };
      }

      const handler = handlers[method];
      if (!handler) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
      }

      try {
        const result = await handler(params ?? {});
        return { jsonrpc: '2.0', id, result };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : 'Internal error',
          },
        };
      }
    }
  );
}
