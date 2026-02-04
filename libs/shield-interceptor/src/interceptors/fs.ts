/**
 * File System Interceptor
 *
 * Intercepts fs module calls.
 */

import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { BaseInterceptor, type BaseInterceptorOptions } from './base.js';
import { SyncClient } from '../client/sync-client.js';
import { PolicyDeniedError } from '../errors.js';

export class FsInterceptor extends BaseInterceptor {
  private syncClient: SyncClient;
  private originals: Map<string, Function> = new Map();

  constructor(options: BaseInterceptorOptions) {
    super(options);
    this.syncClient = new SyncClient({
      socketPath: '/var/run/agenshield.sock',
      httpHost: 'localhost',
      httpPort: 6969,
      timeout: 30000,
    });
  }

  install(): void {
    if (this.installed) return;

    // Intercept async methods
    this.interceptMethod(fs, 'readFile', 'file_read');
    this.interceptMethod(fs, 'writeFile', 'file_write');
    this.interceptMethod(fs, 'appendFile', 'file_write');
    this.interceptMethod(fs, 'unlink', 'file_write');
    this.interceptMethod(fs, 'mkdir', 'file_write');
    this.interceptMethod(fs, 'rmdir', 'file_write');
    this.interceptMethod(fs, 'rm', 'file_write');
    this.interceptMethod(fs, 'readdir', 'file_list');

    // Intercept sync methods
    this.interceptSyncMethod(fs, 'readFileSync', 'file_read');
    this.interceptSyncMethod(fs, 'writeFileSync', 'file_write');
    this.interceptSyncMethod(fs, 'appendFileSync', 'file_write');
    this.interceptSyncMethod(fs, 'unlinkSync', 'file_write');
    this.interceptSyncMethod(fs, 'mkdirSync', 'file_write');
    this.interceptSyncMethod(fs, 'rmdirSync', 'file_write');
    this.interceptSyncMethod(fs, 'rmSync', 'file_write');
    this.interceptSyncMethod(fs, 'readdirSync', 'file_list');

    // Intercept promises API
    this.interceptPromiseMethod(fsPromises, 'readFile', 'file_read');
    this.interceptPromiseMethod(fsPromises, 'writeFile', 'file_write');
    this.interceptPromiseMethod(fsPromises, 'appendFile', 'file_write');
    this.interceptPromiseMethod(fsPromises, 'unlink', 'file_write');
    this.interceptPromiseMethod(fsPromises, 'mkdir', 'file_write');
    this.interceptPromiseMethod(fsPromises, 'rmdir', 'file_write');
    this.interceptPromiseMethod(fsPromises, 'rm', 'file_write');
    this.interceptPromiseMethod(fsPromises, 'readdir', 'file_list');

    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed) return;

    // Restore all originals
    for (const [key, original] of this.originals) {
      const [moduleName, methodName] = key.split(':');
      const module = moduleName === 'fs' ? fs : fsPromises;
      (module as any)[methodName] = original;
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

    (module as any)[methodName] = function intercepted(
      path: fs.PathLike,
      ...args: any[]
    ): void {
      const pathString = path.toString();

      // Extract callback
      const callback = typeof args[args.length - 1] === 'function'
        ? args.pop()
        : undefined;

      self.eventReporter.intercept(operation, pathString);

      // Check policy asynchronously
      self.checkPolicy(operation, pathString)
        .then(() => {
          original.call(module, path, ...args, callback);
        })
        .catch((error) => {
          if (callback) {
            callback(error);
          }
        });
    };
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

    (module as any)[methodName] = function interceptedSync(
      path: fs.PathLike,
      ...args: any[]
    ): any {
      const pathString = path.toString();

      self.eventReporter.intercept(operation, pathString);

      // Check policy synchronously
      try {
        const result = self.syncClient.request<{ allowed: boolean; reason?: string }>(
          'policy_check',
          { operation, target: pathString }
        );

        if (!result.allowed) {
          throw new PolicyDeniedError(result.reason || 'Operation denied by policy', {
            operation,
            target: pathString,
          });
        }
      } catch (error) {
        if (error instanceof PolicyDeniedError) {
          throw error;
        }

        if (!self.failOpen) {
          throw error;
        }
      }

      return original.call(module, path, ...args);
    };
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

    (module as any)[methodName] = async function interceptedPromise(
      path: fs.PathLike,
      ...args: any[]
    ): Promise<any> {
      const pathString = path.toString();

      self.eventReporter.intercept(operation, pathString);

      // Check policy
      await self.checkPolicy(operation, pathString);

      return original.call(module, path, ...args);
    };
  }
}
