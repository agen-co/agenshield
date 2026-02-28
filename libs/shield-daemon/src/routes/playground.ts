/**
 * Playground simulation endpoint
 *
 * POST /playground/simulate — runs a command in a sandboxed environment
 * and captures all policy-evaluated operations (exec, HTTP, filesystem).
 */

import * as crypto from 'node:crypto';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SimulateRequest, SimulateResponse, SimulatedOperation } from '@agenshield/ipc';
import { extractCommandBasename, filterUrlPoliciesForCommand } from '@agenshield/policies';
import { loadConfig, loadScopedConfig } from '../config/index';
import { getPolicyManager } from '../services/policy-manager';
import { getProxyPool } from '../proxy/pool';
import { resolveTargetContext } from '../services/target-context';

/** Max output capture per stream */
const MAX_OUTPUT_BYTES = 4096;

/** Default timeout (ms) */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Maximum timeout (ms) */
const MAX_TIMEOUT_MS = 60_000;

/**
 * Truncate a string to maxLen, appending a notice if truncated.
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '\n... (truncated)';
}

/**
 * Split a command string on shell operators (&&, ||, ;) while
 * respecting single and double quotes.
 */
function splitSubCommands(command: string): string[] {
  const subCommands: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < command.length) {
    const ch = command[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      i++;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      i++;
    } else if (!inSingle && !inDouble) {
      // Check for && or ||
      if ((ch === '&' && command[i + 1] === '&') || (ch === '|' && command[i + 1] === '|')) {
        if (current.trim()) subCommands.push(current.trim());
        current = '';
        i += 2;
      } else if (ch === ';') {
        if (current.trim()) subCommands.push(current.trim());
        current = '';
        i++;
      } else {
        current += ch;
        i++;
      }
    } else {
      current += ch;
      i++;
    }
  }

  if (current.trim()) subCommands.push(current.trim());
  return subCommands;
}

/**
 * Build a minimal SBPL seatbelt profile for playground simulation.
 */
function buildSbplProfile(proxyPort: number, agentHome?: string): string {
  const writePaths = [
    ...(agentHome ? [`(subpath "${agentHome}")`] : []),
    '(subpath "/tmp")',
    '(subpath "/private/tmp")',
    '(subpath "/var/folders")',
    '(subpath "/dev/null")',
    '(subpath "/dev/tty")',
  ].join('\n  ');

  return `(version 1)
(deny default)

;; Allow process execution for standard system binaries
(allow process-exec
  (subpath "/bin")
  (subpath "/usr/bin")
  (subpath "/usr/local/bin")
  (subpath "/usr/sbin")
  (subpath "/sbin"))

;; Allow process-fork for sub-processes
(allow process-fork)

;; Allow read access broadly (needed for dynamic libs, configs, etc.)
(allow file-read*)

;; Allow writes to temp directories${agentHome ? ' and agent home' : ''}
(allow file-write*
  ${writePaths})

;; Allow network only to localhost (proxy)
(allow network*
  (remote ip "localhost:${proxyPort}"))

;; Allow sysctl reads (needed by many tools)
(allow sysctl-read)

;; Allow mach lookups (needed for DNS, system services)
(allow mach-lookup)

;; Allow signal sending
(allow signal)
`;
}

/**
 * Build the summary from a list of operations.
 */
function buildSummary(operations: SimulatedOperation[]): SimulateResponse['summary'] {
  const byType: Record<string, { total: number; allowed: number; denied: number }> = {};

  let total = 0;
  let allowed = 0;
  let denied = 0;

  for (const op of operations) {
    total++;
    if (op.action === 'allow') allowed++;
    else denied++;

    if (!byType[op.type]) {
      byType[op.type] = { total: 0, allowed: 0, denied: 0 };
    }
    byType[op.type].total++;
    if (op.action === 'allow') byType[op.type].allowed++;
    else byType[op.type].denied++;
  }

  return { total, allowed, denied, byType };
}

export async function playgroundRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/playground/simulate',
    async (
      request: FastifyRequest<{ Body: SimulateRequest }>,
      reply: FastifyReply,
    ) => {
      const { command, timeout: rawTimeout } = request.body ?? {};

      // Validate input
      if (!command || typeof command !== 'string' || !command.trim()) {
        reply.code(400);
        return { success: false, error: { message: 'command is required', statusCode: 400 } };
      }

      if (command.length > 2000) {
        reply.code(400);
        return { success: false, error: { message: 'command must be under 2000 characters', statusCode: 400 } };
      }

      const timeout = Math.min(
        Math.max(rawTimeout ?? DEFAULT_TIMEOUT_MS, 1000),
        MAX_TIMEOUT_MS,
      );

      // Resolve profile scope from header or body
      const profileId = request.shieldContext?.profileId ?? request.body?.profileId ?? undefined;

      const simulationId = crypto.randomUUID();
      const startTime = Date.now();
      const operations: SimulatedOperation[] = [];
      let seq = 0;

      const pushOp = (
        type: SimulatedOperation['type'],
        target: string,
        action: 'allow' | 'deny',
        extra?: { policyId?: string; policyName?: string; reason?: string; detail?: Record<string, unknown> },
      ): void => {
        operations.push({
          id: crypto.randomUUID(),
          seq: seq++,
          type,
          target,
          action,
          policyId: extra?.policyId,
          policyName: extra?.policyName,
          reason: extra?.reason,
          timestamp: new Date().toISOString(),
          detail: extra?.detail,
        });
      };

      // --- Step 1: Evaluate exec policies for each sub-command ---
      const config = profileId ? loadScopedConfig(profileId) : loadConfig();
      const manager = getPolicyManager();
      const subCommands = splitSubCommands(command);

      for (const sub of subCommands) {
        const result = manager.evaluateLive({
          operation: 'exec',
          target: sub,
          profileId,
          defaultAction: config.defaultAction,
        });

        const matchedPolicy = result.policyId ? manager.getById(result.policyId) ?? undefined : undefined;

        pushOp('exec', sub, result.allowed ? 'allow' : 'deny', {
          policyId: result.policyId,
          policyName: matchedPolicy?.name,
          reason: result.reason,
        });
      }

      // --- Step 2: Spawn command inside sandbox with proxy ---
      const pool = getProxyPool();
      const execId = crypto.randomUUID();
      const commandBasename = extractCommandBasename(command);

      // Acquire a proxy with callbacks to capture HTTP traffic
      const { port: proxyPort } = await pool.acquire(
        execId,
        command,
        () => filterUrlPoliciesForCommand(config.policies || [], commandBasename),
        () => config.defaultAction ?? 'deny',
        {
          onBlock: (method, target, protocol) => {
            const fullTarget = protocol === 'https' && !target.startsWith('https://') ? `https://${target}` : target;
            pushOp('http_request', fullTarget, 'deny', {
              reason: `Blocked by URL policy (${method})`,
              detail: { method, protocol },
            });
          },
          onAllow: (method, target, protocol) => {
            const fullTarget = protocol === 'https' && !target.startsWith('https://') ? `https://${target}` : target;
            pushOp('http_request', fullTarget, 'allow', {
              detail: { method, protocol },
            });
          },
        },
      );

      let profilePath: string | undefined;
      let exitCode: number | null = null;
      let stdout = '';
      let stderr = '';
      let status: SimulateResponse['status'] = 'completed';

      try {
        // Build env for the child process
        const childEnv: Record<string, string> = {
          ...process.env as Record<string, string>,
          HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
          HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
          ALL_PROXY: `http://127.0.0.1:${proxyPort}`,
          http_proxy: `http://127.0.0.1:${proxyPort}`,
          https_proxy: `http://127.0.0.1:${proxyPort}`,
          all_proxy: `http://127.0.0.1:${proxyPort}`,
          NO_PROXY: '',
          AGENSHIELD_SIMULATE: '1',
        };

        // When profile-scoped, run in the target's home directory
        const targetHome = profileId ? resolveTargetContext(profileId).agentHome : undefined;
        if (targetHome) childEnv['HOME'] = targetHome;

        // Determine if we can use sandbox-exec (macOS only)
        const isMacOS = os.platform() === 'darwin';
        let spawnArgs: string[];
        let spawnBin: string;

        if (isMacOS) {
          // Write SBPL profile to temp file
          profilePath = path.join(os.tmpdir(), `agenshield-sim-${simulationId}.sb`);
          fs.writeFileSync(profilePath, buildSbplProfile(proxyPort, targetHome), 'utf-8');

          spawnBin = '/usr/bin/sandbox-exec';
          spawnArgs = ['-f', profilePath, '/bin/sh', '-c', command];
        } else {
          // No sandbox on non-macOS — just run with proxy
          console.log('[playground] non-macOS: running without seatbelt isolation');
          spawnBin = '/bin/sh';
          spawnArgs = ['-c', command];
        }

        // Spawn the process
        const result = await new Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
          const child = childProcess.spawn(spawnBin, spawnArgs, {
            env: childEnv,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout,
          });

          let stdoutBuf = '';
          let stderrBuf = '';
          let timedOut = false;

          // Close stdin immediately to prevent interactive hangs
          child.stdin.end();

          child.stdout.on('data', (chunk: Buffer) => {
            if (stdoutBuf.length < MAX_OUTPUT_BYTES) {
              stdoutBuf += chunk.toString('utf-8');
            }
          });

          child.stderr.on('data', (chunk: Buffer) => {
            if (stderrBuf.length < MAX_OUTPUT_BYTES) {
              stderrBuf += chunk.toString('utf-8');
            }
          });

          child.on('error', (err) => {
            if ((err as NodeJS.ErrnoException).code === 'ETIMEDOUT' || err.message.includes('TIMEOUT')) {
              timedOut = true;
            }
            resolve({
              exitCode: null,
              stdout: stdoutBuf,
              stderr: stderrBuf + `\nProcess error: ${err.message}`,
              timedOut,
            });
          });

          child.on('close', (code, signal) => {
            if (signal === 'SIGTERM' || signal === 'SIGKILL') {
              timedOut = true;
            }
            resolve({
              exitCode: code,
              stdout: stdoutBuf,
              stderr: stderrBuf,
              timedOut,
            });
          });

          // Enforce timeout manually as fallback
          setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch { /* already exited */ }
            timedOut = true;
          }, timeout + 1000);
        });

        exitCode = result.exitCode;
        stdout = truncate(result.stdout, MAX_OUTPUT_BYTES);
        stderr = truncate(result.stderr, MAX_OUTPUT_BYTES);
        if (result.timedOut) status = 'timeout';
      } catch (err) {
        status = 'error';
        stderr = err instanceof Error ? err.message : 'Unknown error';
      } finally {
        // Clean up
        pool.release(execId);
        if (profilePath) {
          try { fs.unlinkSync(profilePath); } catch { /* ignore */ }
        }
      }

      const durationMs = Date.now() - startTime;

      const response: SimulateResponse = {
        simulationId,
        command,
        status,
        operations,
        exitCode,
        stdout,
        stderr,
        durationMs,
        summary: buildSummary(operations),
      };

      return { success: true, data: response };
    },
  );
}
