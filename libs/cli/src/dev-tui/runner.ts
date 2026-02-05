/**
 * Dev mode action execution engine.
 *
 * Executes test harness commands as the sandboxed agent user via sudo -u.
 */

import { execSync } from 'node:child_process';

export type ActionId =
  | 'test-network'
  | 'test-file-read'
  | 'test-file-write'
  | 'test-exec'
  | 'show-status'
  | 'view-logs'
  | 'quit';

export interface TestResult {
  success: boolean;
  output: string;
  exitCode: number;
  duration: number;
}

export function runTestAction(
  action: ActionId,
  agentUsername: string,
  testHarnessPath: string,
  params?: { path?: string; command?: string },
  nodePath?: string,
): TestResult {
  const nodeCmd = nodePath || 'node';
  let cmd: string;

  switch (action) {
    case 'test-network':
      cmd = `sudo -u ${agentUsername} ${nodeCmd} ${testHarnessPath} run --test-network`;
      break;
    case 'test-file-read':
      cmd = `sudo -u ${agentUsername} ${nodeCmd} ${testHarnessPath} run --test-file "${params?.path}"`;
      break;
    case 'test-file-write':
      cmd = `sudo -u ${agentUsername} ${nodeCmd} ${testHarnessPath} run --test-write "${params?.path}"`;
      break;
    case 'test-exec':
      cmd = `sudo -u ${agentUsername} ${nodeCmd} ${testHarnessPath} run --test-exec "${params?.command}"`;
      break;
    case 'show-status':
      cmd = `sudo -u ${agentUsername} ${nodeCmd} ${testHarnessPath} status`;
      break;
    default:
      return { success: false, output: `Unknown action: ${action}`, exitCode: 1, duration: 0 };
  }

  const start = Date.now();
  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
      success: true,
      output: output.trim(),
      exitCode: 0,
      duration: Date.now() - start,
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      success: false,
      output: ((e.stdout || '') + (e.stderr || '')).trim(),
      exitCode: e.status || 1,
      duration: Date.now() - start,
    };
  }
}
