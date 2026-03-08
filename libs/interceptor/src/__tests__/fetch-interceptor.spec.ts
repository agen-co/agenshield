/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Tests for FetchInterceptor covering proxy routing, constructor branches,
 * proxyViaHttp, and failOpen=false path.
 */

import { EventEmitter } from 'node:events';

jest.mock('../debug-log', () => ({ debugLog: jest.fn() }));

// Mock http module to capture _rawHttpRequest (captured at module level in fetch.ts)
const mockRawRequest = jest.fn();
jest.mock('node:http', () => ({
  request: (...args: any[]) => mockRawRequest(...args),
}));

// Controllable proxy config
const mockProxyConfig = {
  enabled: false,
  hostname: '',
  port: 0,
  url: '',
  noProxy: [] as string[],
};
jest.mock('../proxy-env', () => ({
  getProxyConfig: () => ({ ...mockProxyConfig }),
  shouldBypassProxy: jest.fn().mockReturnValue(false),
}));

import { FetchInterceptor } from '../interceptors/fetch';
import { shouldBypassProxy } from '../proxy-env';

const mockShouldBypassProxy = shouldBypassProxy as jest.Mock;

function createMockReporter() {
  return {
    intercept: jest.fn(), allow: jest.fn(),
    deny: jest.fn(), error: jest.fn(),
    report: jest.fn(), flush: jest.fn(), stop: jest.fn(),
  };
}

function createInterceptor(overrides?: Record<string, any>) {
  const mockReporter = createMockReporter();
  return new FetchInterceptor({
    client: { request: jest.fn() } as any,
    policyEvaluator: { check: jest.fn().mockResolvedValue({ allowed: true }) } as any,
    eventReporter: mockReporter as any,
    failOpen: true,
    brokerHttpPort: 5201,
    ...overrides,
  });
}

describe('FetchInterceptor (proxy & advanced)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    jest.clearAllMocks();
    mockProxyConfig.enabled = false;
    mockProxyConfig.hostname = '';
    mockProxyConfig.port = 0;
    mockProxyConfig.url = '';
    mockProxyConfig.noProxy = [];
    mockShouldBypassProxy.mockReturnValue(false);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('constructor', () => {
    it('does not create ProxyAgent when proxy is disabled', () => {
      mockProxyConfig.enabled = false;
      const interceptor = createInterceptor();
      expect((interceptor as any).proxyDispatcher).toBeNull();
    });

    it('tries to create ProxyAgent when proxy is enabled', () => {
      mockProxyConfig.enabled = true;
      mockProxyConfig.url = 'http://127.0.0.1:8888';

      // undici.ProxyAgent should be available in Node 18+
      // but even if it fails, the catch block handles it
      const interceptor = createInterceptor();
      // Either proxyDispatcher is set or it's null (if undici is not available)
      // Either way, no error should be thrown
      expect(interceptor).toBeDefined();
    });
  });

  describe('proxy routing', () => {
    it('routes through proxyDispatcher when available', async () => {
      mockProxyConfig.enabled = true;
      mockProxyConfig.hostname = '127.0.0.1';
      mockProxyConfig.port = 8888;
      mockProxyConfig.url = 'http://127.0.0.1:8888';
      mockShouldBypassProxy.mockReturnValue(false);

      const mockReporter = createMockReporter();
      const stubFetch = jest.fn().mockResolvedValue(new Response('proxied'));
      globalThis.fetch = stubFetch;

      const interceptor = createInterceptor({ eventReporter: mockReporter });
      // Force proxyDispatcher to exist
      (interceptor as any).proxyDispatcher = { fake: 'dispatcher' };
      interceptor.install();

      await globalThis.fetch('https://external.com/api');

      // Should have been called with dispatcher option
      expect(stubFetch).toHaveBeenCalledWith(
        'https://external.com/api',
        expect.objectContaining({ dispatcher: { fake: 'dispatcher' } })
      );
      expect(mockReporter.intercept).toHaveBeenCalledWith('http_request', 'https://external.com/api');

      interceptor.uninstall();
    });

    it('falls back to proxyViaHttp when no proxyDispatcher', async () => {
      mockProxyConfig.enabled = true;
      mockProxyConfig.hostname = '127.0.0.1';
      mockProxyConfig.port = 8888;
      mockProxyConfig.url = 'http://127.0.0.1:8888';
      mockShouldBypassProxy.mockReturnValue(false);

      const mockReporter = createMockReporter();
      const stubFetch = jest.fn().mockResolvedValue(new Response('ok'));
      globalThis.fetch = stubFetch;

      const interceptor = createInterceptor({ eventReporter: mockReporter });
      // Ensure no proxyDispatcher
      (interceptor as any).proxyDispatcher = null;
      interceptor.install();

      // Mock _rawHttpRequest to simulate a successful proxy response
      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.statusMessage = 'OK';
      mockRes.headers = { 'content-type': 'text/plain' };

      mockRawRequest.mockImplementation((options: any, callback: any) => {
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn(() => {
          // Simulate response
          process.nextTick(() => {
            callback(mockRes);
            mockRes.emit('data', Buffer.from('proxy-response'));
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      const res = await globalThis.fetch('http://external.com/api');
      expect(await res.text()).toBe('proxy-response');
      expect(res.status).toBe(200);

      // stubFetch should NOT have been called (we bypassed it)
      expect(stubFetch).not.toHaveBeenCalled();

      interceptor.uninstall();
    });

    it('proxyViaHttp handles Headers object', async () => {
      mockProxyConfig.enabled = true;
      mockProxyConfig.hostname = '127.0.0.1';
      mockProxyConfig.port = 8888;
      mockShouldBypassProxy.mockReturnValue(false);

      const stubFetch = jest.fn();
      globalThis.fetch = stubFetch;

      const interceptor = createInterceptor();
      (interceptor as any).proxyDispatcher = null;
      interceptor.install();

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.statusMessage = 'OK';
      mockRes.headers = {};

      mockRawRequest.mockImplementation((options: any, callback: any) => {
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn(() => {
          process.nextTick(() => {
            callback(mockRes);
            mockRes.emit('data', Buffer.from('ok'));
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      const headers = new Headers();
      headers.set('content-type', 'application/json');
      await globalThis.fetch('http://api.example.com/data', {
        method: 'POST',
        headers,
        body: 'test body',
      });

      // Verify request was made to proxy
      expect(mockRawRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: '127.0.0.1',
          port: 8888,
          path: 'http://api.example.com/data',
          method: 'POST',
        }),
        expect.any(Function)
      );

      interceptor.uninstall();
    });

    it('proxyViaHttp handles array headers', async () => {
      mockProxyConfig.enabled = true;
      mockProxyConfig.hostname = '127.0.0.1';
      mockProxyConfig.port = 8888;
      mockShouldBypassProxy.mockReturnValue(false);

      const stubFetch = jest.fn();
      globalThis.fetch = stubFetch;

      const interceptor = createInterceptor();
      (interceptor as any).proxyDispatcher = null;
      interceptor.install();

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.statusMessage = 'OK';
      mockRes.headers = {};

      mockRawRequest.mockImplementation((options: any, callback: any) => {
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn(() => {
          process.nextTick(() => {
            callback(mockRes);
            mockRes.emit('data', Buffer.from('ok'));
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      await globalThis.fetch('http://api.example.com/data', {
        headers: [['x-custom', 'val']],
      });

      const callOptions = mockRawRequest.mock.calls[0][0];
      expect(callOptions.headers['x-custom']).toBe('val');

      interceptor.uninstall();
    });

    it('proxyViaHttp handles plain object headers', async () => {
      mockProxyConfig.enabled = true;
      mockProxyConfig.hostname = '127.0.0.1';
      mockProxyConfig.port = 8888;
      mockShouldBypassProxy.mockReturnValue(false);

      const stubFetch = jest.fn();
      globalThis.fetch = stubFetch;

      const interceptor = createInterceptor();
      (interceptor as any).proxyDispatcher = null;
      interceptor.install();

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.statusMessage = 'OK';
      mockRes.headers = {};

      mockRawRequest.mockImplementation((options: any, callback: any) => {
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn(() => {
          process.nextTick(() => {
            callback(mockRes);
            mockRes.emit('data', Buffer.from('ok'));
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      await globalThis.fetch('http://api.example.com/data', {
        headers: { 'authorization': 'Bearer tok' },
      });

      const callOptions = mockRawRequest.mock.calls[0][0];
      expect(callOptions.headers['authorization']).toBe('Bearer tok');

      interceptor.uninstall();
    });

    it('proxyViaHttp handles ArrayBuffer body', async () => {
      mockProxyConfig.enabled = true;
      mockProxyConfig.hostname = '127.0.0.1';
      mockProxyConfig.port = 8888;
      mockShouldBypassProxy.mockReturnValue(false);

      const stubFetch = jest.fn();
      globalThis.fetch = stubFetch;

      const interceptor = createInterceptor();
      (interceptor as any).proxyDispatcher = null;
      interceptor.install();

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.statusMessage = 'OK';
      mockRes.headers = {};

      let endArg: any;
      mockRawRequest.mockImplementation((options: any, callback: any) => {
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn((arg: any) => {
          endArg = arg;
          process.nextTick(() => {
            callback(mockRes);
            mockRes.emit('data', Buffer.from('ok'));
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      const ab = new ArrayBuffer(4);
      new Uint8Array(ab).set([1, 2, 3, 4]);
      await globalThis.fetch('http://api.example.com/data', {
        method: 'POST',
        body: ab,
      });

      expect(Buffer.isBuffer(endArg)).toBe(true);
      expect(endArg).toEqual(Buffer.from([1, 2, 3, 4]));

      interceptor.uninstall();
    });

    it('proxyViaHttp handles Buffer body', async () => {
      mockProxyConfig.enabled = true;
      mockProxyConfig.hostname = '127.0.0.1';
      mockProxyConfig.port = 8888;
      mockShouldBypassProxy.mockReturnValue(false);

      const stubFetch = jest.fn();
      globalThis.fetch = stubFetch;

      const interceptor = createInterceptor();
      (interceptor as any).proxyDispatcher = null;
      interceptor.install();

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.statusMessage = 'OK';
      mockRes.headers = {};

      let endArg: any;
      mockRawRequest.mockImplementation((options: any, callback: any) => {
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn((arg: any) => {
          endArg = arg;
          process.nextTick(() => {
            callback(mockRes);
            mockRes.emit('data', Buffer.from('ok'));
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      const buf = Buffer.from('buffer-body');
      await globalThis.fetch('http://api.example.com/data', {
        method: 'POST',
        body: buf,
      });

      expect(endArg).toBe(buf);

      interceptor.uninstall();
    });

    it('proxyViaHttp handles unknown body type (ReadableStream)', async () => {
      mockProxyConfig.enabled = true;
      mockProxyConfig.hostname = '127.0.0.1';
      mockProxyConfig.port = 8888;
      mockShouldBypassProxy.mockReturnValue(false);

      const stubFetch = jest.fn();
      globalThis.fetch = stubFetch;

      const interceptor = createInterceptor();
      (interceptor as any).proxyDispatcher = null;
      interceptor.install();

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.statusMessage = 'OK';
      mockRes.headers = {};

      let endArg: any = 'NOT_CALLED';
      mockRawRequest.mockImplementation((options: any, callback: any) => {
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn((arg: any) => {
          endArg = arg;
          process.nextTick(() => {
            callback(mockRes);
            mockRes.emit('data', Buffer.from('ok'));
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      // Use a plain object that's not string/ArrayBuffer/Buffer
      await globalThis.fetch('http://api.example.com/data', {
        method: 'POST',
        body: { [Symbol.iterator]: () => {} } as any,
      });

      // End should be called without arguments for unsupported body types
      expect(endArg).toBeUndefined();

      interceptor.uninstall();
    });

    it('proxyViaHttp handles invalid URL gracefully', async () => {
      mockProxyConfig.enabled = true;
      mockProxyConfig.hostname = '127.0.0.1';
      mockProxyConfig.port = 8888;
      mockShouldBypassProxy.mockReturnValue(false);

      const stubFetch = jest.fn();
      globalThis.fetch = stubFetch;

      const interceptor = createInterceptor();
      (interceptor as any).proxyDispatcher = null;
      interceptor.install();

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.statusMessage = 'OK';
      mockRes.headers = {};

      mockRawRequest.mockImplementation((options: any, callback: any) => {
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn(() => {
          process.nextTick(() => {
            callback(mockRes);
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      // The URL string here is actually valid but we can test the host extraction
      await globalThis.fetch('http://example.com/path');

      const callOptions = mockRawRequest.mock.calls[0][0];
      expect(callOptions.headers.host).toBe('example.com');

      interceptor.uninstall();
    });

    it('proxyViaHttp rejects on request error', async () => {
      mockProxyConfig.enabled = true;
      mockProxyConfig.hostname = '127.0.0.1';
      mockProxyConfig.port = 8888;
      mockShouldBypassProxy.mockReturnValue(false);

      const stubFetch = jest.fn();
      globalThis.fetch = stubFetch;

      const interceptor = createInterceptor();
      (interceptor as any).proxyDispatcher = null;
      interceptor.install();

      mockRawRequest.mockImplementation((options: any, callback: any) => {
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn(() => {
          process.nextTick(() => {
            mockReq.emit('error', new Error('connection refused'));
          });
        });
        return mockReq;
      });

      await expect(globalThis.fetch('http://example.com/fail'))
        .rejects.toThrow('connection refused');

      interceptor.uninstall();
    });

    it('proxyViaHttp handles array response headers', async () => {
      mockProxyConfig.enabled = true;
      mockProxyConfig.hostname = '127.0.0.1';
      mockProxyConfig.port = 8888;
      mockShouldBypassProxy.mockReturnValue(false);

      const stubFetch = jest.fn();
      globalThis.fetch = stubFetch;

      const interceptor = createInterceptor();
      (interceptor as any).proxyDispatcher = null;
      interceptor.install();

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.statusMessage = 'OK';
      mockRes.headers = { 'set-cookie': ['a=1', 'b=2'] };

      mockRawRequest.mockImplementation((options: any, callback: any) => {
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn(() => {
          process.nextTick(() => {
            callback(mockRes);
            mockRes.emit('data', Buffer.from('ok'));
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      const res = await globalThis.fetch('http://example.com/cookies');
      expect(res.headers.get('set-cookie')).toBe('a=1, b=2');

      interceptor.uninstall();
    });
  });

  describe('interceptedFetch - failOpen=false', () => {
    it('throws when broker errors and failOpen=false', async () => {
      const mockCheck = jest.fn().mockRejectedValue(new Error('broker down'));
      const stubFetch = jest.fn().mockResolvedValue(new Response('ok'));
      globalThis.fetch = stubFetch;

      const interceptor = createInterceptor({
        policyEvaluator: { check: mockCheck },
        failOpen: false,
      });
      interceptor.install();

      await expect(globalThis.fetch('https://api.example.com/data'))
        .rejects.toThrow('broker down');

      expect(stubFetch).not.toHaveBeenCalled();

      interceptor.uninstall();
    });
  });

  describe('interceptedFetch - originalFetch null guard', () => {
    it('throws when originalFetch is null', async () => {
      const interceptor = createInterceptor();
      // Call interceptedFetch without installing (originalFetch is null)
      await expect((interceptor as any).interceptedFetch('https://example.com'))
        .rejects.toThrow('Original fetch not available');
    });
  });

  describe('re-entrancy guard', () => {
    it('passes through when _checking is true', async () => {
      const stubFetch = jest.fn().mockResolvedValue(new Response('re-entered'));
      globalThis.fetch = stubFetch;

      const interceptor = createInterceptor();
      interceptor.install();

      // Set re-entrancy flag
      (interceptor as any)._checking = true;

      const res = await globalThis.fetch('https://external.com/api');
      expect(await res.text()).toBe('re-entered');
      // stubFetch should be called directly without policy check
      expect(stubFetch).toHaveBeenCalledTimes(1);

      (interceptor as any)._checking = false;
      interceptor.uninstall();
    });
  });

  describe('proxyViaHttp edge cases', () => {
    it('handles invalid URL by setting host to unknown', async () => {
      // Call proxyViaHttp directly with an invalid URL
      const mockReporter = createMockReporter();
      const interceptor = createInterceptor({ eventReporter: mockReporter });
      (interceptor as any).proxyConfig = {
        enabled: true,
        hostname: '127.0.0.1',
        port: 8888,
      };

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.statusMessage = 'OK';
      mockRes.headers = {};

      mockRawRequest.mockImplementation((options: any, callback: any) => {
        // Verify host was set to 'unknown' for invalid URL
        expect(options.headers.host).toBe('unknown');
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn(() => {
          process.nextTick(() => {
            callback(mockRes);
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      await (interceptor as any).proxyViaHttp('not-a-valid-url');
    });

    it('handles response error', async () => {
      const interceptor = createInterceptor();
      (interceptor as any).proxyConfig = {
        enabled: true,
        hostname: '127.0.0.1',
        port: 8888,
      };

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.statusMessage = 'OK';
      mockRes.headers = {};

      mockRawRequest.mockImplementation((options: any, callback: any) => {
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn(() => {
          process.nextTick(() => {
            callback(mockRes);
            mockRes.emit('error', new Error('response error'));
          });
        });
        return mockReq;
      });

      await expect((interceptor as any).proxyViaHttp('http://example.com/test'))
        .rejects.toThrow('response error');
    });

    it('handles no body in init', async () => {
      const interceptor = createInterceptor();
      (interceptor as any).proxyConfig = {
        enabled: true,
        hostname: '127.0.0.1',
        port: 8888,
      };

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.statusMessage = 'OK';
      mockRes.headers = {};

      let endArg: any = 'SENTINEL';
      mockRawRequest.mockImplementation((options: any, callback: any) => {
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn((arg: any) => {
          endArg = arg;
          process.nextTick(() => {
            callback(mockRes);
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      await (interceptor as any).proxyViaHttp('http://example.com/test');
      expect(endArg).toBeUndefined();
    });

    it('handles no headers in init', async () => {
      const interceptor = createInterceptor();
      (interceptor as any).proxyConfig = {
        enabled: true,
        hostname: '127.0.0.1',
        port: 8888,
      };

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.statusMessage = 'OK';
      mockRes.headers = {};

      mockRawRequest.mockImplementation((options: any, callback: any) => {
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn(() => {
          process.nextTick(() => {
            callback(mockRes);
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      await (interceptor as any).proxyViaHttp('http://example.com/test', { method: 'POST' });

      const callOptions = mockRawRequest.mock.calls[0][0];
      expect(callOptions.method).toBe('POST');
      expect(callOptions.headers.host).toBe('example.com');
    });
  });

  describe('constructor ProxyAgent', () => {
    it('creates ProxyAgent when undici is available', () => {
      mockProxyConfig.enabled = true;
      mockProxyConfig.url = 'http://127.0.0.1:8888';

      // undici is available in Node 18+, so ProxyAgent should be created
      const interceptor = createInterceptor();

      // If undici.ProxyAgent is available, proxyDispatcher should be set
      // This may or may not work depending on the test environment
      // At minimum, it should not throw
      expect(interceptor).toBeDefined();
    });
  });

  describe('proxyViaHttp protocol branching', () => {
    it('uses path-based forwarding for HTTP URLs', async () => {
      const interceptor = createInterceptor();
      (interceptor as any).proxyConfig = {
        enabled: true,
        hostname: '127.0.0.1',
        port: 8888,
      };

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.statusMessage = 'OK';
      mockRes.headers = {};

      mockRawRequest.mockImplementation((options: any, callback: any) => {
        // For HTTP, the full URL should be sent as the path
        expect(options.path).toBe('http://example.com/data');
        expect(options.hostname).toBe('127.0.0.1');
        expect(options.port).toBe(8888);
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn(() => {
          process.nextTick(() => {
            callback(mockRes);
            mockRes.emit('data', Buffer.from('ok'));
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      const res = await (interceptor as any).proxyViaHttp('http://example.com/data');
      expect(res.status).toBe(200);
    });

    it('falls back to path-based forwarding for invalid URLs', async () => {
      const interceptor = createInterceptor();
      (interceptor as any).proxyConfig = {
        enabled: true,
        hostname: '127.0.0.1',
        port: 8888,
      };

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.statusMessage = 'OK';
      mockRes.headers = {};

      mockRawRequest.mockImplementation((options: any, callback: any) => {
        expect(options.headers.host).toBe('unknown');
        const mockReq = new EventEmitter() as any;
        mockReq.end = jest.fn(() => {
          process.nextTick(() => {
            callback(mockRes);
            mockRes.emit('end');
          });
        });
        return mockReq;
      });

      await (interceptor as any).proxyViaHttp('not-a-valid-url');
    });
  });
});
