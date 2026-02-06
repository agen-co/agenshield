/**
 * WebSocket Interceptor
 *
 * Intercepts WebSocket connections.
 */

import { BaseInterceptor, type BaseInterceptorOptions } from './base.js';
import { PolicyDeniedError } from '../errors.js';

export class WebSocketInterceptor extends BaseInterceptor {
  private originalWebSocket: typeof WebSocket | null = null;

  constructor(options: BaseInterceptorOptions) {
    super(options);
  }

  install(): void {
    if (this.installed) return;

    // Check if WebSocket is available globally
    if (typeof globalThis.WebSocket === 'undefined') {
      this.debug('WebSocket not available in this environment');
      return;
    }

    // Save original
    this.originalWebSocket = globalThis.WebSocket;

    // Create intercepted WebSocket class
    const self = this;
    const OriginalWebSocket = this.originalWebSocket;

    class InterceptedWebSocket extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const urlString = url.toString();

        // Skip broker communication
        if (self.isBrokerUrl(urlString)) {
          super(url, protocols);
          return;
        }

        // Log interception
        self.eventReporter.intercept('websocket', urlString);

        // Check policy synchronously (WebSocket constructor is sync)
        // We can't truly block here, so we'll connect and close if denied
        super(url, protocols);

        // Check policy asynchronously and close if denied
        self.checkPolicy('websocket', urlString).catch((error) => {
          this.close(1008, 'Policy denied');
          // Emit error event
          const errorEvent = new Event('error');
          this.dispatchEvent(errorEvent);
        });
      }
    }

    // Replace global WebSocket
    (globalThis as any).WebSocket = InterceptedWebSocket;

    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed || !this.originalWebSocket) return;

    (globalThis as any).WebSocket = this.originalWebSocket;
    this.originalWebSocket = null;
    this.installed = false;
  }

  private isBrokerUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
        parsed.port === '5200'
      );
    } catch {
      return false;
    }
  }
}
