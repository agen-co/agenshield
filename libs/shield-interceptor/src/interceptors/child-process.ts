/**
 * Child Process Interceptor
 *
 * Intercepts child_process module calls with synchronous policy checking
 * and optional macOS seatbelt (sandbox-exec) wrapping for approved commands.
 *
 * ALL methods (spawn, exec, execFile, fork) now perform synchronous policy
 * checks before execution. Previously, async methods would fire the original
 * call immediately while the policy check ran in the background.
 */

import type * as childProcess from 'node:child_process';
import { BaseInterceptor, type BaseInterceptorOptions } from './base.js';
import { SyncClient } from '../client/sync-client.js';
import { PolicyDeniedError } from '../errors.js';
import { ProfileManager } from '../seatbelt/profile-manager.js';
import { debugLog } from '../debug-log.js';
import type { PolicyExecutionContext, SandboxConfig } from '@agenshield/ipc';
import type { PolicyCheckResult } from '../policy/evaluator.js';

// Use require() for modules we need to monkey-patch (ESM imports are immutable)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcessModule = require('node:child_process') as typeof childProcess;

export class ChildProcessInterceptor extends BaseInterceptor {
  private syncClient: SyncClient;
  private _checking = false;
  private _executing = false;  // Guards exec→execFile re-entrancy
  private profileManager: ProfileManager | null = null;
  private originalExec: typeof childProcess.exec | null = null;
  private originalExecSync: typeof childProcess.execSync | null = null;
  private originalSpawn: typeof childProcess.spawn | null = null;
  private originalSpawnSync: typeof childProcess.spawnSync | null = null;
  private originalExecFile: typeof childProcess.execFile | null = null;
  private originalFork: typeof childProcess.fork | null = null;

  constructor(options: BaseInterceptorOptions) {
    super(options);
    const config = this.interceptorConfig;
    this.syncClient = new SyncClient({
      socketPath: config?.socketPath || '/var/run/agenshield/agenshield.sock',
      httpHost: config?.httpHost || 'localhost',
      httpPort: config?.httpPort || 5201,
      timeout: config?.timeout || 30000,
    });

    // Initialize ProfileManager if seatbelt is enabled
    if (config?.enableSeatbelt && process.platform === 'darwin') {
      this.profileManager = new ProfileManager(
        config.seatbeltProfileDir || '/tmp/agenshield-profiles'
      );
    }
  }

  install(): void {
    if (this.installed) return;

    // Save originals
    this.originalExec = childProcessModule.exec;
    this.originalExecSync = childProcessModule.execSync;
    this.originalSpawn = childProcessModule.spawn;
    this.originalSpawnSync = childProcessModule.spawnSync;
    this.originalExecFile = childProcessModule.execFile;
    this.originalFork = childProcessModule.fork;

    // Replace with intercepted versions
    childProcessModule.exec = this.createInterceptedExec();
    childProcessModule.execSync = this.createInterceptedExecSync();
    childProcessModule.spawn = this.createInterceptedSpawn();
    childProcessModule.spawnSync = this.createInterceptedSpawnSync();
    childProcessModule.execFile = this.createInterceptedExecFile();
    childProcessModule.fork = this.createInterceptedFork();

    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed) return;

    if (this.originalExec) childProcessModule.exec = this.originalExec;
    if (this.originalExecSync) childProcessModule.execSync = this.originalExecSync;
    if (this.originalSpawn) childProcessModule.spawn = this.originalSpawn;
    if (this.originalSpawnSync) childProcessModule.spawnSync = this.originalSpawnSync;
    if (this.originalExecFile) childProcessModule.execFile = this.originalExecFile;
    if (this.originalFork) childProcessModule.fork = this.originalFork;

    this.originalExec = null;
    this.originalExecSync = null;
    this.originalSpawn = null;
    this.originalSpawnSync = null;
    this.originalExecFile = null;
    this.originalFork = null;
    this.installed = false;
  }

  /**
   * Build execution context from config for RPC calls
   */
  private getPolicyExecutionContext(): PolicyExecutionContext {
    const config = this.interceptorConfig;
    return {
      callerType: config?.contextType || 'agent',
      skillSlug: config?.contextSkillSlug,
      agentId: config?.contextAgentId,
      depth: 0,
    };
  }

  /**
   * Synchronous policy check via SyncClient.
   * Returns the full policy result (with sandbox config) or null if broker
   * is unavailable and failOpen is true.
   */
  private syncPolicyCheck(fullCommand: string): PolicyCheckResult | null {
    this._checking = true;
    const startTime = Date.now();
    try {
      debugLog(`cp.syncPolicyCheck START command=${fullCommand}`);
      const context = this.getPolicyExecutionContext();
      const result = this.syncClient.request<PolicyCheckResult>(
        'policy_check',
        { operation: 'exec', target: fullCommand, context }
      );
      debugLog(`cp.syncPolicyCheck DONE allowed=${result.allowed} command=${fullCommand}`);

      if (!result.allowed) {
        this.eventReporter.deny('exec', fullCommand, result.policyId, result.reason);
        throw new PolicyDeniedError(result.reason || 'Operation denied by policy', {
          operation: 'exec',
          target: fullCommand,
          policyId: result.policyId,
        });
      }

      this.eventReporter.allow('exec', fullCommand, result.policyId, Date.now() - startTime);
      return result;
    } catch (error) {
      if (error instanceof PolicyDeniedError) {
        throw error;
      }
      debugLog(`cp.syncPolicyCheck ERROR: ${(error as Error).message} command=${fullCommand}`);
      if (!this.failOpen) {
        throw error;
      }
      return null;
    } finally {
      this._checking = false;
    }
  }

  /**
   * Create a restrictive default sandbox config for fail-open scenarios.
   * No network, minimal fs — better than running completely unsandboxed.
   */
  private getFailOpenSandbox(): SandboxConfig {
    return {
      enabled: true,
      allowedReadPaths: [],
      allowedWritePaths: [],
      deniedPaths: [],
      networkAllowed: false,
      allowedHosts: [],
      allowedPorts: [],
      allowedBinaries: [],
      deniedBinaries: [],
      envInjection: {},
      envDeny: [],
    };
  }

  /**
   * Resolve the sandbox config to use: from policy result, fail-open default, or null.
   */
  private resolveSandbox(policyResult: PolicyCheckResult | null): SandboxConfig | null {
    if (policyResult?.sandbox?.enabled) {
      return policyResult.sandbox;
    }
    // Fail-open: broker was unavailable but we still want seatbelt protection
    if (policyResult === null && this.profileManager) {
      return this.getFailOpenSandbox();
    }
    return null;
  }

  /**
   * Wrap a command with sandbox-exec if seatbelt is enabled and sandbox config is present.
   * Returns modified { command, args, options } for spawn-style calls.
   */
  private wrapWithSeatbelt(
    command: string,
    args: string[],
    options: Record<string, unknown> | undefined,
    policyResult: PolicyCheckResult | null
  ): { command: string; args: string[]; options: Record<string, unknown> | undefined } {
    const sandbox = this.resolveSandbox(policyResult);
    if (!this.profileManager || !sandbox || process.platform !== 'darwin') {
      return { command, args, options };
    }

    // Skip seatbelt for node-bin — it's already intercepted and needs TTY access
    if (command === '/opt/agenshield/bin/node-bin' || command.endsWith('/node-bin')) {
      debugLog(`cp.wrapWithSeatbelt: SKIP node-bin (already intercepted) command=${command}`);
      return { command, args, options };
    }

    // Skip if command is already sandbox-exec (defense against double-wrapping)
    if (command === '/usr/bin/sandbox-exec' || command.endsWith('/sandbox-exec')) {
      debugLog(`cp.wrapWithSeatbelt: SKIP already sandbox-exec command=${command}`);
      return { command, args, options };
    }

    debugLog(`cp.wrapWithSeatbelt: wrapping command=${command}`);

    // Generate and cache the profile
    const profileContent = this.profileManager.generateProfile(sandbox);
    const profilePath = this.profileManager.getOrCreateProfile(profileContent);

    // Apply env injection and denial
    const env = { ...(options?.env as Record<string, string> || process.env) };
    if (sandbox.envInjection) {
      Object.assign(env, sandbox.envInjection);
    }
    if (sandbox.envDeny) {
      for (const key of sandbox.envDeny) {
        delete env[key];
      }
    }

    return {
      command: '/usr/bin/sandbox-exec',
      args: ['-f', profilePath, command, ...args],
      options: { ...options, env },
    };
  }

  /**
   * Wrap a shell command string with sandbox-exec.
   * For exec/execSync which take a full command string.
   */
  private wrapCommandStringWithSeatbelt(
    command: string,
    options: Record<string, unknown> | undefined,
    policyResult: PolicyCheckResult | null
  ): { command: string; options: Record<string, unknown> | undefined } {
    const sandbox = this.resolveSandbox(policyResult);
    if (!this.profileManager || !sandbox || process.platform !== 'darwin') {
      return { command, options };
    }

    // Skip if command already starts with sandbox-exec (defense against double-wrapping)
    if (command.startsWith('/usr/bin/sandbox-exec ') || command.startsWith('sandbox-exec ')) {
      debugLog(`cp.wrapCommandStringWithSeatbelt: SKIP already sandbox-exec command=${command}`);
      return { command, options };
    }

    debugLog(`cp.wrapCommandStringWithSeatbelt: wrapping command=${command}`);

    const profileContent = this.profileManager.generateProfile(sandbox);
    const profilePath = this.profileManager.getOrCreateProfile(profileContent);

    // Apply env injection and denial
    const env = { ...(options?.env as Record<string, string> || process.env) };
    if (sandbox.envInjection) {
      Object.assign(env, sandbox.envInjection);
    }
    if (sandbox.envDeny) {
      for (const key of sandbox.envDeny) {
        delete env[key];
      }
    }

    return {
      command: `/usr/bin/sandbox-exec -f ${profilePath} ${command}`,
      options: { ...options, env },
    };
  }

  private createInterceptedExec(): typeof childProcess.exec {
    const self = this;
    const original = this.originalExec!;

    return function interceptedExec(
      command: string,
      ...args: any[]
    ): childProcess.ChildProcess {
      // Extract callback
      const callback = typeof args[args.length - 1] === 'function'
        ? args.pop()
        : undefined;
      const options = args[0] as Record<string, unknown> | undefined;

      debugLog(`cp.exec ENTER command=${command} _checking=${self._checking} _executing=${self._executing}`);

      // Re-entrancy guard (also blocks exec→execFile double-interception)
      if (self._checking || self._executing) {
        debugLog(`cp.exec SKIP (re-entrancy) command=${command}`);
        return original(command, ...args, callback) as childProcess.ChildProcess;
      }

      self.eventReporter.intercept('exec', command);

      // Synchronous policy check
      let policyResult: PolicyCheckResult | null = null;
      try {
        policyResult = self.syncPolicyCheck(command);
      } catch (error) {
        // Denied — deliver error via callback on next tick.
        // Use originalSpawn to avoid re-interception through exec→execFile chain.
        debugLog(`cp.exec DENIED command=${command}`);
        const denied = self.originalSpawn!('false', [], { stdio: 'pipe' }) as childProcess.ChildProcess;
        denied.once('error', () => {});
        if (callback) {
          process.nextTick(() => callback(error as Error, '', ''));
        }
        return denied;
      }

      // Apply seatbelt wrapping
      const wrapped = self.wrapCommandStringWithSeatbelt(command, options, policyResult);

      debugLog(`cp.exec calling original command=${wrapped.command}`);
      // Set _executing to prevent exec→execFile double-interception
      self._executing = true;
      try {
        if (wrapped.options) {
          return original(wrapped.command, wrapped.options as childProcess.ExecOptions, callback) as childProcess.ChildProcess;
        }
        return original(wrapped.command, callback) as childProcess.ChildProcess;
      } finally {
        self._executing = false;
      }
    } as typeof childProcess.exec;
  }

  private createInterceptedExecSync(): typeof childProcess.execSync {
    const self = this;
    const original = this.originalExecSync!;

    const interceptedExecSync = function (
      command: string,
      options?: childProcess.ExecSyncOptions
    ): Buffer | string {
      debugLog(`cp.execSync ENTER command=${command} _checking=${self._checking} _executing=${self._executing}`);

      // Re-entrancy guard
      if (self._checking || self._executing) {
        debugLog(`cp.execSync SKIP (re-entrancy) command=${command}`);
        return original(command, options);
      }

      self.eventReporter.intercept('exec', command);

      // Synchronous policy check (throws on deny)
      const policyResult = self.syncPolicyCheck(command);

      // Apply seatbelt wrapping
      const wrapped = self.wrapCommandStringWithSeatbelt(
        command,
        options as Record<string, unknown> | undefined,
        policyResult
      );

      debugLog(`cp.execSync calling original command=${wrapped.command}`);
      self._executing = true;
      try {
        return original(wrapped.command, wrapped.options as childProcess.ExecSyncOptions);
      } finally {
        self._executing = false;
      }
    };

    return interceptedExecSync as typeof childProcess.execSync;
  }

  private createInterceptedSpawn(): typeof childProcess.spawn {
    const self = this;
    const original = this.originalSpawn!;

    const interceptedSpawn = function (
      command: string,
      args?: readonly string[],
      options?: childProcess.SpawnOptions
    ): childProcess.ChildProcess {
      const fullCmd = args ? `${command} ${args.join(' ')}` : command;
      debugLog(`cp.spawn ENTER command=${fullCmd} _checking=${self._checking} _executing=${self._executing}`);

      // Re-entrancy guard
      if (self._checking || self._executing) {
        debugLog(`cp.spawn SKIP (re-entrancy) command=${fullCmd}`);
        return original(command, args as string[], options || {});
      }

      self.eventReporter.intercept('exec', fullCmd);

      // Synchronous policy check
      let policyResult: PolicyCheckResult | null = null;
      try {
        policyResult = self.syncPolicyCheck(fullCmd);
      } catch (error) {
        // Denied — return a short-lived process that emits error.
        // The safety no-op handler prevents Node from throwing an uncaught
        // exception if the caller hasn't attached an 'error' listener yet.
        // Callers that DO listen will still receive the event.
        debugLog(`cp.spawn DENIED command=${fullCmd}`);
        const denied = original('false', [], { stdio: 'pipe' });
        denied.once('error', () => {});
        process.nextTick(() => {
          denied.emit('error', error);
        });
        return denied;
      }

      // Apply seatbelt wrapping
      const wrapped = self.wrapWithSeatbelt(
        command,
        Array.from(args || []),
        options as Record<string, unknown> | undefined,
        policyResult
      );

      debugLog(`cp.spawn calling original command=${wrapped.command} args=${wrapped.args.join(' ')}`);
      return original(wrapped.command, wrapped.args, wrapped.options as childProcess.SpawnOptions || {});
    };

    return interceptedSpawn as typeof childProcess.spawn;
  }

  private createInterceptedSpawnSync(): typeof childProcess.spawnSync {
    const self = this;
    const original = this.originalSpawnSync!;

    return function interceptedSpawnSync(
      command: string,
      args?: readonly string[],
      options?: childProcess.SpawnSyncOptions
    ): childProcess.SpawnSyncReturns<Buffer | string> {
      const fullCommand = args ? `${command} ${args.join(' ')}` : command;
      debugLog(`cp.spawnSync ENTER command=${fullCommand} _checking=${self._checking} _executing=${self._executing}`);

      // Re-entrancy guard
      if (self._checking || self._executing) {
        debugLog(`cp.spawnSync SKIP (re-entrancy) command=${fullCommand}`);
        return original(command, args as string[], options);
      }

      self.eventReporter.intercept('exec', fullCommand);

      // Synchronous policy check
      let policyResult: PolicyCheckResult | null = null;
      try {
        policyResult = self.syncPolicyCheck(fullCommand);
      } catch (error) {
        debugLog(`cp.spawnSync DENIED command=${fullCommand}`);
        return {
          pid: -1,
          output: [],
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(
            error instanceof PolicyDeniedError
              ? (error.message || 'Policy denied')
              : (error as Error).message
          ),
          status: 1,
          signal: null,
          error: error as Error,
        };
      }

      // Apply seatbelt wrapping
      const wrapped = self.wrapWithSeatbelt(
        command,
        Array.from(args || []),
        options as Record<string, unknown> | undefined,
        policyResult
      );

      debugLog(`cp.spawnSync calling original command=${wrapped.command}`);
      return original(
        wrapped.command,
        wrapped.args,
        wrapped.options as childProcess.SpawnSyncOptions
      );
    } as typeof childProcess.spawnSync;
  }

  private createInterceptedExecFile(): typeof childProcess.execFile {
    const self = this;
    const original = this.originalExecFile!;

    return function interceptedExecFile(
      file: string,
      ...rest: any[]
    ): childProcess.ChildProcess {
      // Re-entrancy guard (also blocks exec→execFile double-interception)
      if (self._checking || self._executing) {
        return original(file, ...rest) as childProcess.ChildProcess;
      }

      // Parse arguments: execFile(file, args?, options?, callback?)
      let args: string[] = [];
      let options: Record<string, unknown> | undefined;
      let callback: ((...cbArgs: any[]) => void) | undefined;

      for (const arg of rest) {
        if (typeof arg === 'function') {
          callback = arg;
        } else if (Array.isArray(arg)) {
          args = arg;
        } else if (typeof arg === 'object' && arg !== null) {
          options = arg;
        }
      }

      const fullCommand = args.length > 0 ? `${file} ${args.join(' ')}` : file;
      debugLog(`cp.execFile ENTER command=${fullCommand}`);

      self.eventReporter.intercept('exec', fullCommand);

      // Synchronous policy check
      let policyResult: PolicyCheckResult | null = null;
      try {
        policyResult = self.syncPolicyCheck(fullCommand);
      } catch (error) {
        // Denied — deliver error via callback.
        // Safety no-op handler prevents uncaught exception.
        debugLog(`cp.execFile DENIED command=${fullCommand}`);
        const denied = self.originalSpawn!('false', [], { stdio: 'pipe' }) as childProcess.ChildProcess;
        denied.once('error', () => {});
        if (callback) {
          process.nextTick(() => callback!(error as Error, '', ''));
        }
        return denied;
      }

      // Apply seatbelt wrapping
      const wrapped = self.wrapWithSeatbelt(file, args, options, policyResult);

      debugLog(`cp.execFile calling original command=${wrapped.command}`);
      if (callback) {
        return original(
          wrapped.command,
          wrapped.args,
          wrapped.options as childProcess.ExecFileOptions,
          callback
        ) as childProcess.ChildProcess;
      }
      // execFile without callback — pass args and options as separate params
      return original(
        wrapped.command,
        wrapped.args as readonly string[],
        (wrapped.options || {}) as childProcess.ExecFileOptions,
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        () => {}
      ) as childProcess.ChildProcess;
    } as typeof childProcess.execFile;
  }

  private createInterceptedFork(): typeof childProcess.fork {
    const self = this;
    const original = this.originalFork!;

    const interceptedFork = function (
      modulePath: string | URL,
      args?: readonly string[],
      options?: childProcess.ForkOptions
    ): childProcess.ChildProcess {
      // Re-entrancy guard
      if (self._checking || self._executing) {
        return original(modulePath, args as string[], options);
      }

      const pathStr = modulePath.toString();
      const fullCommand = `fork:${pathStr}`;
      debugLog(`cp.fork ENTER command=${fullCommand}`);

      self.eventReporter.intercept('exec', fullCommand);

      // Synchronous policy check
      let policyResult: PolicyCheckResult | null = null;
      try {
        policyResult = self.syncPolicyCheck(fullCommand);
      } catch (error) {
        debugLog(`cp.fork DENIED command=${fullCommand}`);
        // Return a short-lived process that emits error.
        // Safety no-op handler prevents uncaught exception if caller
        // hasn't attached an 'error' listener before nextTick fires.
        const denied = self.originalSpawn!('false', [], { stdio: 'pipe' });
        denied.once('error', () => {});
        process.nextTick(() => {
          denied.emit('error', error);
        });
        return denied;
      }

      // For fork, seatbelt wrapping is more complex since fork specifically
      // runs node. We apply env injection/denial but don't wrap with sandbox-exec
      // because fork uses an internal IPC channel that sandbox-exec would break.
      if (policyResult?.sandbox) {
        const sandbox = policyResult.sandbox;
        const env = { ...(options?.env || process.env) };
        if (sandbox.envInjection) {
          Object.assign(env, sandbox.envInjection);
        }
        if (sandbox.envDeny) {
          for (const key of sandbox.envDeny) {
            delete env[key];
          }
        }
        options = { ...options, env };
      }

      debugLog(`cp.fork calling original module=${pathStr}`);
      return original(modulePath, args as string[], options);
    };

    return interceptedFork as typeof childProcess.fork;
  }
}
