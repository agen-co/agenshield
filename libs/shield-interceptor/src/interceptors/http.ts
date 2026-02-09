/**
 * HTTP/HTTPS Interceptor
 *
 * Intercepts Node.js http and https module calls with synchronous policy
 * checking. Uses SyncClient to block before the request fires, preventing
 * the race condition where async policy checks arrive after the request
 * has already completed.
 */

import type * as http from 'node:http';
import { BaseInterceptor, type BaseInterceptorOptions } from './base.js';
import { SyncClient } from '../client/sync-client.js';
import { PolicyDeniedError } from '../errors.js';
import { debugLog } from '../debug-log.js';
import type { PolicyExecutionContext } from '@agenshield/ipc';
import type { PolicyCheckResult } from '../policy/evaluator.js';

// Use require() for modules we need to monkey-patch (ESM imports are immutable)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpModule = require('node:http') as typeof http;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpsModule = require('node:https') as typeof http;

export class HttpInterceptor extends BaseInterceptor {
  private syncClient: SyncClient;
  private originalHttpRequest: typeof http.request | null = null;
  private originalHttpGet: typeof http.get | null = null;
  private originalHttpsRequest: typeof http.request | null = null;
  private originalHttpsGet: typeof http.get | null = null;

  constructor(options: BaseInterceptorOptions) {
    super(options);
    const config = this.interceptorConfig;
    this.syncClient = new SyncClient({
      socketPath: config?.socketPath || '/var/run/agenshield/agenshield.sock',
      httpHost: config?.httpHost || 'localhost',
      httpPort: config?.httpPort || 5201,
      timeout: config?.timeout || 30000,
    });
  }

  install(): void {
    if (this.installed) return;

    // Save originals
    this.originalHttpRequest = httpModule.request;
    this.originalHttpGet = httpModule.get;
    this.originalHttpsRequest = httpsModule.request;
    this.originalHttpsGet = httpsModule.get;

    // Replace with intercepted versions
    httpModule.request = this.createInterceptedRequest('http', this.originalHttpRequest);
    httpModule.get = this.createInterceptedGet('http', this.originalHttpGet);
    httpsModule.request = this.createInterceptedRequest('https', this.originalHttpsRequest);
    httpsModule.get = this.createInterceptedGet('https', this.originalHttpsGet);

    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed) return;

    if (this.originalHttpRequest) {
      httpModule.request = this.originalHttpRequest;
    }
    if (this.originalHttpGet) {
      httpModule.get = this.originalHttpGet;
    }
    if (this.originalHttpsRequest) {
      httpsModule.request = this.originalHttpsRequest;
    }
    if (this.originalHttpsGet) {
      httpsModule.get = this.originalHttpsGet;
    }

    this.originalHttpRequest = null;
    this.originalHttpGet = null;
    this.originalHttpsRequest = null;
    this.originalHttpsGet = null;
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
   * Returns the full policy result or null if broker is unavailable and failOpen is true.
   */
  private syncPolicyCheck(url: string): PolicyCheckResult | null {
    const startTime = Date.now();
    try {
      debugLog(`http.syncPolicyCheck START url=${url}`);
      const context = this.getPolicyExecutionContext();
      const result = this.syncClient.request<PolicyCheckResult>(
        'policy_check',
        { operation: 'http_request', target: url, context }
      );
      debugLog(`http.syncPolicyCheck DONE allowed=${result.allowed} url=${url}`);

      if (!result.allowed) {
        this.eventReporter.deny('http_request', url, result.policyId, result.reason);
        throw new PolicyDeniedError(result.reason || 'Operation denied by policy', {
          operation: 'http_request',
          target: url,
          policyId: result.policyId,
        });
      }

      this.eventReporter.allow('http_request', url, result.policyId, Date.now() - startTime);
      return result;
    } catch (error) {
      if (error instanceof PolicyDeniedError) {
        throw error;
      }
      debugLog(`http.syncPolicyCheck ERROR: ${(error as Error).message} url=${url}`);
      if (!this.failOpen) {
        throw error;
      }
      return null;
    }
  }

  private createInterceptedRequest(
    protocol: 'http' | 'https',
    original: typeof http.request
  ): typeof http.request {
    const self = this;

    return function interceptedRequest(
      urlOrOptions: string | URL | http.RequestOptions,
      optionsOrCallback?: http.RequestOptions | ((res: http.IncomingMessage) => void),
      callback?: (res: http.IncomingMessage) => void
    ): http.ClientRequest {
      // Parse arguments
      let url: string;
      let options: http.RequestOptions;
      let cb: ((res: http.IncomingMessage) => void) | undefined;

      if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
        url = urlOrOptions.toString();
        options = (typeof optionsOrCallback === 'object' ? optionsOrCallback : {}) as http.RequestOptions;
        cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      } else {
        options = urlOrOptions;
        url = `${protocol}://${options.hostname || options.host || 'localhost'}:${options.port || (protocol === 'https' ? 443 : 80)}${options.path || '/'}`;
        cb = optionsOrCallback as (res: http.IncomingMessage) => void;
      }

      // Skip broker communication
      if (self.isBrokerUrl(url)) {
        return original.call(
          protocol === 'http' ? httpModule : httpsModule,
          urlOrOptions as any,
          optionsOrCallback as any,
          callback
        );
      }

      self.eventReporter.intercept('http_request', url);

      // Synchronous policy check — blocks before the request fires
      try {
        self.syncPolicyCheck(url);
      } catch (error) {
        // Denied — return a request that immediately errors
        debugLog(`http.request DENIED url=${url}`);
        const mod = protocol === 'http' ? httpModule : httpsModule;
        const denied = original.call(mod, 'http://0.0.0.0:1', { method: 'GET' });
        denied.once('error', () => {});
        process.nextTick(() => denied.destroy(error as Error));
        return denied;
      }

      // Policy allowed — make the real request
      return original.call(
        protocol === 'http' ? httpModule : httpsModule,
        urlOrOptions as any,
        optionsOrCallback as any,
        callback
      );
    };
  }

  private createInterceptedGet(
    protocol: 'http' | 'https',
    original: typeof http.get
  ): typeof http.get {
    const interceptedRequest = this.createInterceptedRequest(
      protocol,
      protocol === 'http' ? this.originalHttpRequest! : this.originalHttpsRequest!
    );

    return function interceptedGet(
      urlOrOptions: string | URL | http.RequestOptions,
      optionsOrCallback?: http.RequestOptions | ((res: http.IncomingMessage) => void),
      callback?: (res: http.IncomingMessage) => void
    ): http.ClientRequest {
      const req = interceptedRequest(urlOrOptions as any, optionsOrCallback as any, callback);
      req.end();
      return req;
    };
  }

}
