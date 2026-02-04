/**
 * Skill Executor
 *
 * Executes skills with policy enforcement.
 */

import { spawn } from 'node:child_process';
import type { Skill, ExecuteOptions, ExecuteResult } from './types.js';

export interface ExecutorDependencies {
  checkPolicy?: (operation: string, target: string) => Promise<boolean>;
  auditLog?: (entry: Record<string, unknown>) => void;
}

export class SkillExecutor {
  private deps: ExecutorDependencies;

  constructor(deps: ExecutorDependencies = {}) {
    this.deps = deps;
  }

  /**
   * Execute a skill
   */
  async execute(skill: Skill, options: ExecuteOptions = {}): Promise<ExecuteResult> {
    const startTime = Date.now();

    // Check if approval is required
    if (skill.agenshield.requiredApproval && !options.requireApproval) {
      return {
        success: false,
        error: 'This skill requires approval before execution',
        duration: Date.now() - startTime,
      };
    }

    // Build command
    const command = this.buildCommand(skill, options);

    // Check policy
    if (this.deps.checkPolicy) {
      const allowed = await this.deps.checkPolicy('exec', command.join(' '));
      if (!allowed) {
        return {
          success: false,
          error: 'Execution blocked by policy',
          duration: Date.now() - startTime,
          policyApplied: skill.agenshield.policy,
        };
      }
    }

    // Execute
    try {
      const result = await this.executeCommand(
        command[0],
        command.slice(1),
        options
      );

      // Audit log
      if (this.deps.auditLog) {
        this.deps.auditLog({
          skill: skill.name,
          command: command.join(' '),
          success: result.exitCode === 0,
          duration: result.duration,
        });
      }

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration: Date.now() - startTime,
        policyApplied: skill.agenshield.policy,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Check if a skill can be executed
   */
  async canExecute(skill: Skill, context?: Record<string, unknown>): Promise<boolean> {
    // Check requirements
    if (skill.requires.bins) {
      for (const bin of skill.requires.bins) {
        if (!await this.checkBinary(bin)) {
          return false;
        }
      }
    }

    if (skill.requires.env) {
      for (const envVar of skill.requires.env) {
        if (!process.env[envVar]) {
          return false;
        }
      }
    }

    // Check policy
    if (this.deps.checkPolicy && skill.agenshield.allowedCommands) {
      for (const cmd of skill.agenshield.allowedCommands) {
        if (!await this.deps.checkPolicy('exec', cmd)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Build command from skill and options
   */
  private buildCommand(skill: Skill, options: ExecuteOptions): string[] {
    const args = options.args || [];

    switch (skill.commandDispatch) {
      case 'bash':
        if (skill.commandArgMode === 'single') {
          return ['/bin/bash', '-c', args.join(' ')];
        }
        return ['/bin/bash', '-c', ...args];

      case 'node':
        return ['node', '-e', args.join(' ')];

      case 'python':
        return ['python', '-c', args.join(' ')];

      default:
        return args;
    }
  }

  /**
   * Execute a command
   */
  private executeCommand(
    command: string,
    args: string[],
    options: ExecuteOptions
  ): Promise<{ exitCode: number; stdout: string; stderr: string; duration: number }> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';

      const proc = spawn(command, args, {
        cwd: options.context?.workingDir,
        env: {
          ...process.env,
          ...options.context?.environment,
        },
        timeout: options.timeout || 30000,
      });

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', reject);

      proc.on('close', (code) => {
        resolve({
          exitCode: code ?? -1,
          stdout,
          stderr,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * Check if a binary is available
   */
  private async checkBinary(name: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('which', [name]);
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      proc.on('error', () => {
        resolve(false);
      });
    });
  }
}
