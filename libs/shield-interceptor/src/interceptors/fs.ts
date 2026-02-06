/**
 * File System Interceptor
 *
 * Intercepts fs module calls.
 */

import type * as fs from 'node:fs';
import type * as fsPromises from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BaseInterceptor, type BaseInterceptorOptions } from './base.js';
import { SyncClient } from '../client/sync-client.js';
import { PolicyDeniedError } from '../errors.js';
import { debugLog } from '../debug-log.js';

// Use require() for modules we need to monkey-patch (ESM imports are immutable)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsModule = require('node:fs') as typeof fs;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsPromisesModule = require('node:fs/promises') as typeof fsPromises;

/**
 * Safely override a module property, falling back to Object.defineProperty
 * for getter-only properties (Node.js v24+).
 */
function safeOverride(target: any, prop: string, value: any): void {
  try {
    target[prop] = value;
  } catch {
    Object.defineProperty(target, prop, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
}

/**
 * Normalize a path argument to a plain filesystem path.
 * Node.js ESM loader passes file:// URLs to fs.readFileSync;
 * strip the protocol so policy checks match allowed directories.
 */
function normalizePathArg(p: fs.PathLike): string {
  if (p instanceof URL) {
    return fileURLToPath(p);
  }
  const s = p.toString();
  if (s.startsWith('file://')) {
    try { return fileURLToPath(new URL(s)); } catch { /* fall through */ }
  }
  return s;
}

export class FsInterceptor extends BaseInterceptor {
  private syncClient: SyncClient;
  private originals: Map<string, Function> = new Map();
  private _checking = false;

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

    // Intercept async methods
    this.interceptMethod(fsModule, 'readFile', 'file_read');
    this.interceptMethod(fsModule, 'writeFile', 'file_write');
    this.interceptMethod(fsModule, 'appendFile', 'file_write');
    this.interceptMethod(fsModule, 'unlink', 'file_write');
    this.interceptMethod(fsModule, 'mkdir', 'file_write');
    this.interceptMethod(fsModule, 'rmdir', 'file_write');
    this.interceptMethod(fsModule, 'rm', 'file_write');
    this.interceptMethod(fsModule, 'readdir', 'file_list');

    // Intercept sync methods
    this.interceptSyncMethod(fsModule, 'readFileSync', 'file_read');
    this.interceptSyncMethod(fsModule, 'writeFileSync', 'file_write');
    this.interceptSyncMethod(fsModule, 'appendFileSync', 'file_write');
    this.interceptSyncMethod(fsModule, 'unlinkSync', 'file_write');
    this.interceptSyncMethod(fsModule, 'mkdirSync', 'file_write');
    this.interceptSyncMethod(fsModule, 'rmdirSync', 'file_write');
    this.interceptSyncMethod(fsModule, 'rmSync', 'file_write');
    this.interceptSyncMethod(fsModule, 'readdirSync', 'file_list');

    // Intercept promises API
    this.interceptPromiseMethod(fsPromisesModule, 'readFile', 'file_read');
    this.interceptPromiseMethod(fsPromisesModule, 'writeFile', 'file_write');
    this.interceptPromiseMethod(fsPromisesModule, 'appendFile', 'file_write');
    this.interceptPromiseMethod(fsPromisesModule, 'unlink', 'file_write');
    this.interceptPromiseMethod(fsPromisesModule, 'mkdir', 'file_write');
    this.interceptPromiseMethod(fsPromisesModule, 'rmdir', 'file_write');
    this.interceptPromiseMethod(fsPromisesModule, 'rm', 'file_write');
    this.interceptPromiseMethod(fsPromisesModule, 'readdir', 'file_list');

    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed) return;

    // Restore all originals
    for (const [key, original] of this.originals) {
      const [moduleName, methodName] = key.split(':');
      const module = moduleName === 'fs' ? fsModule : fsPromisesModule;
      safeOverride(module, methodName, original);
    }

    this.originals.clear();
    this.installed = false;
  }

  private interceptMethod(
    module: typeof fs,
    methodName: string,
    operation: string
  ): void {
    const original = (module as any)[methodName];
    if (!original) return;

    const key = `fs:${methodName}`;
    this.originals.set(key, original);

    const self = this;

    safeOverride(module, methodName, function intercepted(
      path: fs.PathLike,
      ...args: any[]
    ): void {
      const pathString = normalizePathArg(path);

      // Extract callback
      const callback = typeof args[args.length - 1] === 'function'
        ? args.pop()
        : undefined;

      debugLog(`fs.${methodName} ENTER (async) path=${pathString} _checking=${self._checking}`);

      // Re-entrancy guard: skip policy check if already inside one
      if (self._checking) {
        debugLog(`fs.${methodName} SKIP (re-entrancy, async) path=${pathString}`);
        original.call(module, path, ...args, callback);
        return;
      }

      self.eventReporter.intercept(operation, pathString);

      // Check policy asynchronously
      self.checkPolicy(operation, pathString)
        .then(() => {
          debugLog(`fs.${methodName} policy OK (async) path=${pathString}`);
          original.call(module, path, ...args, callback);
        })
        .catch((error: any) => {
          debugLog(`fs.${methodName} policy ERROR (async): ${error.message} path=${pathString}`);
          if (callback) {
            callback(error);
          }
        });
    });
  }

  private interceptSyncMethod(
    module: typeof fs,
    methodName: string,
    operation: string
  ): void {
    const original = (module as any)[methodName];
    if (!original) return;

    const key = `fs:${methodName}`;
    this.originals.set(key, original);

    const self = this;

    safeOverride(module, methodName, function interceptedSync(
      path: fs.PathLike,
      ...args: any[]
    ): any {
      const pathString = normalizePathArg(path);

      debugLog(`fs.${methodName} ENTER path=${pathString} _checking=${self._checking}`);

      // Re-entrancy guard: skip policy check if already inside one
      if (self._checking) {
        debugLog(`fs.${methodName} SKIP (re-entrancy) path=${pathString}`);
        return original.call(module, path, ...args);
      }

      self._checking = true;
      try {
        self.eventReporter.intercept(operation, pathString);

        // Check policy synchronously via daemon's policy_check RPC
        debugLog(`fs.${methodName} policy_check START path=${pathString}`);
        const result = self.syncClient.request<{ allowed: boolean; reason?: string }>(
          'policy_check',
          { operation, target: pathString }
        );
        debugLog(`fs.${methodName} policy_check DONE allowed=${result.allowed} path=${pathString}`);

        if (!result.allowed) {
          throw new PolicyDeniedError(result.reason || 'Operation denied by policy', {
            operation,
            target: pathString,
          });
        }
      } catch (error) {
        debugLog(`fs.${methodName} policy_check ERROR: ${(error as Error).message} path=${pathString}`);
        if (error instanceof PolicyDeniedError) {
          throw error;
        }

        if (!self.failOpen) {
          throw error;
        }
      } finally {
        self._checking = false;
      }

      debugLog(`fs.${methodName} calling original path=${pathString}`);
      return original.call(module, path, ...args);
    });
  }

  private interceptPromiseMethod(
    module: typeof fsPromises,
    methodName: string,
    operation: string
  ): void {
    const original = (module as any)[methodName];
    if (!original) return;

    const key = `fsPromises:${methodName}`;
    this.originals.set(key, original);

    const self = this;

    safeOverride(module, methodName, async function interceptedPromise(
      path: fs.PathLike,
      ...args: any[]
    ): Promise<any> {
      const pathString = normalizePathArg(path);

      debugLog(`fsPromises.${methodName} ENTER path=${pathString} _checking=${self._checking}`);

      // Re-entrancy guard: skip policy check if already inside one
      if (self._checking) {
        debugLog(`fsPromises.${methodName} SKIP (re-entrancy) path=${pathString}`);
        return original.call(module, path, ...args);
      }

      self.eventReporter.intercept(operation, pathString);

      // Check policy
      await self.checkPolicy(operation, pathString);
      debugLog(`fsPromises.${methodName} policy OK path=${pathString}`);

      return original.call(module, path, ...args);
    });
  }
}
