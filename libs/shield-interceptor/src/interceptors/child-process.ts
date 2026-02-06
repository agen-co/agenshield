/**
 * Child Process Interceptor
 *
 * Intercepts child_process module calls.
 */

import type * as childProcess from 'node:child_process';
import { BaseInterceptor, type BaseInterceptorOptions } from './base.js';
import { SyncClient } from '../client/sync-client.js';
import { PolicyDeniedError } from '../errors.js';
import { debugLog } from '../debug-log.js';

// Use require() for modules we need to monkey-patch (ESM imports are immutable)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcessModule = require('node:child_process') as typeof childProcess;

export class ChildProcessInterceptor extends BaseInterceptor {
  private syncClient: SyncClient;
  private _checking = false;
  private originalExec: typeof childProcess.exec | null = null;
  private originalExecSync: typeof childProcess.execSync | null = null;
  private originalSpawn: typeof childProcess.spawn | null = null;
  private originalSpawnSync: typeof childProcess.spawnSync | null = null;
  private originalExecFile: typeof childProcess.execFile | null = null;
  private originalFork: typeof childProcess.fork | null = null;

  constructor(options: BaseInterceptorOptions) {
    super(options);
    this.syncClient = new SyncClient({
      socketPath: '/var/run/agenshield/agenshield.sock',
      httpHost: 'localhost',
      httpPort: 5201, // Broker uses 5201
      timeout: 30000,
    });
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

      debugLog(`cp.exec ENTER command=${command} _checking=${self._checking}`);

      // Re-entrancy guard
      if (self._checking) {
        debugLog(`cp.exec SKIP (re-entrancy) command=${command}`);
        return original(command, ...args, callback) as childProcess.ChildProcess;
      }

      self.eventReporter.intercept('exec', command);

      // Check policy asynchronously
      self.checkPolicy('exec', command)
        .then(() => {
          // Execute original
          original(command, ...args, callback);
        })
        .catch((error) => {
          if (callback) {
            callback(error, '', '');
          }
        });

      // Return a dummy ChildProcess (not ideal but maintains interface)
      return original('echo ""') as childProcess.ChildProcess;
    } as typeof childProcess.exec;
  }

  private createInterceptedExecSync(): typeof childProcess.execSync {
    const self = this;
    const original = this.originalExecSync!;

    const interceptedExecSync = function (
      command: string,
      options?: childProcess.ExecSyncOptions
    ): Buffer | string {
      debugLog(`cp.execSync ENTER command=${command} _checking=${self._checking}`);

      // Re-entrancy guard
      if (self._checking) {
        debugLog(`cp.execSync SKIP (re-entrancy) command=${command}`);
        return original(command, options);
      }

      self._checking = true;
      try {
        self.eventReporter.intercept('exec', command);

        // Check policy synchronously using sync client
        debugLog(`cp.execSync policy_check START command=${command}`);
        const result = self.syncClient.request<{ allowed: boolean; reason?: string }>(
          'policy_check',
          { operation: 'exec', target: command }
        );
        debugLog(`cp.execSync policy_check DONE allowed=${result.allowed} command=${command}`);

        if (!result.allowed) {
          throw new PolicyDeniedError(result.reason || 'Operation denied by policy', {
            operation: 'exec',
            target: command,
          });
        }
      } catch (error) {
        debugLog(`cp.execSync policy_check ERROR: ${(error as Error).message} command=${command}`);
        if (error instanceof PolicyDeniedError) {
          throw error;
        }

        if (!self.failOpen) {
          throw error;
        }
      } finally {
        self._checking = false;
      }

      debugLog(`cp.execSync calling original command=${command}`);
      return original(command, options);
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
      debugLog(`cp.spawn ENTER command=${fullCmd} _checking=${self._checking}`);

      // Re-entrancy guard
      if (self._checking) {
        debugLog(`cp.spawn SKIP (re-entrancy) command=${fullCmd}`);
        return original(command, args as string[], options || {});
      }

      const fullCommand = args ? `${command} ${args.join(' ')}` : command;

      self.eventReporter.intercept('exec', fullCommand);

      // Check policy asynchronously
      self.checkPolicy('exec', fullCommand).catch((error) => {
        // Can't easily abort spawn, log the error
        self.eventReporter.error('exec', fullCommand, error.message);
      });

      return original(command, args as string[], options || {});
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
      debugLog(`cp.spawnSync ENTER command=${fullCommand} _checking=${self._checking}`);

      // Re-entrancy guard
      if (self._checking) {
        debugLog(`cp.spawnSync SKIP (re-entrancy) command=${fullCommand}`);
        return original(command, args as string[], options);
      }

      self._checking = true;
      try {
        self.eventReporter.intercept('exec', fullCommand);

        // Check policy synchronously
        debugLog(`cp.spawnSync policy_check START command=${fullCommand}`);
        const result = self.syncClient.request<{ allowed: boolean; reason?: string }>(
          'policy_check',
          { operation: 'exec', target: fullCommand }
        );
        debugLog(`cp.spawnSync policy_check DONE allowed=${result.allowed} command=${fullCommand}`);

        if (!result.allowed) {
          return {
            pid: -1,
            output: [],
            stdout: Buffer.alloc(0),
            stderr: Buffer.from(result.reason || 'Policy denied'),
            status: 1,
            signal: null,
            error: new PolicyDeniedError(result.reason || 'Policy denied'),
          };
        }
      } catch (error) {
        debugLog(`cp.spawnSync policy_check ERROR: ${(error as Error).message} command=${fullCommand}`);
        if (!self.failOpen) {
          return {
            pid: -1,
            output: [],
            stdout: Buffer.alloc(0),
            stderr: Buffer.from((error as Error).message),
            status: 1,
            signal: null,
            error: error as Error,
          };
        }
      } finally {
        self._checking = false;
      }

      debugLog(`cp.spawnSync calling original command=${fullCommand}`);
      return original(command, args as string[], options);
    } as typeof childProcess.spawnSync;
  }

  private createInterceptedExecFile(): typeof childProcess.execFile {
    const self = this;
    const original = this.originalExecFile!;

    return function interceptedExecFile(
      file: string,
      ...args: any[]
    ): childProcess.ChildProcess {
      // Re-entrancy guard
      if (self._checking) {
        return original(file, ...args) as childProcess.ChildProcess;
      }

      self.eventReporter.intercept('exec', file);

      // Check policy asynchronously
      self.checkPolicy('exec', file).catch((error) => {
        self.eventReporter.error('exec', file, error.message);
      });

      return original(file, ...args) as childProcess.ChildProcess;
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
      if (self._checking) {
        return original(modulePath, args as string[], options);
      }

      const pathStr = modulePath.toString();
      self.eventReporter.intercept('exec', `fork:${pathStr}`);

      // Check policy asynchronously
      self.checkPolicy('exec', `fork:${pathStr}`).catch((error) => {
        self.eventReporter.error('exec', pathStr, error.message);
      });

      return original(modulePath, args as string[], options);
    };

    return interceptedFork as typeof childProcess.fork;
  }
}
