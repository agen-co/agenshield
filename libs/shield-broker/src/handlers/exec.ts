/**
 * Exec Handler
 *
 * Handles command execution operations with:
 * - Command allowlist validation (static + dynamic via CommandAllowlist)
 * - Workspace path enforcement for FS commands
 * - URL policy validation for curl/wget
 * - Exec monitoring via SSE events
 */

import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { HandlerContext, HandlerResult, ExecParams, ExecResult } from '../types.js';
import type { HandlerDependencies } from './types.js';

/** Maximum output size (10MB) */
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;

/** Default workspace root used when cwd is not provided */
const DEFAULT_WORKSPACE = '/Users/clawagent/workspace';

/** Commands whose path arguments must be confined to allowed workspace paths */
const FS_COMMANDS = new Set([
  'rm', 'cp', 'mv', 'mkdir', 'touch', 'chmod', 'cat', 'ls',
  'find', 'head', 'tail', 'tar', 'sed', 'awk', 'sort', 'uniq', 'wc', 'grep',
]);

/** Commands that make network requests - need URL policy validation */
const HTTP_EXEC_COMMANDS = new Set(['curl', 'wget']);

/** curl/wget flags that take a value argument (next arg is the value, not a path/URL) */
const HTTP_FLAGS_WITH_VALUE = new Set([
  '-X', '--request',
  '-H', '--header',
  '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode',
  '-o', '--output',
  '-u', '--user',
  '-A', '--user-agent',
  '-e', '--referer',
  '-b', '--cookie',
  '-c', '--cookie-jar',
  '--connect-timeout',
  '--max-time',
  '-w', '--write-out',
  '-T', '--upload-file',
  '--resolve',
  '--cacert',
  '--cert',
  '--key',
]);

/**
 * Validate that all file path arguments are within allowed workspace paths.
 * Returns { valid: true } or { valid: false, reason, violatingPath }.
 */
function validateFsPaths(
  args: string[],
  cwd: string,
  allowedPaths: string[],
): { valid: true } | { valid: false; reason: string; violatingPath: string } {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Skip flags
    if (arg.startsWith('-')) {
      continue;
    }

    // This is a non-flag argument - treat as a potential file path
    const resolved = path.isAbsolute(arg) ? path.resolve(arg) : path.resolve(cwd, arg);

    const isAllowed = allowedPaths.some((allowed) => resolved.startsWith(allowed));
    if (!isAllowed) {
      return {
        valid: false,
        reason: 'Path not in allowed directories',
        violatingPath: resolved,
      };
    }
  }

  return { valid: true };
}

/**
 * Extract URL from curl/wget arguments for network policy validation.
 * Returns the first non-flag argument that looks like a URL, or null.
 */
function extractUrlFromArgs(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Skip flags
    if (arg.startsWith('-')) {
      // Skip flags that take a value
      if (HTTP_FLAGS_WITH_VALUE.has(arg)) {
        i++; // skip the value
      }
      continue;
    }

    // First non-flag arg is the URL
    return arg;
  }

  return null;
}

export async function handleExec(
  params: Record<string, unknown>,
  context: HandlerContext,
  deps: HandlerDependencies
): Promise<HandlerResult<ExecResult>> {
  const startTime = Date.now();

  try {
    const {
      command,
      args = [],
      cwd,
      env,
      timeout = 30000,
    } = params as unknown as ExecParams;

    if (!command) {
      return {
        success: false,
        error: { code: 1003, message: 'Command is required' },
      };
    }

    // Validate command against allowlist (static + dynamic)
    const resolvedCommand = deps.commandAllowlist.resolve(command);
    if (!resolvedCommand) {
      const reason = `Command not allowed: ${command}`;
      deps.onExecDenied?.(command, reason);
      return {
        success: false,
        error: { code: 1007, message: reason },
      };
    }

    const commandBasename = path.basename(resolvedCommand);
    const effectiveCwd = cwd || DEFAULT_WORKSPACE;

    // FS command workspace enforcement
    if (FS_COMMANDS.has(commandBasename)) {
      const policies = deps.policyEnforcer.getPolicies();
      const allowedPaths = policies.fsConstraints?.allowedPaths || [DEFAULT_WORKSPACE];

      const fsResult = validateFsPaths(args as string[], effectiveCwd, allowedPaths);
      if (!fsResult.valid) {
        const reason = `${fsResult.reason}: ${fsResult.violatingPath}`;
        deps.onExecDenied?.(command, reason);
        return {
          success: false,
          error: { code: 1008, message: `Path not allowed: ${fsResult.violatingPath} - ${fsResult.reason}` },
        };
      }
    }

    // URL policy validation for curl/wget
    if (HTTP_EXEC_COMMANDS.has(commandBasename)) {
      const url = extractUrlFromArgs(args as string[]);
      if (url) {
        const networkCheck = await deps.policyEnforcer.check('http_request', { url }, context);
        if (!networkCheck.allowed) {
          const reason = `URL not allowed: ${url} - ${networkCheck.reason}`;
          deps.onExecDenied?.(command, reason);
          return {
            success: false,
            error: { code: 1009, message: reason },
          };
        }
      }
    }

    // Use longer timeout for download commands
    const effectiveTimeout = HTTP_EXEC_COMMANDS.has(commandBasename)
      ? Math.max(timeout, 300000)  // 5 min minimum for downloads
      : timeout;

    // Execute command with resolved absolute path and shell: false forced
    const result = await executeCommand({
      command: resolvedCommand,
      args,
      cwd: effectiveCwd,
      env,
      timeout: effectiveTimeout,
      shell: false, // Always force shell: false to prevent injection
    });

    const duration = Date.now() - startTime;

    // Emit exec monitoring event
    deps.onExecMonitor?.({
      command: commandBasename,
      args: args as string[],
      cwd: effectiveCwd,
      exitCode: result.exitCode,
      allowed: true,
      duration,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      data: result,
      audit: {
        duration,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: { code: 1006, message: `Exec error: ${(error as Error).message}` },
    };
  }
}

/**
 * Execute a command and capture output
 */
async function executeCommand(options: ExecParams): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const { command, args = [], cwd, env, timeout = 30000 } = options;
    // Always force shell: false to prevent shell injection
    const shell = false;

    let stdout = '';
    let stderr = '';
    let stdoutSize = 0;
    let stderrSize = 0;

    const proc = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      shell,
      timeout,
    });

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      if (stdoutSize + chunk.length <= MAX_OUTPUT_SIZE) {
        stdout += chunk;
        stdoutSize += chunk.length;
      }
    });

    proc.stderr?.on('data', (data) => {
      const chunk = data.toString();
      if (stderrSize + chunk.length <= MAX_OUTPUT_SIZE) {
        stderr += chunk;
        stderrSize += chunk.length;
      }
    });

    proc.on('error', (error) => {
      reject(error);
    });

    proc.on('close', (code, signal) => {
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        signal: signal ?? undefined,
      });
    });

    // Handle timeout
    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);
    }, timeout);

    proc.on('exit', () => {
      clearTimeout(timeoutId);
    });
  });
}
