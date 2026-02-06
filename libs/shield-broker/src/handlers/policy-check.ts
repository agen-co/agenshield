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
import { forwardPolicyToDaemon } from '../daemon-forward.js';

interface PolicyCheckParams {
  operation: string;
  target: string;
}

interface PolicyCheckResultData {
  allowed: boolean;
  policyId?: string;
  reason?: string;
}

/** Default daemon RPC URL */
const DEFAULT_DAEMON_URL = 'http://127.0.0.1:5200';

export async function handlePolicyCheck(
  params: Record<string, unknown>,
  context: HandlerContext,
  deps: HandlerDependencies
): Promise<HandlerResult<PolicyCheckResultData>> {
  const { operation, target } = params as unknown as PolicyCheckParams;

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

  // If broker allows, return immediately
  if (result.allowed) {
    return {
      success: true,
      data: {
        allowed: result.allowed,
        policyId: result.policyId,
        reason: result.reason,
      },
    };
  }

  // Broker denied — forward to daemon RPC for user-defined policies
  const daemonUrl = deps.daemonUrl || DEFAULT_DAEMON_URL;
  const daemonResult = await forwardPolicyToDaemon(operation, target || '', daemonUrl);

  if (daemonResult) {
    // Daemon found an explicit user policy that allows this
    return {
      success: true,
      data: daemonResult,
    };
  }

  // Keep broker denial
  return {
    success: true,
    data: {
      allowed: result.allowed,
      policyId: result.policyId,
      reason: result.reason,
    },
  };
}
