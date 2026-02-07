/**
 * Shared helpers for E2E policy tests.
 *
 * Provides utilities for RPC calls, policy management, and daemon interaction.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const STATE_FILE = '/tmp/agenshield-e2e-policies-state.json';

interface TestState {
  pid: number;
  port: number;
  host: string;
  tempHome: string;
}

let cachedState: TestState | null = null;

function getState(): TestState {
  if (!cachedState) {
    cachedState = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  }
  return cachedState!;
}

function getBaseUrl(): string {
  const { host, port } = getState();
  return `http://${host}:${port}`;
}

// ─── JSON-RPC ────────────────────────────────────────────────────────────────

interface RpcResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Send a JSON-RPC 2.0 request to /rpc
 */
export async function rpc(
  method: string,
  params: Record<string, unknown>,
  id?: string
): Promise<RpcResponse> {
  const res = await fetch(`${getBaseUrl()}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: id ?? `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      method,
      params,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  return (await res.json()) as RpcResponse;
}

/**
 * Check a policy via the policy_check RPC method.
 */
export async function policyCheck(
  operation: string,
  target: string
): Promise<{ allowed: boolean; policyId?: string; reason?: string }> {
  const resp = await rpc('policy_check', { operation, target });
  if (resp.error) {
    throw new Error(`RPC error: ${resp.error.message}`);
  }
  return resp.result as { allowed: boolean; policyId?: string; reason?: string };
}

// ─── Daemon REST API ─────────────────────────────────────────────────────────

/**
 * Make an HTTP request to the daemon REST API.
 */
export async function daemonAPI(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const url = `${getBaseUrl()}/api${path}`;
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  };

  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const data = await res.json();
  return { status: res.status, data };
}

// ─── Policy Helpers ──────────────────────────────────────────────────────────

export interface PolicyInput {
  id: string;
  name: string;
  action: 'allow' | 'deny' | 'approval';
  target: 'skill' | 'command' | 'url' | 'filesystem';
  patterns: string[];
  enabled: boolean;
  priority?: number;
  operations?: string[];
}

/**
 * Create a policy object with sensible defaults.
 */
export function makePolicy(
  overrides: Partial<PolicyInput> &
    Pick<PolicyInput, 'name' | 'action' | 'target' | 'patterns'>
): PolicyInput {
  return {
    id: randomUUID(),
    enabled: true,
    priority: 0,
    ...overrides,
  };
}

/**
 * Set policies on the daemon (replaces all policies).
 */
export async function setPolicies(policies: PolicyInput[]): Promise<void> {
  const res = await daemonAPI('PUT', '/config', { policies });
  if (res.status !== 200) {
    throw new Error(`Failed to set policies: ${JSON.stringify(res.data)}`);
  }
}

/**
 * Clear all policies on the daemon.
 */
export async function clearPolicies(): Promise<void> {
  await setPolicies([]);
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
