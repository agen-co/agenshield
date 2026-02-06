/**
 * Fetch Interceptor
 *
 * Intercepts global fetch() calls.
 */

import { BaseInterceptor, type BaseInterceptorOptions } from './base.js';
import { debugLog } from '../debug-log.js';

export class FetchInterceptor extends BaseInterceptor {
  private originalFetch: typeof fetch | null = null;

  constructor(options: BaseInterceptorOptions) {
    super(options);
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

    // Check policy
    debugLog(`fetch checkPolicy START url=${url}`);
    await this.checkPolicy('http_request', url);
    debugLog(`fetch checkPolicy DONE url=${url}`);

    // Make request through broker
    try {
      const method = init?.method || 'GET';
      const headers: Record<string, string> = {};

      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            headers[key] = value;
          });
        } else if (Array.isArray(init.headers)) {
          for (const [key, value] of init.headers) {
            headers[key] = value;
          }
        } else {
          Object.assign(headers, init.headers);
        }
      }

      let body: string | undefined;
      if (init?.body) {
        if (typeof init.body === 'string') {
          body = init.body;
        } else if (init.body instanceof ArrayBuffer) {
          body = Buffer.from(init.body).toString('base64');
        } else {
          body = String(init.body);
        }
      }

      const result = await this.client.request<{
        status: number;
        statusText: string;
        headers: Record<string, string>;
        body: string;
      }>('http_request', {
        url,
        method,
        headers,
        body,
      });

      // Create Response object
      const responseHeaders = new Headers(result.headers);
      return new Response(result.body, {
        status: result.status,
        statusText: result.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      debugLog(`fetch ERROR url=${url} error=${(error as Error).message}`);
      // Re-throw policy errors
      if ((error as Error).name === 'PolicyDeniedError') {
        throw error;
      }

      // Fall back to direct fetch if broker fails and failOpen is true
      if (this.failOpen) {
        debugLog(`fetch failOpen fallback url=${url}`);
        return this.originalFetch(input, init);
      }

      throw error;
    }
  }

}
