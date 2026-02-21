/**
 * SudoExecutor — PrivilegeExecutor backed by direct `sudo` calls.
 *
 * This is the simplest implementation: it calls `execSync('sudo ...')`
 * and relies on the sudo credential cache being warm (from CLI or terminal).
 */

import { execSync } from 'node:child_process';
import type { PrivilegeExecutor, ExecResult } from './privilege-executor.js';

export class SudoExecutor implements PrivilegeExecutor {
  async execAsRoot(command: string, options?: { timeout?: number }): Promise<ExecResult> {
    try {
      const output = execSync(`sudo ${command}`, {
        encoding: 'utf-8',
        timeout: options?.timeout ?? 300_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: output.trim() };
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      return {
        success: false,
        output: '',
        error: e.stderr?.trim() || e.message,
      };
    }
  }

  async execAsUser(user: string, command: string, options?: { timeout?: number }): Promise<ExecResult> {
    try {
      const output = execSync(`sudo -H -u ${user} /bin/bash -c ${JSON.stringify(command)}`, {
        encoding: 'utf-8',
        timeout: options?.timeout ?? 300_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: output.trim() };
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      return {
        success: false,
        output: '',
        error: e.stderr?.trim() || e.message,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Non-interactive check: if sudo credentials are cached, this succeeds
      execSync('sudo -n true', { stdio: 'pipe', timeout: 2000 });
      return true;
    } catch {
      // Also check if we're already root
      return process.getuid?.() === 0;
    }
  }

  async shutdown(): Promise<void> {
    // No resources to clean up
  }
}
