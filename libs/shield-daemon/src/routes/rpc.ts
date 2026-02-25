/**
 * JSON-RPC endpoint for the interceptor
 *
 * Handles policy_check, events_batch, http_request, and ping methods.
 * Registered at root level (not under /api) so it skips auth middleware.
 *
 * Policy evaluation is delegated to @agenshield/policies PolicyManager.
 * Sandbox config built via @agenshield/seatbelt.
 * Trace store tracks execution chains for blueprint validation.
 */

import * as crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SandboxConfig, PolicyExecutionContext, PolicyConfig } from '@agenshield/ipc';
import { SHIELD_HEADERS } from '@agenshield/ipc';
import { getStorage } from '@agenshield/storage';
import { buildSandboxConfig } from '@agenshield/seatbelt';
import type { SharedCapabilities } from '@agenshield/seatbelt';
import { filterUrlPoliciesForCommand } from '@agenshield/policies';
import { loadConfig } from '../config/index';
import { emitInterceptorEvent, emitExecDenied, emitESExecEvent, emitSecurityWarning, emitEvent, emitResourceWarning, emitResourceLimitEnforced } from '../events/emitter';
import { resolveProfileByToken } from '../services/profile-token';
import { getPolicyManager } from '../services/policy-manager';
import { getProxyPool } from '../proxy/pool';
import { getTraceStore } from '../services/trace-store';
import type { ExecutionTrace } from '../services/trace-store';

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

/** Maximum depth of nested execution chains */
const MAX_TRACE_DEPTH = 10;

/* ---- ES Extension: Execution Chain Tracking ---- */

interface SessionExecRecord {
  binary: string;
  args: string;
  timestamp: number;
  allowed: boolean;
  pid: number;
}

/** Audit session ID → ordered list of execs in that session */
const sessionChains = new Map<number, SessionExecRecord[]>();

/** Max idle time (ms) before a session is pruned */
const SESSION_MAX_IDLE_MS = 5 * 60 * 1000;

/** Rapid exec threshold: more than this many execs in 1 second is suspicious */
const RAPID_EXEC_THRESHOLD = 10;

/**
 * Record an exec from the ES extension and check for suspicious patterns.
 */
function trackESExec(context: PolicyExecutionContext, target: string, allowed: boolean): void {
  const sessionId = context.esSessionId;
  if (sessionId == null) return;

  const now = Date.now();
  const parts = target.split(' ');
  const binary = parts[0] || target;
  const args = parts.slice(1).join(' ');

  const record: SessionExecRecord = {
    binary,
    args,
    timestamp: now,
    allowed,
    pid: context.esPid ?? 0,
  };

  // Get or create session chain
  let chain = sessionChains.get(sessionId);
  if (!chain) {
    chain = [];
    sessionChains.set(sessionId, chain);
  }
  chain.push(record);

  // Detect suspicious patterns
  // 1. Rapid chaining: >RAPID_EXEC_THRESHOLD execs in 1 second
  const recentExecs = chain.filter(r => now - r.timestamp < 1000);
  if (recentExecs.length > RAPID_EXEC_THRESHOLD) {
    emitSecurityWarning(
      `Rapid exec chain detected: ${recentExecs.length} execs in 1s from session ${sessionId} (user: ${context.esUser || 'unknown'})`
    );
  }

  // Prune stale sessions
  for (const [sid, records] of sessionChains) {
    const lastExec = records[records.length - 1];
    if (lastExec && now - lastExec.timestamp > SESSION_MAX_IDLE_MS) {
      sessionChains.delete(sid);
    }
  }
}

/**
 * Fire deferred activations when a trace completes (sequential constraint).
 */
function onTraceCompleted(trace: ExecutionTrace): void {
  if (!trace.deferredActivations?.length) return;

  try {
    const storage = getStorage();
    const graphRepo = storage.policyGraph;
    const graph = graphRepo.loadGraph();

    for (const deferred of trace.deferredActivations) {
      // If the edge has activationDurationMs, apply TTL starting NOW
      const edge = graph.edges.find(e => e.id === deferred.edgeId);
      const expiresAt = edge?.activationDurationMs
        ? new Date(Date.now() + edge.activationDurationMs).toISOString()
        : undefined;
      graphRepo.activate({ edgeId: deferred.edgeId, expiresAt });
    }

    // Recompile so new activations take effect
    getPolicyManager().recompile();
  } catch (err) {
    console.warn(
      '[trace] Failed to fire deferred activations:',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Resolve secrets by name from scoped storage vault.
 */
function resolveSecretsFromVault(names: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const storage = getStorage();
    const secrets = storage.secrets;
    for (const name of names) {
      try {
        const secret = secrets.getByName(name);
        if (secret?.value) {
          result[name] = secret.value;
        }
      } catch { /* vault locked or secret not found */ }
    }
  } catch { /* storage not available */ }
  return result;
}

/**
 * Evaluate a policy check via PolicyManager.
 *
 * When profileId is provided, policies are loaded from scoped storage
 * (UNION: global + profile-specific) and the policy graph is consulted
 * for dormant policy activation and edge effects.
 *
 * Integrates trace store for execution chain tracking and blueprint validation.
 */
export async function evaluatePolicyCheck(
  operation: string,
  target: string,
  context?: PolicyExecutionContext,
  profileId?: string,
): Promise<{ allowed: boolean; policyId?: string; reason?: string; sandbox?: SandboxConfig; executionContext?: PolicyExecutionContext; traceId?: string }> {
  const config = loadConfig();
  const manager = getPolicyManager();
  const traceStore = getTraceStore();
  const depth = context?.depth ?? 0;

  console.log('[policy_check] operation:', operation, 'target:', target, 'profileId:', profileId ?? 'none', 'context:', JSON.stringify(context));

  // Max depth guard
  if (depth > MAX_TRACE_DEPTH) {
    console.warn(`[policy_check] Max execution depth exceeded: depth=${depth} target=${target}`);
    return {
      allowed: false,
      reason: `Max execution depth exceeded (${depth} > ${MAX_TRACE_DEPTH})`,
      executionContext: context,
    };
  }

  // Use live evaluation which hits DB for graph activations + secrets
  const result = manager.evaluateLive({
    operation,
    target,
    context,
    profileId,
    defaultAction: config.defaultAction,
  });

  console.log(`[policy_check] result: allowed=${result.allowed}, policyId=${result.policyId ?? 'none'}, reason=${result.reason ?? 'none'}`);

  // Generate trace ID for this execution
  const traceId = crypto.randomUUID();
  let sharedCapabilities: SharedCapabilities | undefined;
  let graphNodeId: string | undefined;

  // Blueprint validation: if parent trace exists, validate graph path
  if (context?.parentTraceId && result.policyId) {
    const parentTrace = traceStore.get(context.parentTraceId);
    if (parentTrace?.graphNodeId) {
      // Find the graph node for the matched policy
      try {
        const storage = getStorage();
        const graph = storage.policyGraph.loadGraph();
        const matchedNode = graph.nodes.find(n => n.policyId === result.policyId);

        if (matchedNode) {
          graphNodeId = matchedNode.id;

          // Check if there's a valid edge from parent to child
          const validEdge = graph.edges.find(
            e => e.sourceNodeId === parentTrace.graphNodeId &&
                 e.targetNodeId === matchedNode.id &&
                 e.enabled,
          );

          if (!validEdge) {
            // No edge in the graph — anomaly (command not in expected graph path)
            emitEvent('trace:anomaly', {
              traceId,
              parentTraceId: context.parentTraceId,
              command: target,
              reason: 'Command not in expected graph path',
              severity: 'warning',
            }, profileId);
          }

          // Check sequential constraint: deny if parent is still running
          const sequentialEdge = graph.edges.find(
            e => e.sourceNodeId === parentTrace.graphNodeId &&
                 e.targetNodeId === matchedNode.id &&
                 e.enabled &&
                 e.constraint === 'sequential',
          );
          if (sequentialEdge && parentTrace.status === 'running') {
            return {
              allowed: false,
              policyId: result.policyId,
              reason: 'Sequential constraint: parent execution still running',
              executionContext: context,
            };
          }

          // Compute shared capabilities from parent via edge config
          sharedCapabilities = traceStore.getSharedCapabilities(
            context.parentTraceId,
            matchedNode.id,
            graph,
          );
        }
      } catch {
        // Graph not available — skip blueprint validation
      }
    }
  }

  // Look up matched policy for sandbox config
  const matchedPolicy = result.policyId ? manager.getById(result.policyId) ?? undefined : undefined;

  // Build sandbox config using @agenshield/seatbelt
  let sandbox: SandboxConfig | undefined;
  if (result.allowed && operation === 'exec') {
    sandbox = await buildSandboxConfig(
      {
        acquireProxy: async (execId, cmd, policies, defaultAction) => {
          const pool = getProxyPool();
          return pool.acquire(
            execId,
            cmd,
            () => policies,
            () => defaultAction as 'allow' | 'deny',
          );
        },
        resolveSecrets: (names) => resolveSecretsFromVault(names),
        getPolicies: () => config.policies || [],
        defaultAction: config.defaultAction ?? 'deny',
        agentHome: process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent',
        brokerHttpPort: config.broker?.httpPort,
        resourceMonitoring: config.resourceMonitoring,
      },
      {
        matchedPolicy,
        context,
        target,
        effects: result.effects,
        traceId,
        depth,
        sharedCapabilities,
      },
    );
  }

  // Store trace record
  const trace: ExecutionTrace = {
    traceId,
    parentTraceId: context?.parentTraceId,
    command: target,
    policyId: result.policyId,
    graphNodeId,
    deferredActivations: result.effects?.deferredActivations,
    profileId,
    depth,
    status: 'running',
    startedAt: Date.now(),
  };
  traceStore.create(trace);

  // Emit trace started event
  emitEvent('trace:started', {
    traceId,
    parentTraceId: context?.parentTraceId,
    command: target,
    depth,
    policyId: result.policyId,
    graphNodeId,
    allowed: result.allowed,
  }, profileId);

  return {
    allowed: result.allowed,
    policyId: result.policyId,
    reason: result.reason,
    sandbox,
    executionContext: context,
    traceId,
  };
}

/**
 * Handle events_batch: broadcast each interceptor event via SSE
 */
function handleEventsBatch(params: Record<string, unknown>, profileId?: string): { received: number } {
  const events = params['events'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(events)) {
    return { received: 0 };
  }

  for (const event of events) {
    const operation = String(event['operation'] ?? '');
    const errorStr = typeof event['error'] === 'string' ? event['error'] : undefined;

    // Detect resource monitoring events and emit typed events
    if ((operation === 'resource_warning' || operation === 'resource_limit_enforced') && errorStr) {
      try {
        const data = JSON.parse(errorStr);
        if (operation === 'resource_warning') {
          emitResourceWarning(data, profileId);
        } else {
          emitResourceLimitEnforced(data, profileId);
        }
      } catch {
        // Fall through to standard event emission
      }
    }

    emitInterceptorEvent({
      type: String(event['type'] ?? 'unknown'),
      operation,
      target: String(event['target'] ?? ''),
      timestamp: String(event['timestamp'] ?? new Date().toISOString()),
      duration: typeof event['duration'] === 'number' ? event['duration'] : undefined,
      policyId: typeof event['policyId'] === 'string' ? event['policyId'] : undefined,
      error: errorStr,
    }, profileId);
  }

  return { received: events.length };
}

/**
 * Handle http_request: proxy an HTTP request via native fetch
 */
async function handleHttpRequest(
  params: Record<string, unknown>,
  profileId?: string,
): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string }> {
  const url = String(params['url'] ?? '');
  const method = String(params['method'] ?? 'GET').toUpperCase();
  const headers = (params['headers'] as Record<string, string>) ?? {};
  const body = params['body'] as string | undefined;

  // Policy check before proxying (Python patcher sends no context)
  const context = params['context'] as PolicyExecutionContext | undefined;
  const policyResult = await evaluatePolicyCheck('http_request', url, context, profileId);

  if (!policyResult.allowed) {
    emitInterceptorEvent({
      type: 'denied',
      operation: 'http_request',
      target: url,
      timestamp: new Date().toISOString(),
      policyId: policyResult.policyId,
      error: policyResult.reason || 'Denied by policy',
    }, profileId);
    throw new Error(policyResult.reason || 'Blocked by URL policy');
  } else {
    emitInterceptorEvent({
      type: 'allowed',
      operation: 'http_request',
      target: url,
      timestamp: new Date().toISOString(),
      policyId: policyResult.policyId,
    }, profileId);
  }

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

export type RpcHandler = (params: Record<string, unknown>, profileId?: string) => unknown | Promise<unknown>;

/**
 * Wrapper that emits SSE events after policy_check evaluation
 */
async function handlePolicyCheck(params: Record<string, unknown>, profileId?: string) {
  const operation = String(params['operation'] ?? '');
  const target = String(params['target'] ?? '');
  const context = params['context'] as PolicyExecutionContext | undefined;

  const result = await evaluatePolicyCheck(operation, target, context, profileId);

  // ES extension: track exec chain and emit dedicated event
  if (context?.sourceLayer === 'es-extension' && operation === 'exec') {
    trackESExec(context, target, result.allowed);

    const parts = target.split(' ');
    emitESExecEvent({
      binary: parts[0] || target,
      args: parts.slice(1).join(' '),
      pid: context.esPid ?? 0,
      ppid: context.esPpid ?? 0,
      sessionId: context.esSessionId ?? 0,
      user: context.esUser ?? 'unknown',
      allowed: result.allowed,
      policyId: result.policyId,
      reason: result.reason,
      sourceLayer: 'es-extension',
    }, profileId);
  }

  // Emit SSE events so policy check results appear in the Activity Feed immediately
  if (!result.allowed) {
    if (operation === 'exec') {
      emitExecDenied(target, result.reason || 'Denied by policy', profileId);
    } else {
      emitInterceptorEvent({
        type: 'denied',
        operation,
        target,
        timestamp: new Date().toISOString(),
        policyId: result.policyId,
        error: result.reason || 'Denied by policy',
      }, profileId);
    }
  } else {
    emitInterceptorEvent({
      type: 'allowed',
      operation,
      target,
      timestamp: new Date().toISOString(),
      policyId: result.policyId,
    }, profileId);
  }

  return result;
}

export const rpcHandlers: Record<string, RpcHandler> = {
  policy_check: (params, profileId) => handlePolicyCheck(params, profileId),
  events_batch: (params, profileId) => handleEventsBatch(params, profileId),
  http_request: (params, profileId) => handleHttpRequest(params, profileId),
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

      // Resolve profileId from broker token header (HTTP channel)
      let profileId: string | undefined;
      const token = request.headers[SHIELD_HEADERS.BROKER_TOKEN] as string | undefined;
      if (token) {
        const resolved = await resolveProfileByToken(token, getStorage());
        if (!resolved) {
          reply.code(401);
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32001, message: 'Invalid broker token' },
          };
        }
        profileId = resolved;
      }
      // Also accept explicit profile ID header (lower priority than token)
      if (!profileId) {
        const headerProfileId = request.headers[SHIELD_HEADERS.PROFILE_ID] as string | undefined;
        if (headerProfileId) profileId = headerProfileId;
      }

      // Extract inline identity from params (socket transport fallback).
      // SyncClient embeds __profileId / __brokerToken in params when using
      // socket transport that doesn't pass HTTP headers.
      const cleanParams = { ...(params ?? {}) };
      if (!profileId && cleanParams.__brokerToken) {
        const inlineToken = String(cleanParams.__brokerToken);
        const resolved = await resolveProfileByToken(inlineToken, getStorage());
        if (resolved) profileId = resolved;
      }
      if (!profileId && cleanParams.__profileId) {
        profileId = String(cleanParams.__profileId);
      }
      delete cleanParams.__profileId;
      delete cleanParams.__brokerToken;

      const handler = rpcHandlers[method];
      if (!handler) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
      }

      try {
        const result = await handler(cleanParams, profileId);
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
