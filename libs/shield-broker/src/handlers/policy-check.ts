/**
 * Policy Check Handler
 *
 * Handles policy_check RPC calls from the interceptor.
 * The interceptor sends { operation, target } and this handler
 * evaluates the inner operation against the policy enforcer.
 *
 * If the broker's enforcer denies the request, we forward to the
 * daemon's RPC endpoint which checks user-defined policies.
 */

import type { HandlerContext, HandlerResult } from '../types.js';
import type { HandlerDependencies } from './types.js';
import type { SandboxConfig, PolicyExecutionContext } from '@agenshield/ipc';
import { forwardPolicyToDaemon } from '../daemon-forward.js';

interface PolicyCheckParams {
  operation: string;
  target: string;
  context?: PolicyExecutionContext;
}

interface PolicyCheckResultData {
  allowed: boolean;
  policyId?: string;
  reason?: string;
  sandbox?: SandboxConfig;
  executionContext?: PolicyExecutionContext;
}

/** Default daemon RPC URL */
const DEFAULT_DAEMON_URL = 'http://127.0.0.1:5200';

export async function handlePolicyCheck(
  params: Record<string, unknown>,
  context: HandlerContext,
  deps: HandlerDependencies
): Promise<HandlerResult<PolicyCheckResultData>> {
  const { operation, target, context: execContext } = params as unknown as PolicyCheckParams;

  if (!operation) {
    return {
      success: false,
      error: { code: -32602, message: 'Missing required parameter: operation' },
    };
  }

  // Map the interceptor's generic `target` to the param key the enforcer's
  // extractTarget() expects for each operation type.
  let checkParams: Record<string, unknown>;
  switch (operation) {
    case 'http_request':
    case 'open_url':
      checkParams = { url: target || '' };
      break;
    case 'file_read':
    case 'file_write':
    case 'file_list':
      checkParams = { path: target || '' };
      break;
    case 'exec':
      checkParams = { command: target || '' };
      break;
    case 'secret_inject':
      checkParams = { name: target || '' };
      break;
    default:
      checkParams = { target: target || '' };
      break;
  }

  // Evaluate the inner operation against broker policies
  const result = await deps.policyEnforcer.check(operation, checkParams, context);

  if (result.allowed) {
    // For exec operations, always forward to daemon to acquire sandbox config
    // (proxy port, seatbelt profile, env injection). Without this, child
    // processes run unsandboxed and cannot reach the network through the proxy.
    if (operation === 'exec') {
      const daemonUrl = deps.daemonUrl || DEFAULT_DAEMON_URL;
      const daemonResult = await forwardPolicyToDaemon(
        operation, target || '', daemonUrl, execContext
      );
      if (daemonResult) {
        return {
          success: true,
          data: {
            allowed: daemonResult.allowed,
            policyId: daemonResult.policyId || result.policyId,
            reason: daemonResult.reason || result.reason,
            sandbox: daemonResult.sandbox,
            executionContext: daemonResult.executionContext,
          },
        };
      }
    }

    // Non-exec fast path — broker allowed, no sandbox needed.
    return {
      success: true,
      data: {
        allowed: true,
        policyId: result.policyId,
        reason: result.reason,
      },
    };
  }

  // Broker denied — forward to daemon to check for user-defined allow override
  const daemonUrl = deps.daemonUrl || DEFAULT_DAEMON_URL;
  const daemonResult = await forwardPolicyToDaemon(operation, target || '', daemonUrl, execContext);

  if (daemonResult && daemonResult.allowed) {
    return {
      success: true,
      data: {
        allowed: daemonResult.allowed,
        policyId: daemonResult.policyId,
        reason: daemonResult.reason,
        sandbox: daemonResult.sandbox,
        executionContext: daemonResult.executionContext,
      },
    };
  }

  // Keep broker denial
  return {
    success: true,
    data: {
      allowed: false,
      policyId: result.policyId,
      reason: result.reason,
    },
  };
}
