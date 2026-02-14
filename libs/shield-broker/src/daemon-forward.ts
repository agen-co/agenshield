/**
 * Daemon Policy Forwarding
 *
 * Shared module for forwarding policy checks to the daemon's RPC endpoint.
 * Used by both the policy_check handler and the top-level processRequest()
 * in server.ts / http-fallback.ts when the broker's local enforcer denies
 * a request but the daemon may have a user-defined policy that allows it.
 *
 * Supports dual-protocol: per-profile Unix socket (primary) + HTTP with
 * bearer token (fallback).
 */

import * as net from 'node:net';
import type { SandboxConfig, PolicyExecutionContext } from '@agenshield/ipc';
import type { BrokerAuth } from './handlers/types.js';

/** Timeout for daemon RPC calls (ms) */
const DAEMON_RPC_TIMEOUT = 2000;

export interface DaemonPolicyResult {
  allowed: boolean;
  policyId?: string;
  reason?: string;
  sandbox?: SandboxConfig;
  executionContext?: PolicyExecutionContext;
}

/**
 * Send a JSON-RPC request over a Unix socket (newline-delimited JSON).
 * Returns parsed result or null on failure.
 */
async function trySocketForward(
  socketPath: string,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown | null> {
  return new Promise<unknown | null>((resolve) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, DAEMON_RPC_TIMEOUT);

    const socket = net.createConnection(socketPath, () => {
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: `broker-fwd-${Date.now()}`,
        method,
        params,
      });
      socket.write(request + '\n');
    });

    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString();
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex !== -1) {
        clearTimeout(timeout);
        const line = buffer.slice(0, newlineIndex);
        socket.destroy();
        try {
          const response = JSON.parse(line) as { result?: unknown; error?: unknown };
          if (response.error || response.result === undefined) {
            resolve(null);
          } else {
            resolve(response.result);
          }
        } catch {
          resolve(null);
        }
      }
    });

    socket.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

/**
 * Forward a policy check to the daemon's RPC endpoint.
 *
 * The daemon evaluates user-defined policies (created in the UI).
 * We only accept the daemon's result if it returns `allowed: true`
 * AND includes a `policyId` (explicit user policy match).
 * A default-allow (no policyId) is NOT trusted — we keep the broker denial.
 *
 * @returns The daemon's result if it explicitly allows, or null to keep broker denial.
 */
export async function forwardPolicyToDaemon(
  operation: string,
  target: string,
  daemonUrl: string,
  context?: PolicyExecutionContext,
  brokerAuth?: BrokerAuth,
): Promise<DaemonPolicyResult | null> {
  const verbose = process.env['AGENSHIELD_BROKER_VERBOSE'] === 'true';
  try {
    if (verbose) console.error(`[broker:forward] op=${operation} target=${target} → daemon ${daemonUrl}`);

    const params = { operation, target, context };

    // 1. Try per-profile daemon socket (if path provided)
    if (brokerAuth?.daemonSocketPath) {
      const socketResult = await trySocketForward(
        brokerAuth.daemonSocketPath,
        'policy_check',
        params,
      );
      if (socketResult !== null) {
        return interpretDaemonResult(socketResult as Record<string, unknown>, verbose, operation);
      }
      // Socket failed — fall through to HTTP
    }

    // 2. HTTP fallback with token header
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DAEMON_RPC_TIMEOUT);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (brokerAuth?.token) {
      headers['x-shield-broker-token'] = brokerAuth.token;
    }
    if (brokerAuth?.profileId) {
      headers['x-shield-profile-id'] = brokerAuth.profileId;
    }

    const response = await fetch(`${daemonUrl}/rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `broker-fwd-${Date.now()}`,
        method: 'policy_check',
        params,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as {
      result?: Record<string, unknown>;
      error?: { message?: string };
    };

    if (json.error || !json.result) {
      return null;
    }

    return interpretDaemonResult(json.result, verbose, operation);
  } catch {
    // Daemon unreachable or timeout — keep broker denial
    return null;
  }
}

/**
 * Forward an events batch to the daemon (fire-and-forget).
 */
export function forwardEventsToDaemon(
  events: Array<Record<string, unknown>>,
  daemonUrl: string,
  brokerAuth?: BrokerAuth,
): void {
  const params = { events };

  // Try socket first
  if (brokerAuth?.daemonSocketPath) {
    trySocketForward(brokerAuth.daemonSocketPath, 'events_batch', params).catch(() => {
      // Fall through to HTTP
      httpForwardEvents(events, daemonUrl, brokerAuth);
    });
    return;
  }

  httpForwardEvents(events, daemonUrl, brokerAuth);
}

function httpForwardEvents(
  events: Array<Record<string, unknown>>,
  daemonUrl: string,
  brokerAuth?: BrokerAuth,
): void {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (brokerAuth?.token) {
    headers['x-shield-broker-token'] = brokerAuth.token;
  }
  if (brokerAuth?.profileId) {
    headers['x-shield-profile-id'] = brokerAuth.profileId;
  }

  fetch(`${daemonUrl}/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `broker-events-${Date.now()}`,
      method: 'events_batch',
      params: { events },
    }),
  }).catch(() => { /* fire-and-forget */ });
}

/**
 * Interpret the daemon's policy result.
 */
function interpretDaemonResult(
  result: Record<string, unknown>,
  verbose: boolean,
  operation: string,
): DaemonPolicyResult | null {
  if (verbose) console.error(`[broker:forward] result: allowed=${result.allowed} policyId=${result.policyId}`);

  // Trust explicit user policy matches (must have policyId) — both allow and deny
  if (result.policyId) {
    return {
      allowed: !!result.allowed,
      policyId: result.policyId as string,
      reason: result.reason as string | undefined,
      sandbox: result.sandbox as SandboxConfig | undefined,
      executionContext: result.executionContext as PolicyExecutionContext | undefined,
    };
  }

  // Daemon default-allow (no policyId) — don't override broker's decision
  // But still pass through sandbox config for exec operations
  if (result.sandbox) {
    return {
      allowed: true,
      reason: result.reason as string | undefined,
      sandbox: result.sandbox as SandboxConfig,
      executionContext: result.executionContext as PolicyExecutionContext | undefined,
    };
  }

  return null;
}
