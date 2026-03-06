/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('../debug-log', () => ({ debugLog: jest.fn() }));

const mockSyncRequest = jest.fn();
jest.mock('../client/sync-client', () => ({
  SyncClient: jest.fn().mockImplementation(() => ({
    request: mockSyncRequest,
  })),
}));

jest.mock('../proxy-env', () => ({
  getProxyConfig: jest.fn().mockReturnValue({ enabled: false, hostname: '', port: 0, url: '', noProxy: [] }),
  shouldBypassProxy: jest.fn().mockReturnValue(false),
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
