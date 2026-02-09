/**
 * Exec Handler
 *
 * Handles command execution operations with:
 * - Command allowlist validation (static + dynamic via CommandAllowlist)
 * - Workspace path enforcement for FS commands
 * - URL policy validation for curl/wget
 * - Exec monitoring via SSE events
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { HandlerContext, HandlerResult, ExecParams, ExecResult } from '../types.js';
import type { HandlerDependencies } from './types.js';
import { forwardPolicyToDaemon } from '../daemon-forward.js';

/** Maximum output size (10MB) */
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;

/** Default workspace root used when cwd is not provided.
 *  Reads AGENSHIELD_AGENT_HOME at runtime; falls back to '/' (always exists). */
function getDefaultWorkspace(): string {
  const home = process.env['AGENSHIELD_AGENT_HOME'];
  if (home) {
    return `${home}/.openclaw/workspace`;
  }
  return '/';
}

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

/* ------------------------------------------------------------------ */
/*  Node.js-native builtins for common filesystem commands.            */
/*  Avoids spawn failures caused by missing cwd, wrong binary paths,   */
/*  or sandboxed environments.  Falls back to spawn when not matched.  */
/* ------------------------------------------------------------------ */

type BuiltinFn = (args: string[], cwd: string) => Promise<ExecResult>;

/** Parse flags and positional args from a command's argument list */
function parseArgs(args: string[], flagsWithValue: Set<string> = new Set()): {
  flags: Set<string>;
  positional: string[];
} {
  const flags = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      // Handle combined flags like -rf → -r, -f
      if (!arg.startsWith('--') && arg.length > 2) {
        for (const ch of arg.slice(1)) flags.add(`-${ch}`);
      } else {
        flags.add(arg);
      }
      if (flagsWithValue.has(arg) && i + 1 < args.length) {
        positional.push(args[++i]); // value consumed as positional
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function resolvePath(p: string, cwd: string): string {
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(cwd, p);
}

const NODE_BUILTINS: Record<string, BuiltinFn> = {
  /** mkdir [-p] <path...> */
  async mkdir(args, cwd) {
    const { flags, positional } = parseArgs(args);
    const recursive = flags.has('-p');
    for (const p of positional) {
      await fs.mkdir(resolvePath(p, cwd), { recursive });
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  },

  /** rm [-r] [-f] [-rf] <path...> */
  async rm(args, cwd) {
    const { flags, positional } = parseArgs(args);
    const recursive = flags.has('-r') || flags.has('-R');
    const force = flags.has('-f');
    for (const p of positional) {
      await fs.rm(resolvePath(p, cwd), { recursive, force });
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  },

  /** cp [-r|-R] <src> <dst> */
  async cp(args, cwd) {
    const { flags, positional } = parseArgs(args);
    const recursive = flags.has('-r') || flags.has('-R');
    if (positional.length < 2) {
      return { exitCode: 1, stdout: '', stderr: 'cp: missing operand' };
    }
    const src = resolvePath(positional[0], cwd);
    const dst = resolvePath(positional[1], cwd);
    await fs.cp(src, dst, { recursive });
    return { exitCode: 0, stdout: '', stderr: '' };
  },

  /** touch <path...> */
  async touch(args, cwd) {
    const { positional } = parseArgs(args);
    const now = new Date();
    for (const p of positional) {
      const resolved = resolvePath(p, cwd);
      try {
        await fs.utimes(resolved, now, now);
      } catch {
        // File doesn't exist — create it
        await fs.writeFile(resolved, '', { flag: 'a' });
      }
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  },

  /** chmod <mode> <path...> */
  async chmod(args, cwd) {
    const { positional } = parseArgs(args);
    if (positional.length < 2) {
      return { exitCode: 1, stdout: '', stderr: 'chmod: missing operand' };
    }
    const mode = parseInt(positional[0], 8);
    for (const p of positional.slice(1)) {
      await fs.chmod(resolvePath(p, cwd), mode);
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  },
};

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
    const defaultWorkspace = getDefaultWorkspace();
    const effectiveCwd = cwd || defaultWorkspace;

    // FS command workspace enforcement
    if (FS_COMMANDS.has(commandBasename)) {
      const policies = deps.policyEnforcer.getPolicies();
      const allowedPaths = policies.fsConstraints?.allowedPaths || [defaultWorkspace];

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
          // Forward to daemon for user-defined URL policies
          const daemonUrl = deps.daemonUrl || 'http://127.0.0.1:5200';
          const override = await forwardPolicyToDaemon('http_request', url, daemonUrl);
          if (!override || !override.allowed) {
            const reason = `URL not allowed: ${url} - ${networkCheck.reason}`;
            deps.onExecDenied?.(command, reason);
            return {
              success: false,
              error: { code: 1009, message: reason },
            };
          }
        }
      }
    }

    // Use longer timeout for download commands
    const effectiveTimeout = HTTP_EXEC_COMMANDS.has(commandBasename)
      ? Math.max(timeout, 300000)  // 5 min minimum for downloads
      : timeout;

    // Resolve secrets to inject as environment variables
    const secretEnv = deps.secretResolver?.getSecretsForExec(
      commandBasename,
      args as string[]
    ) ?? {};
    const injectedSecretNames = Object.keys(secretEnv);

    // Merge: caller env as base + daemon secrets on top (secrets take priority)
    const mergedEnv = injectedSecretNames.length > 0
      ? { ...(env || {}), ...secretEnv }
      : env;

    // Try Node.js-native builtin for known FS commands (avoids spawn cwd/path issues)
    const builtin = NODE_BUILTINS[commandBasename];
    let result: ExecResult;

    if (builtin) {
      try {
        result = await builtin(args as string[], effectiveCwd);
      } catch (builtinErr) {
        // Builtin failed — fall back to spawn
        result = await executeCommand({
          command: resolvedCommand,
          args,
          cwd: effectiveCwd,
          env: mergedEnv,
          timeout: effectiveTimeout,
          shell: false,
        });
      }
    } else {
      // Execute command with resolved absolute path and shell: false forced
      result = await executeCommand({
        command: resolvedCommand,
        args,
        cwd: effectiveCwd,
        env: mergedEnv,
        timeout: effectiveTimeout,
        shell: false, // Always force shell: false to prevent injection
      });
    }

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
      injectedSecretNames: injectedSecretNames.length > 0 ? injectedSecretNames : undefined,
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
