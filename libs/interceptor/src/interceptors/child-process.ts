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
import { ProfileManager, filterEnvByAllowlist } from '@agenshield/seatbelt';
import { debugLog } from '../debug-log.js';
import type { PolicyExecutionContext, SandboxConfig, ResourceLimits } from '@agenshield/ipc';
import type { PolicyCheckResult } from '../policy/evaluator.js';
import { ResourceMonitor } from '../resource/resource-monitor.js';

// Capture original fs.existsSync at module load time (before any interceptor patches)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _existsSync = require('node:fs').existsSync as (p: string) => boolean;

// Use require() for modules we need to monkey-patch (ESM imports are immutable)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcessModule = require('node:child_process') as typeof childProcess;

export class ChildProcessInterceptor extends BaseInterceptor {
  private syncClient: SyncClient;
  private _checking = false;
  private _executing = false;  // Guards exec→execFile re-entrancy
  private profileManager: ProfileManager | null = null;
  private resourceMonitor: ResourceMonitor | null = null;
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
      socketPath: config?.socketPath || `${process.env['AGENSHIELD_USER_HOME'] || process.env['HOME'] || ''}/.agenshield/run/agenshield.sock`,
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

    // Initialize ResourceMonitor if resource monitoring is enabled
    if (config?.enableResourceMonitoring) {
      this.resourceMonitor = new ResourceMonitor(this.eventReporter);
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

    this.resourceMonitor?.stopAll();

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
   * Resolve resource limits for a monitored process.
   * Per-policy limits (from sandbox config) override global defaults.
   */
  private resolveResourceLimits(policyResult: PolicyCheckResult | null): ResourceLimits | undefined {
    return policyResult?.sandbox?.resourceLimits ?? this.interceptorConfig?.defaultResourceLimits;
  }

  /**
   * Attach resource monitoring to a spawned child process if limits are configured.
   */
  private trackChild(child: childProcess.ChildProcess, command: string, policyResult: PolicyCheckResult | null): void {
    if (!this.resourceMonitor) return;
    const limits = this.resolveResourceLimits(policyResult);
    if (!limits || !child.pid) return;
    this.resourceMonitor.track(child, command, limits, policyResult?.traceId);
  }

  /**
   * Build execution context from config for RPC calls.
   * Reads trace env vars for execution chain tracking.
   */
  private getPolicyExecutionContext(): PolicyExecutionContext {
    const config = this.interceptorConfig;
    const parentDepth = parseInt(process.env['AGENSHIELD_DEPTH'] || '0', 10);
    return {
      callerType: config?.contextType || 'agent',
      skillSlug: config?.contextSkillSlug,
      agentId: config?.contextAgentId,
      depth: parentDepth + 1,
      parentTraceId: process.env['AGENSHIELD_TRACE_ID'],
    };
  }

  /**
   * Strip guarded-shell wrapper from a command string so that policy checking
   * and event reporting see the actual command (e.g. "gog auth list") instead
   * of "/usr/local/bin/guarded-shell -c gog auth list".
   * The original command is preserved for actual execution and seatbelt wrapping.
   */
  private unwrapGuardedShell(command: string): string {
    const trimmed = command.trim();
    // Full path: "/usr/local/bin/guarded-shell -c <cmd>"
    const fullPrefix = '/usr/local/bin/guarded-shell ';
    if (trimmed.startsWith(fullPrefix)) {
      const rest = trimmed.slice(fullPrefix.length).trim();
      return rest.startsWith('-c ') ? rest.slice(3).trim() : rest;
    }
    // Basename: "guarded-shell -c <cmd>"
    const basePrefix = 'guarded-shell ';
    if (trimmed.startsWith(basePrefix)) {
      const rest = trimmed.slice(basePrefix.length).trim();
      return rest.startsWith('-c ') ? rest.slice(3).trim() : rest;
    }
    // Per-target path: "/Users/<user>/.agenshield/bin/guarded-shell -c <cmd>"
    // Match any absolute path ending in /guarded-shell
    const gsIdx = trimmed.indexOf('/guarded-shell ');
    if (gsIdx >= 0 && trimmed[0] === '/') {
      const rest = trimmed.slice(gsIdx + '/guarded-shell '.length).trim();
      return rest.startsWith('-c ') ? rest.slice(3).trim() : rest;
    }
    return command;
  }

  /** System binary directories whose paths should be rewritten to wrappers */
  private static readonly SYSTEM_BIN_DIRS = ['/usr/bin/', '/usr/sbin/', '/bin/', '/sbin/', '/usr/local/bin/', '/opt/homebrew/bin/'];

  /** Binaries exempt from rewriting (shell necessities) */
  private static readonly REWRITE_EXEMPT = new Set(['/bin/sh', '/bin/bash', '/bin/zsh', '/usr/bin/env']);

  /**
   * Rewrite a system binary absolute path to the wrapper equivalent.
   * /usr/bin/cat → ~/bin/cat (if wrapper exists)
   */
  private rewriteSystemBinaryPath(command: string): string {
    if (ChildProcessInterceptor.REWRITE_EXEMPT.has(command)) return command;

    const isSystemBin = ChildProcessInterceptor.SYSTEM_BIN_DIRS.some(d => command.startsWith(d));
    if (!isSystemBin) return command;

    const basename = command.split('/').pop();
    if (!basename) return command;

    const home = process.env['HOME'] || '';
    if (!home) return command;

    const wrapperPath = `${home}/bin/${basename}`;
    if (_existsSync(wrapperPath)) {
      debugLog(`cp.rewriteSystemBinary: ${command} → ${wrapperPath}`);
      return wrapperPath;
    }

    return command; // No wrapper — let policy check handle denial
  }

  /**
   * Rewrite first token of a shell command string if it's a system binary path.
   */
  private rewriteCommandString(command: string): string {
    const trimmed = command.trimStart();
    const spaceIdx = trimmed.indexOf(' ');
    const cmdPath = spaceIdx === -1 ? trimmed : trimmed.substring(0, spaceIdx);
    const rest = spaceIdx === -1 ? '' : trimmed.substring(spaceIdx);
    const rewritten = this.rewriteSystemBinaryPath(cmdPath);
    if (rewritten === cmdPath) return command;
    return rewritten + rest;
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
      envAllow: [],
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

    // Build filtered environment: allowlist → inject → deny
    const sourceEnv = (options?.env as Record<string, string>) || (process.env as Record<string, string>);
    const env = filterEnvByAllowlist(sourceEnv, sandbox.envAllow);
    if (sandbox.envInjection) {
      Object.assign(env, sandbox.envInjection);
    }
    if (sandbox.envDeny) {
      for (const key of sandbox.envDeny) {
        delete env[key];
      }
    }
    // Belt-and-suspenders: strip NODE_OPTIONS to prevent --require code injection
    delete env['NODE_OPTIONS'];

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

    // Build filtered environment: allowlist → inject → deny
    const sourceEnv = (options?.env as Record<string, string>) || (process.env as Record<string, string>);
    const env = filterEnvByAllowlist(sourceEnv, sandbox.envAllow);
    if (sandbox.envInjection) {
      Object.assign(env, sandbox.envInjection);
    }
    if (sandbox.envDeny) {
      for (const key of sandbox.envDeny) {
        delete env[key];
      }
    }
    // Belt-and-suspenders: strip NODE_OPTIONS to prevent --require code injection
    delete env['NODE_OPTIONS'];

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

      // Rewrite system binary paths to wrapper equivalents
      command = self.rewriteCommandString(command);

      const policyTarget = self.unwrapGuardedShell(command);
      self.eventReporter.intercept('exec', policyTarget);

      // Synchronous policy check
      let policyResult: PolicyCheckResult | null = null;
      try {
        policyResult = self.syncPolicyCheck(policyTarget);
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
      let child: childProcess.ChildProcess;
      try {
        if (wrapped.options) {
          child = original(wrapped.command, wrapped.options as childProcess.ExecOptions, callback) as childProcess.ChildProcess;
        } else {
          child = original(wrapped.command, callback) as childProcess.ChildProcess;
        }
      } finally {
        self._executing = false;
      }
      self.trackChild(child, policyTarget, policyResult);
      return child;
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

      // Rewrite system binary paths to wrapper equivalents
      command = self.rewriteCommandString(command);

      const policyTarget = self.unwrapGuardedShell(command);
      self.eventReporter.intercept('exec', policyTarget);

      // Synchronous policy check (throws on deny)
      const policyResult = self.syncPolicyCheck(policyTarget);

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
      debugLog(`cp.spawn ENTER command=${command} _checking=${self._checking} _executing=${self._executing}`);

      // Re-entrancy guard
      if (self._checking || self._executing) {
        const fullCmd = args ? `${command} ${args.join(' ')}` : command;
        debugLog(`cp.spawn SKIP (re-entrancy) command=${fullCmd}`);
        return original(command, args as string[], options || {});
      }

      // Rewrite system binary paths to wrapper equivalents
      command = self.rewriteSystemBinaryPath(command);

      const fullCmd = args ? `${command} ${args.join(' ')}` : command;
      const policyTarget = self.unwrapGuardedShell(fullCmd);
      self.eventReporter.intercept('exec', policyTarget);

      // Synchronous policy check
      let policyResult: PolicyCheckResult | null = null;
      try {
        policyResult = self.syncPolicyCheck(policyTarget);
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
      const child = original(wrapped.command, wrapped.args, wrapped.options as childProcess.SpawnOptions || {});
      self.trackChild(child, policyTarget, policyResult);
      return child;
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
      debugLog(`cp.spawnSync ENTER command=${command} _checking=${self._checking} _executing=${self._executing}`);

      // Re-entrancy guard
      if (self._checking || self._executing) {
        const fullCommand = args ? `${command} ${args.join(' ')}` : command;
        debugLog(`cp.spawnSync SKIP (re-entrancy) command=${fullCommand}`);
        return original(command, args as string[], options);
      }

      // Rewrite system binary paths to wrapper equivalents
      command = self.rewriteSystemBinaryPath(command);

      const fullCommand = args ? `${command} ${args.join(' ')}` : command;
      const policyTarget = self.unwrapGuardedShell(fullCommand);
      self.eventReporter.intercept('exec', policyTarget);

      // Synchronous policy check
      let policyResult: PolicyCheckResult | null = null;
      try {
        policyResult = self.syncPolicyCheck(policyTarget);
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

      // Rewrite system binary paths to wrapper equivalents
      file = self.rewriteSystemBinaryPath(file);

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

      const policyTarget = self.unwrapGuardedShell(fullCommand);
      self.eventReporter.intercept('exec', policyTarget);

      // Synchronous policy check
      let policyResult: PolicyCheckResult | null = null;
      try {
        policyResult = self.syncPolicyCheck(policyTarget);
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
      let child: childProcess.ChildProcess;
      if (callback) {
        child = original(
          wrapped.command,
          wrapped.args,
          wrapped.options as childProcess.ExecFileOptions,
          callback
        ) as childProcess.ChildProcess;
      } else {
        // execFile without callback — pass args and options as separate params
        child = original(
          wrapped.command,
          wrapped.args as readonly string[],
          (wrapped.options || {}) as childProcess.ExecFileOptions,
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          () => {}
        ) as childProcess.ChildProcess;
      }
      self.trackChild(child, policyTarget, policyResult);
      return child;
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

      // Rewrite system binary paths to wrapper equivalents
      if (typeof modulePath === 'string') {
        modulePath = self.rewriteSystemBinaryPath(modulePath);
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
        const sourceEnv = (options?.env || process.env) as Record<string, string>;
        const env = filterEnvByAllowlist(sourceEnv, sandbox.envAllow);
        if (sandbox.envInjection) {
          Object.assign(env, sandbox.envInjection);
        }
        if (sandbox.envDeny) {
          for (const key of sandbox.envDeny) {
            delete env[key];
          }
        }
        delete env['NODE_OPTIONS'];
        options = { ...options, env };
      }

      debugLog(`cp.fork calling original module=${pathStr}`);
      const child = original(modulePath, args as string[], options);
      self.trackChild(child, fullCommand, policyResult);
      return child;
    };

    return interceptedFork as typeof childProcess.fork;
  }
}
