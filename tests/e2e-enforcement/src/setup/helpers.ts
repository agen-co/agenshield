/**
 * Shared helpers for E2E enforcement tests.
 *
 * Combines OS-level helpers (from tests/e2e/) with policy helpers (from tests/e2e-policies/).
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const PREFIX_FILE = '/tmp/agenshield-e2e-enforcement-prefix.txt';
const ROOT_DIR = resolve(__dirname, '../../../..');
const CLI_PATH = resolve(ROOT_DIR, 'libs/cli/dist/src/cli.js');
const DEFAULT_DAEMON_PORT = 5200;
const DAEMON_BASE_URL = `http://localhost:${DEFAULT_DAEMON_PORT}`;

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

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

// ─── Prefix & Naming ────────────────────────────────────────────────────────

let cachedPrefix: string | null = null;

export function getTestPrefix(): string {
  if (cachedPrefix) return cachedPrefix;
  cachedPrefix = readFileSync(PREFIX_FILE, 'utf-8').trim();
  return cachedPrefix;
}

export function getAgentUsername(): string {
  return `${getTestPrefix()}_ash_default_agent`;
}

export function getBrokerUsername(): string {
  return `${getTestPrefix()}_ash_default_broker`;
}

export function getSocketGroupName(): string {
  return `${getTestPrefix()}_ash_default`;
}

export function getWorkspaceGroupName(): string {
  return `${getTestPrefix()}_ash_default_workspace`;
}

export function getAgentHome(): string {
  return `/Users/${getAgentUsername()}`;
}

// ─── Command Execution ──────────────────────────────────────────────────────

export function runCLI(
  args: string,
  options?: { env?: Record<string, string>; timeout?: number }
): ExecResult {
  const cmd = `node ${CLI_PATH} ${args}`;
  return runShell(cmd, options);
}

export function runShell(
  cmd: string,
  options?: { env?: Record<string, string>; timeout?: number }
): ExecResult {
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      timeout: options?.timeout ?? 60_000,
      cwd: ROOT_DIR,
      env: { ...process.env, ...options?.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

export function runAsAgentUser(
  command: string,
  options?: { timeout?: number }
): ExecResult {
  const agentUser = getAgentUsername();
  return runShell(`sudo -u ${agentUser} ${command}`, options);
}

// ─── Daemon Interaction ─────────────────────────────────────────────────────

export async function waitForDaemon(
  port: number = DEFAULT_DAEMON_PORT,
  timeoutMs: number = 15_000
): Promise<boolean> {
  const start = Date.now();
  const url = `http://localhost:${port}/api/health`;

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // Not ready yet
    }
    await sleep(500);
  }

  return false;
}

export async function waitForDaemonStop(timeoutMs: number = 15_000): Promise<boolean> {
  const start = Date.now();
  const url = `${DAEMON_BASE_URL}/api/health`;

  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      await sleep(500);
    } catch {
      return true;
    }
  }

  return false;
}

export async function daemonAPI(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const url = `${DAEMON_BASE_URL}/api${path}`;
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

// ─── RPC ─────────────────────────────────────────────────────────────────────

export async function rpc(
  method: string,
  params: Record<string, unknown>
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const res = await fetch(`${DAEMON_BASE_URL}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `enf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      method,
      params,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  return (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
}

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

// ─── Policy Helpers ──────────────────────────────────────────────────────────

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

export async function setPolicies(policies: PolicyInput[]): Promise<void> {
  const res = await daemonAPI('PUT', '/config', { policies });
  if (res.status !== 200) {
    throw new Error(`Failed to set policies: ${JSON.stringify(res.data)}`);
  }
}

export async function clearPolicies(): Promise<void> {
  await setPolicies([]);
}

// ─── OS Checks ───────────────────────────────────────────────────────────────

export function userExists(username: string): boolean {
  if (process.platform !== 'darwin') {
    try {
      execSync(`id ${username}`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  try {
    execSync(`dscl . -read /Users/${username}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function groupExists(groupName: string): boolean {
  if (process.platform !== 'darwin') {
    try {
      execSync(`getent group ${groupName}`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  try {
    execSync(`dscl . -read /Groups/${groupName}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function getRootDir(): string {
  return ROOT_DIR;
}
