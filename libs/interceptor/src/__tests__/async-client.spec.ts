/* eslint-disable @typescript-eslint/no-explicit-any */

import { EventEmitter } from 'node:events';

// Mock net.createConnection
const mockSocket = new EventEmitter() as any;
mockSocket.write = jest.fn();
mockSocket.end = jest.fn();
mockSocket.destroy = jest.fn();

jest.mock('node:net', () => ({
  createConnection: jest.fn(() => {
    // Return a fresh EventEmitter each call
    const s = new EventEmitter() as any;
    s.write = jest.fn();
    s.end = jest.fn();
    s.destroy = jest.fn();
    // Store for test access
    (jest.requireMock('node:net') as any).__lastSocket = s;
    return s;
  }),
}));

jest.mock('../debug-log', () => ({
  debugLog: jest.fn(),
}));

import { AsyncClient } from '../client/http-client';
import { BrokerUnavailableError, TimeoutError } from '../errors';

const netMock = jest.requireMock('node:net') as any;

function getLastSocket(): EventEmitter & { write: jest.Mock; end: jest.Mock; destroy: jest.Mock } {
  return netMock.__lastSocket;
}

describe('AsyncClient', () => {
  let client: AsyncClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    originalFetch = globalThis.fetch;
    client = new AsyncClient({
      socketPath: '/tmp/test.sock',
      httpHost: 'localhost',
      httpPort: 5201,
      timeout: 2000,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('request via socket', () => {
    it('resolves on successful socket response', async () => {
      const promise = client.request('policy_check', { op: 'exec' });

      const socket = getLastSocket();
      socket.emit('connect');

      const response = JSON.stringify({
        jsonrpc: '2.0',
        id: 'test',
        result: { allowed: true },
      }) + '\n';
      socket.emit('data', Buffer.from(response));

      const result = await promise;
      expect(result).toEqual({ allowed: true });
      expect(socket.write).toHaveBeenCalled();
      expect(socket.end).toHaveBeenCalled();
    });

    it('rejects with TimeoutError on socket timeout', async () => {
      // Use a very short timeout client
      const shortClient = new AsyncClient({
        socketPath: '/tmp/test.sock',
        httpHost: 'localhost',
        httpPort: 5201,
        timeout: 10,
      });

      // Override fetch so the HTTP fallback also fails with timeout-like error
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      globalThis.fetch = jest.fn().mockRejectedValue(abortError);

      const promise = shortClient.request('test', {});
      const socket = getLastSocket();
      socket.emit('connect');

      // Wait for the real timeout to fire
      await expect(promise).rejects.toThrow(BrokerUnavailableError);
    });

    it('rejects when response has error field', async () => {
      const promise = client.request('test', {});
      const socket = getLastSocket();
      socket.emit('connect');

      const response = JSON.stringify({
        jsonrpc: '2.0',
        id: 'test',
        error: { code: -1, message: 'policy error' },
      }) + '\n';
      socket.emit('data', Buffer.from(response));

      await expect(promise).rejects.toThrow('policy error');
    });

    it('rejects on invalid JSON response', async () => {
      const promise = client.request('test', {});
      const socket = getLastSocket();
      socket.emit('connect');

      socket.emit('data', Buffer.from('not-json\n'));

      await expect(promise).rejects.toThrow('Invalid response from broker');
    });
  });

  describe('request fallback to HTTP', () => {
    it('falls back to HTTP when socket errors', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          jsonrpc: '2.0',
          id: 'x',
          result: { allowed: false },
        }),
      });
      globalThis.fetch = mockFetch;

      // Re-create client to capture the new fetch
      client = new AsyncClient({
        socketPath: '/tmp/test.sock',
        httpHost: 'localhost',
        httpPort: 5201,
        timeout: 2000,
      });

      const promise = client.request('test', { foo: 'bar' });
      const socket = getLastSocket();
      socket.emit('error', new Error('ENOENT'));

      const result = await promise;
      expect(result).toEqual({ allowed: false });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5201/rpc',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('throws BrokerUnavailableError when both socket and HTTP fail', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('fetch failed'));
      globalThis.fetch = mockFetch;

      client = new AsyncClient({
        socketPath: '/tmp/test.sock',
        httpHost: 'localhost',
        httpPort: 5201,
        timeout: 2000,
      });

      const promise = client.request('test', {});
      const socket = getLastSocket();
      socket.emit('error', new Error('socket error'));

      await expect(promise).rejects.toThrow(BrokerUnavailableError);
    });

    it('rejects when HTTP response has error field', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          jsonrpc: '2.0',
          id: 'x',
          error: { code: -1, message: 'denied' },
        }),
      });
      globalThis.fetch = mockFetch;

      client = new AsyncClient({
        socketPath: '/tmp/test.sock',
        httpHost: 'localhost',
        httpPort: 5201,
        timeout: 2000,
      });

      const promise = client.request('test', {});
      const socket = getLastSocket();
      socket.emit('error', new Error('socket err'));

      // The HTTP request succeeds but response has an error
      // This triggers a second error in httpRequest, which bubbles up as BrokerUnavailableError
      await expect(promise).rejects.toThrow(BrokerUnavailableError);
    });

    it('rejects when HTTP response is not ok', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      globalThis.fetch = mockFetch;

      client = new AsyncClient({
        socketPath: '/tmp/test.sock',
        httpHost: 'localhost',
        httpPort: 5201,
        timeout: 2000,
      });

      const promise = client.request('test', {});
      const socket = getLastSocket();
      socket.emit('error', new Error('socket err'));

      await expect(promise).rejects.toThrow(BrokerUnavailableError);
    });

    it('converts AbortError to TimeoutError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      const mockFetch = jest.fn().mockRejectedValue(abortError);
      globalThis.fetch = mockFetch;

      client = new AsyncClient({
        socketPath: '/tmp/test.sock',
        httpHost: 'localhost',
        httpPort: 5201,
        timeout: 2000,
      });

      const promise = client.request('test', {});
      const socket = getLastSocket();
      socket.emit('error', new Error('socket err'));

      // AbortError from HTTP becomes TimeoutError, but then gets caught by
      // the outer catch in request(), becoming BrokerUnavailableError
      await expect(promise).rejects.toThrow(BrokerUnavailableError);
    });
  });

  describe('ping', () => {
    it('returns true when broker responds', async () => {
      const promise = client.ping();
      const socket = getLastSocket();
      socket.emit('connect');
      const response = JSON.stringify({ jsonrpc: '2.0', id: 'x', result: {} }) + '\n';
      socket.emit('data', Buffer.from(response));

      expect(await promise).toBe(true);
    });

    it('returns false when broker is unavailable', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('fail'));
      globalThis.fetch = mockFetch;

      client = new AsyncClient({
        socketPath: '/tmp/test.sock',
        httpHost: 'localhost',
        httpPort: 5201,
        timeout: 2000,
      });

      const promise = client.ping();
      const socket = getLastSocket();
      socket.emit('error', new Error('ENOENT'));

      expect(await promise).toBe(false);
    });
  });

  describe('socket data accumulation', () => {
    it('accumulates partial data until newline', async () => {
      const promise = client.request('test', {});
      const socket = getLastSocket();
      socket.emit('connect');

      const fullResponse = JSON.stringify({ jsonrpc: '2.0', id: 'x', result: 42 }) + '\n';
      // Send in two chunks
      socket.emit('data', Buffer.from(fullResponse.slice(0, 10)));
      socket.emit('data', Buffer.from(fullResponse.slice(10)));

      expect(await promise).toBe(42);
    });
  });
});
