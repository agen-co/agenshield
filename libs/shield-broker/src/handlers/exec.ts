/**
 * Exec Handler
 *
 * Handles command execution operations with command allowlist validation.
 */

import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { HandlerContext, HandlerResult, ExecParams, ExecResult } from '../types.js';
import type { HandlerDependencies } from './types.js';

/** Maximum output size (10MB) */
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;

/**
 * Allowed commands map: command name -> list of absolute paths to search.
 * Only commands in this map can be executed through the broker.
 */
const ALLOWED_COMMANDS: Record<string, string[]> = {
  git: ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'],
  ssh: ['/usr/bin/ssh'],
  scp: ['/usr/bin/scp'],
  rsync: ['/usr/bin/rsync', '/opt/homebrew/bin/rsync'],
  brew: ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'],
  npm: ['/opt/homebrew/bin/npm', '/usr/local/bin/npm'],
  npx: ['/opt/homebrew/bin/npx', '/usr/local/bin/npx'],
  pip: ['/usr/bin/pip', '/usr/local/bin/pip', '/opt/homebrew/bin/pip'],
  pip3: ['/usr/bin/pip3', '/usr/local/bin/pip3', '/opt/homebrew/bin/pip3'],
  node: ['/opt/homebrew/bin/node', '/usr/local/bin/node'],
  python: ['/usr/bin/python', '/usr/local/bin/python', '/opt/homebrew/bin/python'],
  python3: ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3'],
  ls: ['/bin/ls'],
  cat: ['/bin/cat'],
  grep: ['/usr/bin/grep'],
  find: ['/usr/bin/find'],
  mkdir: ['/bin/mkdir'],
  cp: ['/bin/cp'],
  mv: ['/bin/mv'],
  rm: ['/bin/rm'],
  touch: ['/usr/bin/touch'],
  chmod: ['/bin/chmod'],
  head: ['/usr/bin/head'],
  tail: ['/usr/bin/tail'],
  wc: ['/usr/bin/wc'],
  sort: ['/usr/bin/sort'],
  uniq: ['/usr/bin/uniq'],
  sed: ['/usr/bin/sed'],
  awk: ['/usr/bin/awk'],
  tar: ['/usr/bin/tar'],
  curl: ['/usr/bin/curl'],
  wget: ['/usr/local/bin/wget', '/opt/homebrew/bin/wget'],
};

/**
 * Resolve a command name to an absolute path from the allowlist.
 * Returns null if the command is not allowed.
 */
function resolveCommand(command: string): string | null {
  // If command is already an absolute path, check it's in an allowed list
  if (path.isAbsolute(command)) {
    for (const paths of Object.values(ALLOWED_COMMANDS)) {
      if (paths.includes(command)) {
        return command;
      }
    }
    return null;
  }

  // Look up by command basename
  const basename = path.basename(command);
  const candidates = ALLOWED_COMMANDS[basename];
  if (!candidates) {
    return null;
  }

  // Return the first candidate (they're ordered by preference)
  // In production, we'd check existence, but spawn will handle ENOENT
  return candidates[0];
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

    // Validate command against allowlist
    const resolvedCommand = resolveCommand(command);
    if (!resolvedCommand) {
      return {
        success: false,
        error: { code: 1007, message: `Command not allowed: ${command}` },
      };
    }

    // Execute command with resolved absolute path and shell: false forced
    const result = await executeCommand({
      command: resolvedCommand,
      args,
      cwd,
      env,
      timeout,
      shell: false, // Always force shell: false to prevent injection
    });

    return {
      success: true,
      data: result,
      audit: {
        duration: Date.now() - startTime,
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
