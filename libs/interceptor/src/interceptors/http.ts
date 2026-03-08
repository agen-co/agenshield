/**
 * HTTP/HTTPS Interceptor
 *
 * Intercepts Node.js http and https module calls with synchronous policy
 * checking. Uses SyncClient to block before the request fires, preventing
 * the race condition where async policy checks arrive after the request
 * has already completed.
 */

import type * as http from 'node:http';
import * as https from 'node:https';
import { BaseInterceptor, type BaseInterceptorOptions } from './base.js';
import { SyncClient } from '../client/sync-client.js';
import { PolicyDeniedError } from '../errors.js';
import { debugLog } from '../debug-log.js';
import { getProxyConfig, shouldBypassProxy, type ProxyConfig } from '../proxy-env.js';
import { establishConnectTunnel } from '../proxy/connect-tunnel.js';
import type { PolicyExecutionContext } from '@agenshield/ipc';
import type { PolicyCheckResult } from '../policy/evaluator.js';

// Use require() for modules we need to monkey-patch (ESM imports are immutable)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpModule = require('node:http') as typeof http;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpsModule = require('node:https') as typeof http;

export class HttpInterceptor extends BaseInterceptor {
  private syncClient: SyncClient;
  private proxyConfig: ProxyConfig;
  private originalHttpRequest: typeof http.request | null = null;
  private originalHttpGet: typeof http.get | null = null;
  private originalHttpsRequest: typeof http.request | null = null;
  private originalHttpsGet: typeof http.get | null = null;

  constructor(options: BaseInterceptorOptions) {
    super(options);
    const config = this.interceptorConfig;
    this.syncClient = new SyncClient({
      socketPath: config?.socketPath || `${process.env['AGENSHIELD_USER_HOME'] || process.env['HOME'] || ''}/.agenshield/run/agenshield.sock`,
      httpHost: config?.httpHost || 'localhost',
      httpPort: config?.httpPort || 5201,
      timeout: config?.timeout || 30000,
    });
    this.proxyConfig = getProxyConfig();
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

      // Proxy routing mode: when HTTP_PROXY/HTTPS_PROXY is set, route through the
      // proxy and skip the RPC policy check (the proxy enforces URL policies itself).
      if (self.proxyConfig.enabled && !shouldBypassProxy(url, self.proxyConfig.noProxy)) {
        debugLog(`http.request PROXY-ROUTE url=${url}`);

        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
        } catch {
          parsedUrl = new URL('http://unknown');
        }

        // HTTPS: use CONNECT tunnel so the proxy can do policy checks on the
        // CONNECT target and then pipe TLS end-to-end. This fixes the broken
        // path-based forwarding that caused "Proxy error" for HTTPS URLs.
        if (protocol === 'https') {
          const targetHostname = parsedUrl.hostname;
          const targetPort = parseInt(parsedUrl.port) || 443;

          // Create a one-shot https.Agent with createConnection that returns the tunnel socket.
          // The Agent callback pattern supports async socket provisioning natively.
          // Cast needed: createConnection is a valid runtime option but not in AgentOptions typedef.
          const tunnelAgent = new https.Agent({
            maxSockets: 1,
          } as any);
          (tunnelAgent as any).createConnection = (_opts: any, oncreate: (err: Error | null, socket: any) => void) => {
            establishConnectTunnel({
              proxyHostname: self.proxyConfig.hostname,
              proxyPort: self.proxyConfig.port,
              targetHostname,
              targetPort,
            }).then(
              ({ tlsSocket }) => oncreate(null, tlsSocket),
              (err) => oncreate(err as Error, undefined),
            );
            // Return undefined — the Agent will wait for the oncreate callback
            return undefined as any;
          };

          const httpsOptions: http.RequestOptions = {
            hostname: targetHostname,
            port: targetPort,
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || 'GET',
            headers: { ...(options.headers || {}), host: parsedUrl.host },
            agent: tunnelAgent,
          };

          const reqFn = self.originalHttpsRequest! as (...args: unknown[]) => http.ClientRequest;
          return reqFn.call(httpsModule, httpsOptions, cb);
        }

        // HTTP: path-based forwarding (send full URL as path to proxy)
        const proxyOptions: http.RequestOptions = {
          hostname: self.proxyConfig.hostname,
          port: self.proxyConfig.port,
          path: url,
          method: options.method || 'GET',
          headers: { ...(options.headers || {}), host: parsedUrl.host },
        };

        const reqFn = self.originalHttpRequest! as (...args: unknown[]) => http.ClientRequest;
        return reqFn.call(httpModule, proxyOptions, cb);
      }

      // Direct mode (no proxy): synchronous policy check via RPC
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
