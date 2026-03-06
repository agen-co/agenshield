/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('../debug-log', () => ({ debugLog: jest.fn() }));

const mockSyncRequest = jest.fn();
jest.mock('../client/sync-client', () => ({
  SyncClient: jest.fn().mockImplementation(() => ({
    request: mockSyncRequest,
  })),
}));

const mockGetProxyConfig = jest.fn();
const mockShouldBypassProxy = jest.fn();
jest.mock('../proxy-env', () => ({
  getProxyConfig: (...args: any[]) => mockGetProxyConfig(...args),
  shouldBypassProxy: (...args: any[]) => mockShouldBypassProxy(...args),
}));

import { HttpInterceptor } from '../interceptors/http';
import { PolicyDeniedError } from '../errors';

// Get the real http/https modules (they get require()'d inside http.ts)
const httpModule = require('node:http');
const httpsModule = require('node:https');

function createInterceptor(overrides?: Record<string, any>) {
  return new HttpInterceptor({
    client: { request: jest.fn() } as any,
    policyEvaluator: { check: jest.fn() } as any,
    eventReporter: {
      intercept: jest.fn(),
      allow: jest.fn(),
      deny: jest.fn(),
      error: jest.fn(),
    } as any,
    failOpen: false,
    brokerHttpPort: 5201,
    config: {
      socketPath: '/tmp/test.sock',
      httpHost: 'localhost',
      httpPort: 5201,
      failOpen: false,
      logLevel: 'error',
      interceptFetch: false,
      interceptHttp: true,
      interceptWs: false,
      interceptFs: false,
      interceptExec: false,
      timeout: 5000,
      contextType: 'agent' as const,
      enableSeatbelt: false,
      seatbeltProfileDir: '/tmp',
      enableResourceMonitoring: false,
    },
    ...overrides,
  });
}

describe('HttpInterceptor', () => {
  let origHttpRequest: typeof httpModule.request;
  let origHttpGet: typeof httpModule.get;
  let origHttpsRequest: typeof httpsModule.request;
  let origHttpsGet: typeof httpsModule.get;

  beforeAll(() => {
    origHttpRequest = httpModule.request;
    origHttpGet = httpModule.get;
    origHttpsRequest = httpsModule.request;
    origHttpsGet = httpsModule.get;
  });

  beforeEach(() => {
    mockGetProxyConfig.mockReturnValue({ enabled: false, hostname: '', port: 0, url: '', noProxy: [] });
    mockShouldBypassProxy.mockReturnValue(false);
  });

  afterEach(() => {
    // Restore originals in case test didn't uninstall
    httpModule.request = origHttpRequest;
    httpModule.get = origHttpGet;
    httpsModule.request = origHttpsRequest;
    httpsModule.get = origHttpsGet;
    jest.clearAllMocks();
  });

  describe('install/uninstall', () => {
    it('patches all four methods on install', () => {
      const interceptor = createInterceptor();
      interceptor.install();

      expect(httpModule.request).not.toBe(origHttpRequest);
      expect(httpModule.get).not.toBe(origHttpGet);
      expect(httpsModule.request).not.toBe(origHttpsRequest);
      expect(httpsModule.get).not.toBe(origHttpsGet);
      expect(interceptor.isInstalled()).toBe(true);

      interceptor.uninstall();
    });

    it('restores all four methods on uninstall', () => {
      const interceptor = createInterceptor();
      interceptor.install();
      interceptor.uninstall();

      expect(httpModule.request).toBe(origHttpRequest);
      expect(httpModule.get).toBe(origHttpGet);
      expect(httpsModule.request).toBe(origHttpsRequest);
      expect(httpsModule.get).toBe(origHttpsGet);
      expect(interceptor.isInstalled()).toBe(false);
    });

    it('does not double-install', () => {
      const interceptor = createInterceptor();
      interceptor.install();
      const afterFirst = httpModule.request;
      interceptor.install(); // second call
      expect(httpModule.request).toBe(afterFirst);
      interceptor.uninstall();
    });

    it('does not uninstall if not installed', () => {
      const interceptor = createInterceptor();
      interceptor.uninstall(); // no-op
      expect(httpModule.request).toBe(origHttpRequest);
    });
  });

  describe('intercepted request', () => {
    it('bypasses broker URLs', () => {
      const interceptor = createInterceptor();
      interceptor.install();

      // Calling with broker URL should not call syncPolicyCheck
      const req = httpModule.request('http://localhost:5201/rpc');
      req.on('error', () => {}); // prevent unhandled
      req.destroy();

      expect(mockSyncRequest).not.toHaveBeenCalled();

      interceptor.uninstall();
    });

    it('calls syncPolicyCheck for non-broker URLs and allows', () => {
      mockSyncRequest.mockReturnValue({ allowed: true, policyId: 'p1' });

      const interceptor = createInterceptor({ failOpen: false });
      interceptor.install();

      const req = httpModule.request('http://example.com/api');
      req.on('error', () => {});
      req.destroy();

      expect(mockSyncRequest).toHaveBeenCalledWith(
        'policy_check',
        expect.objectContaining({
          operation: 'http_request',
          target: 'http://example.com/api',
        })
      );

      interceptor.uninstall();
    });

    it('returns errored request when policy denied', () => {
      mockSyncRequest.mockImplementation(() => {
        throw new PolicyDeniedError('blocked', { operation: 'http_request', target: 'http://evil.com' });
      });

      const interceptor = createInterceptor();
      interceptor.install();

      const req = httpModule.request('http://evil.com/hack');

      return new Promise<void>((resolve) => {
        req.on('error', (err: Error) => {
          expect(err).toBeInstanceOf(PolicyDeniedError);
          interceptor.uninstall();
          resolve();
        });
      });
    });

    it('reports deny event when policy result is not allowed', () => {
      const mockReporter = {
        intercept: jest.fn(), allow: jest.fn(),
        deny: jest.fn(), error: jest.fn(),
      };
      mockSyncRequest.mockReturnValue({ allowed: false, policyId: 'deny-p', reason: 'blocked' });

      const interceptor = createInterceptor({ eventReporter: mockReporter });
      interceptor.install();

      const req = httpModule.request('http://evil.com/data');

      return new Promise<void>((resolve) => {
        req.on('error', (err: Error) => {
          expect(err).toBeInstanceOf(PolicyDeniedError);
          expect(mockReporter.deny).toHaveBeenCalledWith('http_request', 'http://evil.com/data', 'deny-p', 'blocked');
          interceptor.uninstall();
          resolve();
        });
      });
    });

    it('reports allow event when policy result is allowed', () => {
      const mockReporter = {
        intercept: jest.fn(), allow: jest.fn(),
        deny: jest.fn(), error: jest.fn(),
      };
      mockSyncRequest.mockReturnValue({ allowed: true, policyId: 'allow-p' });

      const interceptor = createInterceptor({ eventReporter: mockReporter });
      interceptor.install();

      const req = httpModule.request('http://example.com/ok');
      req.on('error', () => {});
      req.destroy();

      expect(mockReporter.allow).toHaveBeenCalledWith('http_request', 'http://example.com/ok', 'allow-p', expect.any(Number));
      interceptor.uninstall();
    });

    it('handles non-PolicyDeniedError with failOpen=true', () => {
      mockSyncRequest.mockImplementation(() => {
        throw new Error('broker unavailable');
      });

      const interceptor = createInterceptor({ failOpen: true });
      interceptor.install();

      // Should not throw — failOpen returns null from syncPolicyCheck
      const req = httpModule.request('http://example.com/data');
      req.on('error', () => {});
      req.destroy();

      interceptor.uninstall();
    });

    it('throws non-PolicyDeniedError with failOpen=false', () => {
      mockSyncRequest.mockImplementation(() => {
        throw new Error('broker unavailable');
      });

      const interceptor = createInterceptor({ failOpen: false });
      interceptor.install();

      const req = httpModule.request('http://example.com/data');

      return new Promise<void>((resolve) => {
        req.on('error', (err: Error) => {
          expect(err.message).toBe('broker unavailable');
          interceptor.uninstall();
          resolve();
        });
      });
    });

    it('handles RequestOptions (object) input', () => {
      mockSyncRequest.mockReturnValue({ allowed: true });

      const interceptor = createInterceptor();
      interceptor.install();

      const req = httpModule.request({
        hostname: 'api.example.com',
        port: 443,
        path: '/data',
        method: 'GET',
      });
      req.on('error', () => {});
      req.destroy();

      expect(mockSyncRequest).toHaveBeenCalledWith(
        'policy_check',
        expect.objectContaining({
          target: expect.stringContaining('api.example.com'),
        })
      );

      interceptor.uninstall();
    });

    it('handles URL object input', () => {
      mockSyncRequest.mockReturnValue({ allowed: true });

      const interceptor = createInterceptor();
      interceptor.install();

      const url = new URL('http://example.com/path');
      const req = httpModule.request(url);
      req.on('error', () => {});
      req.destroy();

      expect(mockSyncRequest).toHaveBeenCalled();

      interceptor.uninstall();
    });

    it('routes through proxy when proxy is enabled', () => {
      mockGetProxyConfig.mockReturnValue({
        enabled: true,
        hostname: '127.0.0.1',
        port: 8888,
        url: 'http://127.0.0.1:8888',
        noProxy: [],
      });
      mockShouldBypassProxy.mockReturnValue(false);

      const interceptor = createInterceptor();
      interceptor.install();

      const req = httpModule.request('http://example.com/proxied');
      req.on('error', () => {});
      req.destroy();

      // Policy check should NOT be called (proxy mode skips it)
      expect(mockSyncRequest).not.toHaveBeenCalled();

      interceptor.uninstall();
    });

    it('skips proxy for bypassed URLs', () => {
      mockGetProxyConfig.mockReturnValue({
        enabled: true,
        hostname: '127.0.0.1',
        port: 8888,
        url: 'http://127.0.0.1:8888',
        noProxy: ['internal.com'],
      });
      mockShouldBypassProxy.mockReturnValue(true);
      mockSyncRequest.mockReturnValue({ allowed: true });

      const interceptor = createInterceptor();
      interceptor.install();

      const req = httpModule.request('http://internal.com/api');
      req.on('error', () => {});
      req.destroy();

      // Should fall through to direct policy check
      expect(mockSyncRequest).toHaveBeenCalled();

      interceptor.uninstall();
    });
  });

  describe('intercepted get', () => {
    it('calls request + end()', () => {
      mockSyncRequest.mockReturnValue({ allowed: true });

      const interceptor = createInterceptor();
      interceptor.install();

      const req = httpModule.get('http://example.com/data');
      req.on('error', () => {});
      req.destroy();

      expect(mockSyncRequest).toHaveBeenCalled();

      interceptor.uninstall();
    });
  });
});
