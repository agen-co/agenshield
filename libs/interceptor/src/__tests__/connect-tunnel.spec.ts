/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Tests for the CONNECT tunnel utility used by fetch and http interceptors
 * to route HTTPS traffic through the proxy via CONNECT tunneling.
 */

import { EventEmitter } from 'node:events';

jest.mock('../debug-log', () => ({ debugLog: jest.fn() }));

// Mock http.request at module level — connect-tunnel.ts captures it at import time
const mockRawRequest = jest.fn();
jest.mock('node:http', () => ({
  request: (...args: any[]) => mockRawRequest(...args),
}));

// Mock tls.connect to avoid real TLS handshakes
jest.mock('node:tls', () => ({
  connect: jest.fn(),
}));

import { establishConnectTunnel } from '../proxy/connect-tunnel';
import { PolicyDeniedError } from '../errors';
import * as tls from 'node:tls';

const mockTlsConnect = tls.connect as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('establishConnectTunnel', () => {
  it('should reject with PolicyDeniedError on 403 response', async () => {
    const mockReq = new EventEmitter() as any;
    mockReq.end = jest.fn();
    mockReq.destroy = jest.fn();

    mockRawRequest.mockReturnValue(mockReq);

    const tunnelPromise = establishConnectTunnel({
      proxyHostname: '127.0.0.1',
      proxyPort: 8888,
      targetHostname: 'blocked.com',
      targetPort: 443,
    });

    // Simulate 403 response
    const mockSocket = new EventEmitter() as any;
    mockSocket.destroy = jest.fn();
    const mockRes = { statusCode: 403 } as any;

    process.nextTick(() => {
      mockReq.emit('connect', mockRes, mockSocket, Buffer.alloc(0));
    });

    await expect(tunnelPromise).rejects.toThrow(PolicyDeniedError);
    expect(mockSocket.destroy).toHaveBeenCalled();
  });

  it('should reject with error on non-200/non-403 status', async () => {
    const mockReq = new EventEmitter() as any;
    mockReq.end = jest.fn();
    mockReq.destroy = jest.fn();

    mockRawRequest.mockReturnValue(mockReq);

    const tunnelPromise = establishConnectTunnel({
      proxyHostname: '127.0.0.1',
      proxyPort: 8888,
      targetHostname: 'error.com',
      targetPort: 443,
    });

    // Simulate 502 response
    const mockSocket = new EventEmitter() as any;
    mockSocket.destroy = jest.fn();
    const mockRes = { statusCode: 502 } as any;

    process.nextTick(() => {
      mockReq.emit('connect', mockRes, mockSocket, Buffer.alloc(0));
    });

    await expect(tunnelPromise).rejects.toThrow('CONNECT tunnel failed with status 502');
    expect(mockSocket.destroy).toHaveBeenCalled();
  });

  it('should reject on request error', async () => {
    const mockReq = new EventEmitter() as any;
    mockReq.end = jest.fn();
    mockReq.destroy = jest.fn();

    mockRawRequest.mockReturnValue(mockReq);

    const tunnelPromise = establishConnectTunnel({
      proxyHostname: '127.0.0.1',
      proxyPort: 8888,
      targetHostname: 'unreachable.com',
      targetPort: 443,
    });

    // Simulate connection error
    process.nextTick(() => {
      mockReq.emit('error', new Error('ECONNREFUSED'));
    });

    await expect(tunnelPromise).rejects.toThrow('ECONNREFUSED');
  });

  it('should resolve with TLS socket on 200 response', async () => {
    const mockReq = new EventEmitter() as any;
    mockReq.end = jest.fn();
    mockReq.destroy = jest.fn();

    mockRawRequest.mockReturnValue(mockReq);

    // Create a mock TLS socket
    const mockTlsSocket = new EventEmitter() as any;
    mockTlsConnect.mockReturnValue(mockTlsSocket);

    const tunnelPromise = establishConnectTunnel({
      proxyHostname: '127.0.0.1',
      proxyPort: 8888,
      targetHostname: 'example.com',
      targetPort: 443,
    });

    // Verify CONNECT request was made correctly
    expect(mockRawRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: '127.0.0.1',
        port: 8888,
        method: 'CONNECT',
        path: 'example.com:443',
      }),
    );
    expect(mockReq.end).toHaveBeenCalled();

    // Simulate 200 response
    const mockSocket = new EventEmitter() as any;
    mockSocket.unshift = jest.fn();
    const mockRes = { statusCode: 200 } as any;

    process.nextTick(() => {
      mockReq.emit('connect', mockRes, mockSocket, Buffer.alloc(0));

      // Simulate TLS handshake completion
      process.nextTick(() => {
        mockTlsSocket.emit('secureConnect');
      });
    });

    const result = await tunnelPromise;
    expect(result.socket).toBe(mockSocket);
    expect(result.tlsSocket).toBe(mockTlsSocket);

    // Verify tls.connect was called with correct options
    expect(mockTlsConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        socket: mockSocket,
        servername: 'example.com',
      }),
    );
  });

  it('should use default port 443 when not specified', () => {
    const mockReq = new EventEmitter() as any;
    mockReq.end = jest.fn();
    mockReq.destroy = jest.fn();

    mockRawRequest.mockReturnValue(mockReq);
    mockTlsConnect.mockReturnValue(new EventEmitter());

    establishConnectTunnel({
      proxyHostname: '127.0.0.1',
      proxyPort: 8888,
      targetHostname: 'example.com',
    });

    expect(mockRawRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'example.com:443',
      }),
    );
  });

  it('should reject on timeout', async () => {
    jest.useFakeTimers();

    const mockReq = new EventEmitter() as any;
    mockReq.end = jest.fn();
    mockReq.destroy = jest.fn().mockImplementation((err: Error) => {
      process.nextTick(() => mockReq.emit('error', err));
    });

    mockRawRequest.mockReturnValue(mockReq);

    const tunnelPromise = establishConnectTunnel({
      proxyHostname: '127.0.0.1',
      proxyPort: 8888,
      targetHostname: 'slow.com',
      targetPort: 443,
      timeoutMs: 1000,
    });

    jest.advanceTimersByTime(1001);

    await expect(tunnelPromise).rejects.toThrow('timeout');

    jest.useRealTimers();
  });
});
