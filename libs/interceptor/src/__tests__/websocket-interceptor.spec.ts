/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('../debug-log', () => ({ debugLog: jest.fn() }));

import { WebSocketInterceptor } from '../interceptors/websocket';
import { PolicyDeniedError } from '../errors';

describe('WebSocketInterceptor', () => {
  let originalWebSocket: typeof WebSocket | undefined;

  beforeEach(() => {
    originalWebSocket = (globalThis as any).WebSocket;
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalWebSocket !== undefined) {
      (globalThis as any).WebSocket = originalWebSocket;
    } else {
      delete (globalThis as any).WebSocket;
    }
  });

  function createInterceptor(overrides?: Record<string, any>) {
    return new WebSocketInterceptor({
      client: { request: jest.fn() } as any,
      policyEvaluator: { check: jest.fn().mockResolvedValue({ allowed: true }) } as any,
      eventReporter: {
        intercept: jest.fn(),
        allow: jest.fn(),
        deny: jest.fn(),
        error: jest.fn(),
      } as any,
      failOpen: false,
      brokerHttpPort: 5201,
      ...overrides,
    });
  }

  it('returns early when WebSocket is undefined', () => {
    delete (globalThis as any).WebSocket;

    const spy = jest.spyOn(console, 'debug').mockImplementation();
    const interceptor = createInterceptor();
    interceptor.install();

    expect(interceptor.isInstalled()).toBe(false);
    spy.mockRestore();
  });

  it('replaces globalThis.WebSocket on install', () => {
    class FakeWebSocket {
      url: string;
      constructor(url: string) { this.url = url; }
      close() {}
      dispatchEvent() { return false; }
    }
    (globalThis as any).WebSocket = FakeWebSocket;

    const interceptor = createInterceptor();
    interceptor.install();

    expect((globalThis as any).WebSocket).not.toBe(FakeWebSocket);
    expect(interceptor.isInstalled()).toBe(true);

    interceptor.uninstall();
  });

  it('restores original WebSocket on uninstall', () => {
    class FakeWebSocket {
      url: string;
      constructor(url: string) { this.url = url; }
      close() {}
      dispatchEvent() { return false; }
    }
    (globalThis as any).WebSocket = FakeWebSocket;

    const interceptor = createInterceptor();
    interceptor.install();
    interceptor.uninstall();

    expect((globalThis as any).WebSocket).toBe(FakeWebSocket);
    expect(interceptor.isInstalled()).toBe(false);
  });

  it('does not uninstall if not installed', () => {
    class FakeWebSocket {
      constructor() {}
    }
    (globalThis as any).WebSocket = FakeWebSocket;

    const interceptor = createInterceptor();
    interceptor.uninstall(); // no-op
    expect((globalThis as any).WebSocket).toBe(FakeWebSocket);
  });

  describe('InterceptedWebSocket constructor', () => {
    it('skips policy check for broker URLs', () => {
      const mockReporter = {
        intercept: jest.fn(), allow: jest.fn(),
        deny: jest.fn(), error: jest.fn(),
      };
      const mockCheck = jest.fn().mockResolvedValue({ allowed: true });

      class FakeWebSocket {
        url: string;
        protocols?: string | string[];
        constructor(url: string | URL, protocols?: string | string[]) {
          this.url = url.toString();
          this.protocols = protocols;
        }
        close() {}
        dispatchEvent() { return false; }
      }
      (globalThis as any).WebSocket = FakeWebSocket;

      const interceptor = createInterceptor({
        policyEvaluator: { check: mockCheck },
        eventReporter: mockReporter,
      });
      interceptor.install();

      // Create a WebSocket to broker URL — should skip policy
      const WS = (globalThis as any).WebSocket;
      const ws = new WS('ws://localhost:5201/ws');

      expect(ws.url).toBe('ws://localhost:5201/ws');
      expect(mockReporter.intercept).not.toHaveBeenCalled();
      expect(mockCheck).not.toHaveBeenCalled();

      interceptor.uninstall();
    });

    it('checks policy for non-broker URLs and closes on deny', async () => {
      const mockReporter = {
        intercept: jest.fn(), allow: jest.fn(),
        deny: jest.fn(), error: jest.fn(),
      };
      const mockCheck = jest.fn().mockRejectedValue(
        new PolicyDeniedError('blocked', { operation: 'websocket', target: 'wss://evil.com' })
      );

      let closeCalled = false;
      let errorDispatched = false;

      class FakeWebSocket {
        url: string;
        constructor(url: string | URL) {
          this.url = url.toString();
        }
        close(code?: number, reason?: string) {
          closeCalled = true;
          expect(code).toBe(1008);
          expect(reason).toBe('Policy denied');
        }
        dispatchEvent(event: any) {
          if (event.type === 'error') errorDispatched = true;
          return false;
        }
      }
      (globalThis as any).WebSocket = FakeWebSocket;

      const interceptor = createInterceptor({
        policyEvaluator: { check: mockCheck },
        eventReporter: mockReporter,
      });
      interceptor.install();

      const WS = (globalThis as any).WebSocket;
      new WS('wss://evil.com/ws');

      expect(mockReporter.intercept).toHaveBeenCalledWith('websocket', 'wss://evil.com/ws');

      // Wait for async policy check
      await new Promise(r => setTimeout(r, 10));

      expect(closeCalled).toBe(true);
      expect(errorDispatched).toBe(true);

      interceptor.uninstall();
    });

    it('allows connection when policy check passes', async () => {
      const mockReporter = {
        intercept: jest.fn(), allow: jest.fn(),
        deny: jest.fn(), error: jest.fn(),
      };
      const mockCheck = jest.fn().mockResolvedValue({ allowed: true });

      let closeCalled = false;

      class FakeWebSocket {
        url: string;
        constructor(url: string | URL) {
          this.url = url.toString();
        }
        close() { closeCalled = true; }
        dispatchEvent() { return false; }
      }
      (globalThis as any).WebSocket = FakeWebSocket;

      const interceptor = createInterceptor({
        policyEvaluator: { check: mockCheck },
        eventReporter: mockReporter,
      });
      interceptor.install();

      const WS = (globalThis as any).WebSocket;
      new WS('wss://ok.com/ws');

      expect(mockReporter.intercept).toHaveBeenCalledWith('websocket', 'wss://ok.com/ws');

      // Wait for async policy check
      await new Promise(r => setTimeout(r, 10));

      // Should NOT close since policy allowed
      expect(closeCalled).toBe(false);

      interceptor.uninstall();
    });

    it('passes protocols to original WebSocket', () => {
      class FakeWebSocket {
        url: string;
        protocols?: string | string[];
        constructor(url: string | URL, protocols?: string | string[]) {
          this.url = url.toString();
          this.protocols = protocols;
        }
        close() {}
        dispatchEvent() { return false; }
      }
      (globalThis as any).WebSocket = FakeWebSocket;

      const interceptor = createInterceptor();
      interceptor.install();

      const WS = (globalThis as any).WebSocket;
      // Broker URL to skip policy check
      const ws = new WS('ws://localhost:5201/ws', ['proto1', 'proto2']);
      expect(ws.protocols).toEqual(['proto1', 'proto2']);

      interceptor.uninstall();
    });
  });
});
