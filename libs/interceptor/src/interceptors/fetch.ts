/**
 * Fetch Interceptor
 *
 * Intercepts global fetch() calls.
 */

import * as http from 'node:http';
import { BaseInterceptor, type BaseInterceptorOptions } from './base.js';
import { debugLog } from '../debug-log.js';
import { getProxyConfig, shouldBypassProxy, type ProxyConfig } from '../proxy-env.js';
import type { PolicyExecutionContext } from '@agenshield/ipc';

// Capture the raw http.request before any interception can modify it
const _rawHttpRequest = http.request;

export class FetchInterceptor extends BaseInterceptor {
  private originalFetch: typeof fetch | null = null;
  private _checking = false;
  private proxyConfig: ProxyConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private proxyDispatcher: any = null;

  constructor(options: BaseInterceptorOptions) {
    super(options);
    this.proxyConfig = getProxyConfig();

    // Create a ProxyAgent from undici (bundled with Node.js 18+) for proxy routing
    if (this.proxyConfig.enabled) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const undici = require('undici');
        if (undici.ProxyAgent) {
          this.proxyDispatcher = new undici.ProxyAgent(this.proxyConfig.url);
          debugLog('fetch: ProxyAgent created for proxy routing');
        }
      } catch {
        debugLog('fetch: undici.ProxyAgent not available, proxy routing will fall back to direct');
      }
    }
  }

  /**
   * Build execution context from config
   */
  private getPolicyExecutionContext(): PolicyExecutionContext | undefined {
    const config = this.interceptorConfig;
    if (!config) return undefined;
    return {
      callerType: config.contextType || 'agent',
      skillSlug: config.contextSkillSlug,
      agentId: config.contextAgentId,
      depth: 0,
    };
  }

  /**
   * Route a fetch request through the proxy via raw http.request.
   * This avoids the need for undici.ProxyAgent — it sends the full URL
   * as the request path, mirroring how HttpInterceptor handles proxy routing.
   */
  private proxyViaHttp(url: string, init?: RequestInit): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      let parsedHost: string;
      try {
        parsedHost = new URL(url).host;
      } catch {
        parsedHost = 'unknown';
      }

      const method = init?.method || 'GET';
      const headers: Record<string, string> = { host: parsedHost };
      if (init?.headers) {
        const h = init.headers;
        if (h instanceof Headers) {
          h.forEach((v, k) => { headers[k] = v; });
        } else if (Array.isArray(h)) {
          for (const [k, v] of h) { headers[k] = v; }
        } else {
          Object.assign(headers, h);
        }
      }

      const proxyOptions: http.RequestOptions = {
        hostname: this.proxyConfig.hostname,
        port: this.proxyConfig.port,
        path: url,
        method,
        headers,
      };

      const req = _rawHttpRequest(proxyOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const responseHeaders: Record<string, string> = {};
          for (const [key, val] of Object.entries(res.headers)) {
            if (val !== undefined) {
              responseHeaders[key] = Array.isArray(val) ? val.join(', ') : val;
            }
          }
          resolve(new Response(body, {
            status: res.statusCode ?? 502,
            statusText: res.statusMessage ?? '',
            headers: responseHeaders,
          }));
        });
        res.on('error', reject);
      });

      req.on('error', reject);

      // Forward request body
      if (init?.body != null) {
        const body = init.body;
        if (typeof body === 'string') {
          req.end(body);
        } else if (body instanceof ArrayBuffer) {
          req.end(Buffer.from(body));
        } else if (Buffer.isBuffer(body)) {
          req.end(body);
        } else {
          // ReadableStream or other — pipe not easily supported, end without body
          req.end();
        }
      } else {
        req.end();
      }
    });
  }

  install(): void {
    if (this.installed) return;

    // Save original fetch
    this.originalFetch = globalThis.fetch;

    // Replace with intercepted version
    globalThis.fetch = this.interceptedFetch.bind(this);

    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed || !this.originalFetch) return;

    globalThis.fetch = this.originalFetch;
    this.originalFetch = null;
    this.installed = false;
  }

  /**
   * Check if a URL targets localhost (any port).
   * All localhost traffic is allowed without RPC policy checks — policy checks
   * are for external network access. This covers broker, gateway, proxy ports, etc.
   */
  private isLocalUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^\[|]$/g, '');
      return host === 'localhost'
        || host === '127.0.0.1'
        || host === '::1';
    } catch {
      return false;
    }
  }

  private async interceptedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    if (!this.originalFetch) {
      throw new Error('Original fetch not available');
    }

    // Extract URL
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else {
      url = input.url;
    }

    // Allow all localhost traffic without policy check (broker, gateway, proxies, etc.)
    if (this.isLocalUrl(url)) {
      debugLog(`fetch ALLOW localhost url=${url}`);
      return this.originalFetch(input, init);
    }

    // Re-entrancy guard: if we're already inside a policy check (e.g. AsyncClient
    // HTTP fallback calling fetch), pass through to avoid infinite recursion.
    if (this._checking) {
      debugLog(`fetch SKIP (re-entrancy) url=${url}`);
      return this.originalFetch(input, init);
    }

    // Proxy routing mode: when HTTP_PROXY/HTTPS_PROXY is set, route through the
    // proxy using undici's ProxyAgent. The proxy enforces URL policies itself,
    // so we skip the RPC policy check to avoid redundant round trips.
    if (this.proxyConfig.enabled && !shouldBypassProxy(url, this.proxyConfig.noProxy)) {
      debugLog(`fetch PROXY-ROUTE url=${url}`);
      this.eventReporter.intercept('http_request', url);

      if (this.proxyDispatcher) {
        return this.originalFetch(input, { ...init, dispatcher: this.proxyDispatcher } as RequestInit);
      }

      // Fallback: ProxyAgent not available — route via raw http.request to proxy
      debugLog('fetch PROXY-ROUTE: no dispatcher, falling back to http.request proxy');
      return this.proxyViaHttp(url, init);
    }

    // Direct mode (no proxy): check policy via RPC
    debugLog(`fetch checkPolicy START url=${url}`);
    this._checking = true;
    try {
      await this.checkPolicy('http_request', url, this.getPolicyExecutionContext());
      debugLog(`fetch checkPolicy DONE url=${url}`);
    } catch (error) {
      if ((error as Error).name === 'PolicyDeniedError') {
        throw error;
      }
      // Broker unavailable — failOpen handled inside checkPolicy
      if (this.failOpen) {
        debugLog(`fetch failOpen fallback url=${url}`);
        return this.originalFetch(input, init);
      }
      throw error;
    } finally {
      this._checking = false;
    }

    // Policy allowed — make request directly
    return this.originalFetch(input, init);
  }

}
