import { EventEmitter } from 'node:events';
import { BrokerClient } from '../../client/broker-client.js';

jest.mock('node:net', () => ({
  createConnection: jest.fn(),
}));

jest.mock('node:crypto', () => ({
  randomUUID: () => 'test-uuid',
}));

import * as net from 'node:net';

const mockedNet = net as jest.Mocked<typeof net>;

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

function createMockSocket(
  responseData?: any,
  errorEvent?: Error
): EventEmitter & { write: jest.Mock; end: jest.Mock; destroy: jest.Mock } {
  const socket = new EventEmitter() as any;
  socket.write = jest.fn();
  socket.end = jest.fn();
  socket.destroy = jest.fn();

  if (responseData !== undefined) {
    // Emit connect, then data with response
    setImmediate(() => {
      socket.emit('connect');
      setImmediate(() => {
        socket.emit('data', Buffer.from(
          JSON.stringify({ jsonrpc: '2.0', id: 'test-uuid', result: responseData }) + '\n'
        ));
      });
    });
  } else if (errorEvent) {
    setImmediate(() => {
      socket.emit('error', errorEvent);
    });
  }

  return socket;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockReset();
});

describe('BrokerClient', () => {
  describe('constructor', () => {
    it('should use defaults when no options', () => {
      const client = new BrokerClient();
      expect((client as any).httpHost).toBe('localhost');
      expect((client as any).httpPort).toBe(5201);
      expect((client as any).timeout).toBe(30000);
      expect((client as any).preferSocket).toBe(true);
    });

    it('should read AGENSHIELD_USER_HOME for socket path', () => {
      const orig = process.env['AGENSHIELD_USER_HOME'];
      process.env['AGENSHIELD_USER_HOME'] = '/custom/home';
      try {
        const client = new BrokerClient();
        expect((client as any).socketPath).toContain('/custom/home/.agenshield/run/agenshield.sock');
      } finally {
        if (orig === undefined) delete process.env['AGENSHIELD_USER_HOME'];
        else process.env['AGENSHIELD_USER_HOME'] = orig;
      }
    });

    it('should use provided options', () => {
      const client = new BrokerClient({
        socketPath: '/my/socket',
        httpHost: 'myhost',
        httpPort: 9999,
        timeout: 5000,
        preferSocket: false,
      });
      expect((client as any).socketPath).toBe('/my/socket');
      expect((client as any).httpHost).toBe('myhost');
      expect((client as any).httpPort).toBe(9999);
      expect((client as any).timeout).toBe(5000);
      expect((client as any).preferSocket).toBe(false);
    });
  });

  describe('operation methods', () => {
    let client: BrokerClient;

    beforeEach(() => {
      client = new BrokerClient({ preferSocket: false });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', id: 'test-uuid', result: {} }),
      });
    });

    it('httpRequest calls request with http_request', async () => {
      await client.httpRequest({ url: 'https://example.com' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.method).toBe('http_request');
    });

    it('fileRead calls request with file_read', async () => {
      await client.fileRead({ path: '/tmp/test' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.method).toBe('file_read');
    });

    it('fileWrite forces channel: socket', async () => {
      const socket = createMockSocket({ bytesWritten: 5, path: '/tmp/test' });
      mockedNet.createConnection.mockReturnValue(socket as any);

      await client.fileWrite({ path: '/tmp/test', content: 'hello' });
      expect(mockedNet.createConnection).toHaveBeenCalled();
    });

    it('exec forces channel: socket', async () => {
      const socket = createMockSocket({ exitCode: 0, stdout: '', stderr: '' });
      mockedNet.createConnection.mockReturnValue(socket as any);

      await client.exec({ command: 'echo', args: ['test'] });
      expect(mockedNet.createConnection).toHaveBeenCalled();
    });

    it('secretInject forces channel: socket', async () => {
      const socket = createMockSocket({ value: 'secret', injected: true });
      mockedNet.createConnection.mockReturnValue(socket as any);

      await client.secretInject({ name: 'MY_SECRET' });
      expect(mockedNet.createConnection).toHaveBeenCalled();
    });

    it('ping passes echo param', async () => {
      await client.ping('test-echo');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.echo).toBe('test-echo');
    });

    it('skillInstall forces channel: socket', async () => {
      const socket = createMockSocket({ installed: true });
      mockedNet.createConnection.mockReturnValue(socket as any);

      await client.skillInstall({ slug: 'test', files: [] } as any);
      expect(mockedNet.createConnection).toHaveBeenCalled();
    });

    it('policyCheck forces channel: socket', async () => {
      const socket = createMockSocket({ allowed: true });
      mockedNet.createConnection.mockReturnValue(socket as any);

      await client.policyCheck({ operation: 'exec' as any, target: 'test' });
      expect(mockedNet.createConnection).toHaveBeenCalled();
    });

    it('secretsSync forces channel: socket', async () => {
      const socket = createMockSocket({ ok: true });
      mockedNet.createConnection.mockReturnValue(socket as any);

      await client.secretsSync({
        version: '1.0.0',
        syncedAt: new Date().toISOString(),
        globalSecrets: {},
        policyBindings: [],
      });
      expect(mockedNet.createConnection).toHaveBeenCalled();
    });

    it('fileList calls request with file_list', async () => {
      await client.fileList({ path: '/tmp' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.method).toBe('file_list');
    });

    it('openUrl calls request with open_url', async () => {
      await client.openUrl({ url: 'https://example.com' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.method).toBe('open_url');
    });

    it('skillUninstall forces channel: socket', async () => {
      const socket = createMockSocket({ uninstalled: true });
      mockedNet.createConnection.mockReturnValue(socket as any);

      await client.skillUninstall({ slug: 'test-skill' } as any);
      expect(mockedNet.createConnection).toHaveBeenCalled();
      const written = socket.write.mock.calls[0][0];
      const body = JSON.parse(written.replace('\n', ''));
      expect(body.method).toBe('skill_uninstall');
    });
  });

  describe('isAvailable()', () => {
    it('returns true when ping succeeds', async () => {
      const client = new BrokerClient({ preferSocket: false });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', id: 'test-uuid', result: { pong: true } }),
      });

      expect(await client.isAvailable()).toBe(true);
    });

    it('returns false when ping throws', async () => {
      const client = new BrokerClient({ preferSocket: false });
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      expect(await client.isAvailable()).toBe(false);
    });
  });

  describe('request() routing', () => {
    it('tries socket first when preferSocket is true', async () => {
      const client = new BrokerClient({ preferSocket: true });
      const socket = createMockSocket({ pong: true });
      mockedNet.createConnection.mockReturnValue(socket as any);

      await client.ping();
      expect(mockedNet.createConnection).toHaveBeenCalled();
    });

    it('uses HTTP when preferSocket is false', async () => {
      const client = new BrokerClient({ preferSocket: false });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', id: 'test-uuid', result: { pong: true } }),
      });

      await client.ping();
      expect(mockFetch).toHaveBeenCalled();
      expect(mockedNet.createConnection).not.toHaveBeenCalled();
    });

    it('falls back to HTTP when socket fails and channel not forced', async () => {
      const client = new BrokerClient({ preferSocket: true });

      // Socket fails
      const socket = createMockSocket(undefined, new Error('ENOENT'));
      mockedNet.createConnection.mockReturnValue(socket as any);

      // HTTP succeeds
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', id: 'test-uuid', result: { pong: true } }),
      });

      const result = await client.ping();
      expect(result).toEqual({ pong: true });
      expect(mockFetch).toHaveBeenCalled();
    });

    it('throws when socket fails and channel forced to socket', async () => {
      const client = new BrokerClient({ preferSocket: true });

      const socket = createMockSocket(undefined, new Error('ENOENT'));
      mockedNet.createConnection.mockReturnValue(socket as any);

      await expect(
        client.exec({ command: 'test' }) // exec forces socket channel
      ).rejects.toThrow('ENOENT');
    });
  });

  describe('socketRequest()', () => {
    it('sends JSON-RPC on connect and resolves with result', async () => {
      const client = new BrokerClient();
      const socket = createMockSocket({ pong: true, version: '0.1.0' });
      mockedNet.createConnection.mockReturnValue(socket as any);

      const result = await client.ping();
      expect(result).toEqual({ pong: true, version: '0.1.0' });
      expect(socket.write).toHaveBeenCalled();
    });

    it('rejects with error code on error response', async () => {
      // Use exec which forces channel: 'socket' — prevents HTTP fallback
      const client = new BrokerClient();
      const socket = new EventEmitter() as any;
      socket.write = jest.fn();
      socket.end = jest.fn();
      socket.destroy = jest.fn();
      mockedNet.createConnection.mockReturnValue(socket as any);

      setImmediate(() => {
        socket.emit('connect');
        setImmediate(() => {
          socket.emit('data', Buffer.from(
            JSON.stringify({ jsonrpc: '2.0', id: 'test-uuid', error: { code: 1001, message: 'denied' } }) + '\n'
          ));
        });
      });

      await expect(client.exec({ command: 'test' })).rejects.toMatchObject({
        message: 'denied',
        code: 1001,
      });
    });

    it('rejects on socket timeout', async () => {
      jest.useFakeTimers();
      // Use exec which forces channel: 'socket'
      const client = new BrokerClient({ timeout: 1000 });
      const socket = new EventEmitter() as any;
      socket.write = jest.fn();
      socket.end = jest.fn();
      socket.destroy = jest.fn();
      mockedNet.createConnection.mockReturnValue(socket as any);

      setImmediate(() => {
        socket.emit('connect');
      });

      const promise = client.exec({ command: 'test' });
      jest.advanceTimersByTime(1100);
      jest.useRealTimers();

      await expect(promise).rejects.toThrow('Request timeout');
      expect(socket.destroy).toHaveBeenCalled();
    });

    it('rejects on socket error event', async () => {
      // Use exec which forces channel: 'socket'
      const client = new BrokerClient();
      const socket = createMockSocket(undefined, new Error('ECONNREFUSED'));
      mockedNet.createConnection.mockReturnValue(socket as any);

      await expect(client.exec({ command: 'test' })).rejects.toThrow('ECONNREFUSED');
    });

    it('rejects on invalid JSON response', async () => {
      // Use exec which forces channel: 'socket'
      const client = new BrokerClient();
      const socket = new EventEmitter() as any;
      socket.write = jest.fn();
      socket.end = jest.fn();
      socket.destroy = jest.fn();
      mockedNet.createConnection.mockReturnValue(socket as any);

      setImmediate(() => {
        socket.emit('connect');
        setImmediate(() => {
          socket.emit('data', Buffer.from('not json\n'));
        });
      });

      await expect(client.exec({ command: 'test' })).rejects.toThrow('Invalid response from broker');
    });
  });

  describe('httpRequest_internal()', () => {
    it('makes POST to /rpc and resolves with result', async () => {
      const client = new BrokerClient({ preferSocket: false, httpPort: 5201 });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', id: 'test-uuid', result: { status: 200 } }),
      });

      const result = await client.httpRequest({ url: 'https://example.com' });
      expect(result).toEqual({ status: 200 });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5201/rpc',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('throws error with code on JSON-RPC error', async () => {
      const client = new BrokerClient({ preferSocket: false });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          jsonrpc: '2.0',
          id: 'test-uuid',
          error: { code: 1001, message: 'Policy denied' },
        }),
      });

      await expect(
        client.httpRequest({ url: 'https://evil.com' })
      ).rejects.toMatchObject({
        message: 'Policy denied',
        code: 1001,
      });
    });

    it('throws on non-ok HTTP status', async () => {
      const client = new BrokerClient({ preferSocket: false });
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(
        client.httpRequest({ url: 'https://example.com' })
      ).rejects.toThrow('HTTP error: 500');
    });

    it('throws timeout on AbortError', async () => {
      const client = new BrokerClient({ preferSocket: false, timeout: 100 });
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      await expect(
        client.httpRequest({ url: 'https://example.com' })
      ).rejects.toThrow('Request timeout');
    });
  });
});
