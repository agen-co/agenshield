/**
 * HTTP/HTTPS Interceptor
 *
 * Intercepts Node.js http and https module calls.
 */

import type * as http from 'node:http';
import { BaseInterceptor, type BaseInterceptorOptions } from './base.js';

// Use require() for modules we need to monkey-patch (ESM imports are immutable)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpModule = require('node:http') as typeof http;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpsModule = require('node:https') as typeof http;

export class HttpInterceptor extends BaseInterceptor {
  private originalHttpRequest: typeof http.request | null = null;
  private originalHttpGet: typeof http.get | null = null;
  private originalHttpsRequest: typeof http.request | null = null;
  private originalHttpsGet: typeof http.get | null = null;

  constructor(options: BaseInterceptorOptions) {
    super(options);
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

      // Check policy asynchronously
      // Note: We can't fully block sync http.request, so we check and may abort
      const req = original.call(
        protocol === 'http' ? httpModule : httpsModule,
        urlOrOptions as any,
        optionsOrCallback as any,
        callback
      );

      // Emit check event
      self.eventReporter.intercept('http_request', url);

      // Check policy in background
      self.checkPolicy('http_request', url).catch((error) => {
        // Abort the request if policy denies
        req.destroy(error);
      });

      return req;
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
