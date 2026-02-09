/**
 * JSON-RPC endpoint for the interceptor
 *
 * Handles policy_check, events_batch, http_request, and ping methods.
 * Registered at root level (not under /api) so it skips auth middleware.
 */

import * as crypto from 'node:crypto';
import * as nodefs from 'node:fs';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SandboxConfig, PolicyExecutionContext, PolicyConfig, ShieldConfig } from '@agenshield/ipc';
import { loadConfig } from '../config/index';
import { emitInterceptorEvent, emitExecDenied } from '../events/emitter';
import {
  globToRegex,
  normalizeUrlBase,
  normalizeUrlTarget,
  matchUrlPattern,
  policyScopeMatches,
  extractCommandBasename,
  filterUrlPoliciesForCommand,
} from '../policy/url-matcher';
import { collectDenyPathsFromPolicies, collectAllowPathsForCommand } from '../policy/sandbox-helpers';
import { getProxyPool } from '../proxy/pool';

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

  // Normalize: extract basename from absolute command paths
  // e.g. "/usr/bin/curl https://david.com" → "curl https://david.com"
  let normalizedTarget = target;
  const firstSpace = target.indexOf(' ');
  const cmd = firstSpace >= 0 ? target.slice(0, firstSpace) : target;
  if (cmd.startsWith('/')) {
    const basename = cmd.split('/').pop() || cmd;
    normalizedTarget = firstSpace >= 0 ? basename + target.slice(firstSpace) : basename;
  }

  // Claude Code-style: ":*" suffix = prefix match with optional args
  if (trimmed.endsWith(':*')) {
    let prefix = trimmed.slice(0, -2);
    // Normalize: strip absolute path to basename (same as target normalization)
    if (prefix.includes('/')) {
      prefix = prefix.split('/').pop() || prefix;
    }
    const lowerTarget = normalizedTarget.toLowerCase();
    const lowerPrefix = prefix.toLowerCase();
    return lowerTarget === lowerPrefix || lowerTarget.startsWith(lowerPrefix + ' ');
  }

  // No ":*" = exact match (case-insensitive), normalize pattern too
  let normalizedPattern = trimmed;
  if (trimmed.includes('/')) {
    normalizedPattern = trimmed.split('/').pop() || trimmed;
  }
  return normalizedTarget.toLowerCase() === normalizedPattern.toLowerCase();
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

// Known commands that typically need network access
const NETWORK_COMMANDS = new Set([
  'curl', 'wget', 'git', 'npm', 'npx', 'yarn', 'pnpm',
  'pip', 'pip3', 'brew', 'apt', 'ssh', 'scp', 'rsync',
  'fetch', 'http', 'nc', 'ncat', 'node', 'deno', 'bun',
]);

/**
 * Determine the network access mode for a sandboxed command.
 *
 * Priority:
 * 1. Explicit networkAccess on matched policy
 * 2. Known network command → always proxy
 * 3. Default → none (non-network commands)
 */
function determineNetworkAccess(
  _config: ShieldConfig,
  matchedPolicy: PolicyConfig | undefined,
  target: string
): 'none' | 'proxy' | 'direct' {
  // 1. Explicit setting on matched policy
  if (matchedPolicy?.networkAccess) return matchedPolicy.networkAccess;

  // 2. Check if command is a known network command
  const cleanTarget = target.startsWith('fork:') ? target.slice(5) : target;
  const cmdPart = cleanTarget.split(' ')[0] || '';
  const basename = cmdPart.includes('/') ? cmdPart.split('/').pop()! : cmdPart;
  if (!NETWORK_COMMANDS.has(basename.toLowerCase())) return 'none';

  // 3. Always proxy network commands — the proxy enforces whatever URL policies exist.
  // With no URL policies, the proxy acts as a passthrough (default-allow).
  return 'proxy';
}

/**
 * Build a SandboxConfig for an approved exec operation.
 * Combines sensible defaults with context-based tightening.
 * May acquire a per-run proxy for network-enabled commands.
 */
async function buildSandboxConfig(
  config: ShieldConfig,
  matchedPolicy: PolicyConfig | undefined,
  _context: PolicyExecutionContext | undefined,
  target?: string
): Promise<SandboxConfig> {
  // Default sandbox config
  const sandbox: SandboxConfig = {
    enabled: true,
    allowedReadPaths: [],
    allowedWritePaths: [],
    deniedPaths: [],
    networkAllowed: false,
    allowedHosts: [],
    allowedPorts: [],
    allowedBinaries: [],
    deniedBinaries: [],
    envInjection: {},
    envDeny: [],
    envAllow: [],
    brokerHttpPort: config.broker?.httpPort,
  };

  // Always strip NODE_OPTIONS from sandboxed children to prevent
  // the interceptor from loading inside the sandbox (where TCP
  // to the broker may be blocked by the seatbelt profile).
  sandbox.envDeny.push('NODE_OPTIONS');

  // Extract command basename early for scope filtering (reused by proxy below)
  const commandBasename = target ? extractCommandBasename(target) : undefined;

  // Wire concrete filesystem deny paths from policies into seatbelt profile
  const concreteDenyPaths = collectDenyPathsFromPolicies(config.policies || [], commandBasename);
  if (concreteDenyPaths.length > 0) {
    console.log(`[sandbox] deniedPaths from policies: ${concreteDenyPaths.join(', ')}`);
    sandbox.deniedPaths.push(...concreteDenyPaths);
  }

  // Collect command-scoped filesystem allow paths
  if (commandBasename) {
    const { readPaths, writePaths } = collectAllowPathsForCommand(config.policies || [], commandBasename);
    if (readPaths.length > 0) {
      console.log(`[sandbox] allowedReadPaths for ${commandBasename}: ${readPaths.join(', ')}`);
      sandbox.allowedReadPaths.push(...readPaths);
    }
    if (writePaths.length > 0) {
      console.log(`[sandbox] allowedWritePaths for ${commandBasename}: ${writePaths.join(', ')}`);
      sandbox.allowedWritePaths.push(...writePaths);
    }
  }

  // Resolve the command binary and add to allowed binaries
  if (target) {
    // Strip fork: prefix if present
    const cleanTarget = target.startsWith('fork:') ? target.slice(5) : target;
    const cmd = cleanTarget.split(' ')[0];
    if (cmd) {
      if (cmd.startsWith('/')) {
        // Absolute path — use as-is
        sandbox.allowedBinaries.push(cmd);
        // macOS: /tmp → /private/tmp, resolve real path so seatbelt allows execution
        try {
          const realCmd = nodefs.realpathSync(cmd);
          if (realCmd !== cmd) sandbox.allowedBinaries.push(realCmd);
        } catch { /* command may not exist yet */ }
      }
      // No need for per-basename path variants — the profile-manager
      // already allows /bin, /sbin, /usr/bin, /usr/sbin, /usr/local/bin,
      // $HOME/homebrew, and $NVM_DIR as subpaths.
    }
  }

  // Always allow these essential binaries — resolve from agent home
  const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
  sandbox.allowedWritePaths.push(agentHome);
  sandbox.allowedBinaries.push(
    '/opt/agenshield/bin/',
    `${agentHome}/homebrew/`,            // agent's homebrew (bin + lib + Cellar)
    `${agentHome}/.nvm/`,                // agent's NVM (node versions + global packages)
    `${agentHome}/bin/`,                 // agent's wrapper scripts
  );

  // Deny access to OpenClaw internals (tokens, config, logs) but allow workspace (skills)
  const openclawDir = `${agentHome}/.openclaw`;
  sandbox.deniedPaths.push(openclawDir);
  sandbox.allowedReadPaths.push(`${openclawDir}/workspace`);

  // Determine network access mode
  const networkMode = determineNetworkAccess(config, matchedPolicy, target || '');
  console.log(`[sandbox] command="${(target || '').slice(0, 60)}" networkMode=${networkMode}`);

  if (networkMode === 'none') {
    sandbox.networkAllowed = false;
  } else if (networkMode === 'direct') {
    console.log(`[sandbox] direct network access (no proxy)`);
    sandbox.networkAllowed = true;
  } else if (networkMode === 'proxy') {
    // Acquire a per-run proxy bound to this execution
    const execId = crypto.randomUUID();
    // Filter URL policies scoped to this command (+ universal policies)
    const pool = getProxyPool();
    // Pass a getter so the proxy always evaluates the latest policies on each request
    const { port } = await pool.acquire(
      execId,
      target || '',
      () => filterUrlPoliciesForCommand((loadConfig().policies || []), commandBasename!),
      () => loadConfig().defaultAction ?? 'deny'
    );

    console.log(`[sandbox] proxy network: port=${port} command=${commandBasename} execId=${execId.slice(0, 8)}`);

    sandbox.networkAllowed = true;
    sandbox.allowedHosts = ['localhost'];
    sandbox.envInjection = {
      HTTP_PROXY: `http://127.0.0.1:${port}`,
      HTTPS_PROXY: `http://127.0.0.1:${port}`,
      ALL_PROXY: `http://127.0.0.1:${port}`,
      http_proxy: `http://127.0.0.1:${port}`,
      https_proxy: `http://127.0.0.1:${port}`,
      all_proxy: `http://127.0.0.1:${port}`,
      NO_PROXY: '',
      AGENSHIELD_EXEC_ID: execId,
    };
  }

  return sandbox;
}

/**
 * Evaluate a policy check against loaded config policies
 */
async function evaluatePolicyCheck(
  operation: string,
  target: string,
  context?: PolicyExecutionContext
): Promise<{ allowed: boolean; policyId?: string; reason?: string; sandbox?: SandboxConfig; executionContext?: PolicyExecutionContext }> {
  const config = loadConfig();
  const policies = config.policies || [];

  // Filter enabled policies that match scope, sort by priority desc
  const applicable = policies
    .filter((p) => p.enabled && policyScopeMatches(p, context))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const targetType = operationToTarget(operation);

  console.log('[policy_check] operation:', operation, 'target:', target, 'targetType:', targetType, 'context:', JSON.stringify(context));
  console.log('[policy_check] enabled policies (scope-filtered):', applicable.length);

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
        executionContext: context,
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
        // Directory patterns (ending with /) should match all contents
        let fsPattern = pattern;
        if (targetType === 'filesystem' && fsPattern.endsWith('/')) {
          fsPattern = fsPattern + '**';
        }
        const regex = globToRegex(fsPattern);
        matches = regex.test(effectiveTarget);
      }

      console.log('[policy_check]   pattern:', pattern, '-> base:', targetType === 'url' ? normalizeUrlBase(pattern) : pattern, '| target:', effectiveTarget, '| matches:', matches);

      if (matches) {
        console.log('[policy_check] MATCHED policy:', policy.name, 'action:', policy.action);
        const allowed = policy.action === 'allow';

        return {
          allowed,
          policyId: policy.id,
          reason: allowed
            ? `Allowed by policy: ${policy.name}`
            : `Denied by policy: ${policy.name}`,
          // Build sandbox config for allowed exec operations
          sandbox: allowed && operation === 'exec'
            ? await buildSandboxConfig(config, policy, context, target)
            : undefined,
          executionContext: context,
        };
      }
    }
  }

  // Default: use configured action
  const defaultAction = config.defaultAction ?? 'deny';
  console.log(`[policy_check] no matching policy, ${defaultAction} by default`);
  return {
    allowed: defaultAction === 'allow',
    reason: defaultAction === 'deny' ? 'No matching allow policy' : undefined,
    sandbox: operation === 'exec'
      ? await buildSandboxConfig(config, undefined, context, target)
      : undefined,
    executionContext: context,
  };
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

  // Policy check before proxying (Python patcher sends no context)
  const context = params['context'] as PolicyExecutionContext | undefined;
  const policyResult = await evaluatePolicyCheck('http_request', url, context);

  if (!policyResult.allowed) {
    emitInterceptorEvent({
      type: 'denied',
      operation: 'http_request',
      target: url,
      timestamp: new Date().toISOString(),
      policyId: policyResult.policyId,
      error: policyResult.reason || 'Denied by policy',
    });
    throw new Error(policyResult.reason || 'Blocked by URL policy');
  } else {
    emitInterceptorEvent({
      type: 'allowed',
      operation: 'http_request',
      target: url,
      timestamp: new Date().toISOString(),
      policyId: policyResult.policyId,
    });
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

type RpcHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

/**
 * Wrapper that emits SSE events after policy_check evaluation
 */
async function handlePolicyCheck(params: Record<string, unknown>) {
  const operation = String(params['operation'] ?? '');
  const target = String(params['target'] ?? '');
  const context = params['context'] as PolicyExecutionContext | undefined;

  const result = await evaluatePolicyCheck(operation, target, context);

  // Emit SSE events so policy check results appear in the Activity Feed immediately
  if (!result.allowed) {
    if (operation === 'exec') {
      emitExecDenied(target, result.reason || 'Denied by policy');
    } else {
      emitInterceptorEvent({
        type: 'denied',
        operation,
        target,
        timestamp: new Date().toISOString(),
        policyId: result.policyId,
        error: result.reason || 'Denied by policy',
      });
    }
  } else {
    emitInterceptorEvent({
      type: 'allowed',
      operation,
      target,
      timestamp: new Date().toISOString(),
      policyId: result.policyId,
    });
  }

  return result;
}

const handlers: Record<string, RpcHandler> = {
  policy_check: (params) => handlePolicyCheck(params),
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
