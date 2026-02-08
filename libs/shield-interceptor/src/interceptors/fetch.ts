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

    const isBroker = this.isBrokerUrl(url);
    debugLog(`fetch ENTER url=${url} isBroker=${isBroker}`);

    // Skip localhost broker communication
    if (isBroker) {
      return this.originalFetch(input, init);
    }

    // Check policy with execution context
    debugLog(`fetch checkPolicy START url=${url}`);
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
    }

    // Policy allowed — make request directly (no broker proxy)
    return this.originalFetch(input, init);
  }

}
