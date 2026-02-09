/**
 * Fetch Interceptor
 *
 * Intercepts global fetch() calls.
 */

import { BaseInterceptor, type BaseInterceptorOptions } from './base.js';
import { debugLog } from '../debug-log.js';
import type { PolicyExecutionContext } from '@agenshield/ipc';

export class FetchInterceptor extends BaseInterceptor {
  private originalFetch: typeof fetch | null = null;
  private _checking = false;

  constructor(options: BaseInterceptorOptions) {
    super(options);
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
      return parsed.hostname === 'localhost'
        || parsed.hostname === '127.0.0.1'
        || parsed.hostname === '::1';
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

    // Check policy with execution context
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

    // Policy allowed — make request directly (no broker proxy)
    return this.originalFetch(input, init);
  }

}
