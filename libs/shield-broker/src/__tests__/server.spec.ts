import { EventEmitter } from 'node:events';
import { UnixSocketServer } from '../server.js';

// ── Mocks ──────────────────────────────────────────────────────────────

jest.mock('node:net', () => {
  let connectionCallback: ((socket: any) => void) | null = null;
  return {
    createServer: jest.fn((cb: any) => {
      connectionCallback = cb;
      const server = new (require('node:events').EventEmitter)();
      server.listen = jest.fn((_path: string, cb2: () => void) => {
        setImmediate(cb2);
      });
      server.close = jest.fn((cb2: () => void) => {
        if (cb2) setImmediate(cb2);
      });
      return server;
    }),
    __getConnectionCallback: () => connectionCallback,
  };
});

jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  unlinkSync: jest.fn(),
  chmodSync: jest.fn(),
}));

jest.mock('node:crypto', () => ({
  randomUUID: () => 'test-uuid',
}));

jest.mock('../handlers/index.js', () => ({
  handleHttpRequest: jest.fn().mockResolvedValue({ success: true, data: { status: 200 } }),
  handleFileRead: jest.fn().mockResolvedValue({ success: true, data: { content: 'ok' } }),
  handleFileWrite: jest.fn().mockResolvedValue({ success: true, data: { bytesWritten: 2 } }),
  handleFileList: jest.fn().mockResolvedValue({ success: true, data: { entries: [] } }),
  handleExec: jest.fn().mockResolvedValue({ success: true, data: { exitCode: 0, stdout: '', stderr: '' } }),
  handleOpenUrl: jest.fn().mockResolvedValue({ success: true, data: { opened: true } }),
  handleSecretInject: jest.fn().mockResolvedValue({ success: true, data: { value: 'secret', injected: true } }),
  handlePing: jest.fn().mockResolvedValue({ success: true, data: { pong: true, timestamp: '2025-01-01', version: '0.1.0' } }),
  handleSkillInstall: jest.fn().mockResolvedValue({ success: true, data: { installed: true } }),
  handleSkillUninstall: jest.fn().mockResolvedValue({ success: true, data: { uninstalled: true } }),
  handlePolicyCheck: jest.fn().mockResolvedValue({ success: true, data: { allowed: true, policyId: 'p1' } }),
  handleEventsBatch: jest.fn().mockResolvedValue({ success: true, data: { received: 1 } }),
  handleSecretsSync: jest.fn().mockResolvedValue({ success: true, data: { ok: true } }),
}));

jest.mock('../daemon-forward.js', () => ({
  forwardPolicyToDaemon: jest.fn().mockResolvedValue(null),
}));

import * as fs from 'node:fs';
import * as net from 'node:net';
import * as handlers from '../handlers/index.js';
import { forwardPolicyToDaemon } from '../daemon-forward.js';

const mockedFs = fs as jest.Mocked<typeof fs>;
const getConnectionCallback = (net as any).__getConnectionCallback as () => ((socket: any) => void);

function createMockSocket(): EventEmitter & { write: jest.Mock; destroy: jest.Mock } {
  const socket = new EventEmitter() as any;
  socket.write = jest.fn();
  socket.destroy = jest.fn();
  return socket;
}

function createServerOptions(overrides?: Partial<any>) {
  return {
    config: {
      socketPath: '/tmp/test.sock',
      httpEnabled: false,
      httpPort: 0,
      httpHost: '127.0.0.1',
      configPath: '/tmp/config',
      policiesPath: '/tmp/policies',
      auditLogPath: '/tmp/audit.log',
      logLevel: 'error',
      failOpen: false,
      socketMode: 0o660,
      daemonUrl: 'http://127.0.0.1:5200',
      ...overrides?.config,
    },
    policyEnforcer: {
      check: jest.fn().mockResolvedValue({ allowed: true }),
      getPolicies: jest.fn(),
      ...overrides?.policyEnforcer,
    },
    auditLogger: {
      log: jest.fn().mockResolvedValue(undefined),
      ...overrides?.auditLogger,
    },
    secretVault: {
      get: jest.fn(),
      ...overrides?.secretVault,
    },
    commandAllowlist: {
      resolve: jest.fn(),
      ...overrides?.commandAllowlist,
    },
    ...overrides,
  };
}

describe('UnixSocketServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('start()', () => {
    it('should remove existing socket file', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      const server = new UnixSocketServer(createServerOptions() as any);
      await server.start();
      expect(mockedFs.unlinkSync).toHaveBeenCalledWith('/tmp/test.sock');
    });

    it('should not unlink when socket does not exist', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const server = new UnixSocketServer(createServerOptions() as any);
      await server.start();
      expect(mockedFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should create server and listen', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const server = new UnixSocketServer(createServerOptions() as any);
      await server.start();
      expect(net.createServer).toHaveBeenCalled();
    });

    it('should chmod socket after listen', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const server = new UnixSocketServer(createServerOptions() as any);
      await server.start();
      expect(mockedFs.chmodSync).toHaveBeenCalledWith('/tmp/test.sock', 0o660);
    });

    it('should warn when chmod fails', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.chmodSync.mockImplementation(() => { throw new Error('EPERM'); });
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const server = new UnixSocketServer(createServerOptions() as any);
      await server.start();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not set socket permissions'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('should reject when server emits error', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      // Override createServer to emit error
      (net.createServer as jest.Mock).mockImplementationOnce((cb: any) => {
        const server = new EventEmitter() as any;
        server.listen = jest.fn(() => {
          setImmediate(() => server.emit('error', new Error('EADDRINUSE')));
        });
        server.close = jest.fn();
        return server;
      });

      const server = new UnixSocketServer(createServerOptions() as any);
      await expect(server.start()).rejects.toThrow('EADDRINUSE');
    });
  });

  describe('stop()', () => {
    it('should resolve immediately when server is null', async () => {
      const server = new UnixSocketServer(createServerOptions() as any);
      // Don't start — server is null
      await server.stop();
    });

    it('should destroy all connections and close server', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const server = new UnixSocketServer(createServerOptions() as any);
      await server.start();

      // Simulate a connection
      const socket = createMockSocket();
      const cb = getConnectionCallback();
      cb(socket);

      mockedFs.existsSync.mockReturnValue(true);
      await server.stop();

      expect(socket.destroy).toHaveBeenCalled();
    });

    it('should ignore cleanup errors on unlinkSync', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const server = new UnixSocketServer(createServerOptions() as any);
      await server.start();

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.unlinkSync.mockImplementation(() => { throw new Error('ENOENT'); });
      // Should not throw
      await server.stop();
    });
  });

  describe('handleConnection()', () => {
    it('should process newline-delimited JSON', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const opts = createServerOptions();
      const server = new UnixSocketServer(opts as any);
      await server.start();

      const socket = createMockSocket();
      const cb = getConnectionCallback();
      cb(socket);

      // Send a valid JSON-RPC request
      const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} });
      socket.emit('data', Buffer.from(request + '\n'));

      // Wait for async processing
      await new Promise((r) => setTimeout(r, 50));
      expect(socket.write).toHaveBeenCalled();
      const response = JSON.parse(socket.write.mock.calls[0][0].replace('\n', ''));
      expect(response.jsonrpc).toBe('2.0');
    });

    it('should handle multiple messages in one data event', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const opts = createServerOptions();
      const server = new UnixSocketServer(opts as any);
      await server.start();

      const socket = createMockSocket();
      const cb = getConnectionCallback();
      cb(socket);

      const req1 = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} });
      const req2 = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: {} });
      socket.emit('data', Buffer.from(req1 + '\n' + req2 + '\n'));

      await new Promise((r) => setTimeout(r, 100));
      expect(socket.write).toHaveBeenCalledTimes(2);
    });

    it('should skip empty lines', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const opts = createServerOptions();
      const server = new UnixSocketServer(opts as any);
      await server.start();

      const socket = createMockSocket();
      const cb = getConnectionCallback();
      cb(socket);

      socket.emit('data', Buffer.from('\n\n'));

      await new Promise((r) => setTimeout(r, 50));
      expect(socket.write).not.toHaveBeenCalled();
    });

    it('should remove socket on close', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const server = new UnixSocketServer(createServerOptions() as any);
      await server.start();

      const socket = createMockSocket();
      const cb = getConnectionCallback();
      cb(socket);

      socket.emit('close');
      // Connection should be removed from the set
      expect((server as any).connections.size).toBe(0);
    });

    it('should remove socket on error', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const server = new UnixSocketServer(createServerOptions() as any);
      await server.start();

      const socket = createMockSocket();
      const cb = getConnectionCallback();
      cb(socket);

      socket.emit('error', new Error('test'));
      expect((server as any).connections.size).toBe(0);
      consoleSpy.mockRestore();
    });
  });

  describe('processRequest()', () => {
    let server: UnixSocketServer;
    let opts: ReturnType<typeof createServerOptions>;
    let socket: ReturnType<typeof createMockSocket>;

    beforeEach(async () => {
      mockedFs.existsSync.mockReturnValue(false);
      opts = createServerOptions();
      server = new UnixSocketServer(opts as any);
      await server.start();

      socket = createMockSocket();
      const cb = getConnectionCallback();
      cb(socket);
    });

    async function sendRequest(request: string): Promise<any> {
      socket.emit('data', Buffer.from(request + '\n'));
      await new Promise((r) => setTimeout(r, 50));
      if (socket.write.mock.calls.length === 0) return null;
      return JSON.parse(socket.write.mock.calls[socket.write.mock.calls.length - 1][0].replace('\n', ''));
    }

    it('should return -32700 for invalid JSON', async () => {
      const response = await sendRequest('not json');
      expect(response.error.code).toBe(-32700);
      expect(response.error.message).toBe('Parse error');
    });

    it('should return -32600 for invalid jsonrpc structure', async () => {
      const response = await sendRequest(JSON.stringify({ method: 'ping', id: 1 }));
      expect(response.error.code).toBe(-32600);
    });

    it('should return -32600 when id is missing', async () => {
      const response = await sendRequest(JSON.stringify({ jsonrpc: '2.0', method: 'ping' }));
      expect(response.error.code).toBe(-32600);
    });

    it('should skip policy check for policy_check method', async () => {
      await sendRequest(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'policy_check', params: { operation: 'exec', target: 'test' } }));
      // policyEnforcer.check should NOT be called for policy_check
      expect(opts.policyEnforcer.check).not.toHaveBeenCalled();
    });

    it('should check policy for regular methods', async () => {
      await sendRequest(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }));
      expect(opts.policyEnforcer.check).toHaveBeenCalledWith(
        'ping',
        {},
        expect.objectContaining({ channel: 'socket' })
      );
    });

    it('should forward to daemon when broker denies', async () => {
      opts.policyEnforcer.check.mockResolvedValue({ allowed: false, reason: 'denied' });
      (forwardPolicyToDaemon as jest.Mock).mockResolvedValue({ allowed: true, policyId: 'daemon-p' });

      const response = await sendRequest(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }));
      expect(forwardPolicyToDaemon).toHaveBeenCalled();
      expect(response.result).toBeDefined();
    });

    it('should return 1001 when final policy denies and log audit', async () => {
      opts.policyEnforcer.check.mockResolvedValue({ allowed: false, reason: 'denied' });
      (forwardPolicyToDaemon as jest.Mock).mockResolvedValue(null);

      const response = await sendRequest(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }));
      expect(response.error.code).toBe(1001);
      expect(opts.auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          allowed: false,
          result: 'denied',
        })
      );
    });

    it('should return -32601 for unknown method', async () => {
      const response = await sendRequest(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'unknown_method', params: {} }));
      expect(response.error.code).toBe(-32601);
    });

    it('should call handler and return success result', async () => {
      const response = await sendRequest(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }));
      expect(response.result).toBeDefined();
      expect(response.result.pong).toBe(true);
    });

    it('should return handler error response', async () => {
      (handlers.handlePing as jest.Mock).mockResolvedValueOnce({
        success: false,
        error: { code: 1234, message: 'handler failed' },
      });

      const response = await sendRequest(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }));
      expect(response.error.code).toBe(1234);
      expect(response.error.message).toBe('handler failed');
    });

    it('should log audit with policy_check special handling', async () => {
      (handlers.handlePolicyCheck as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: { allowed: false, policyId: 'deny-rule' },
      });

      await sendRequest(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'policy_check',
        params: { operation: 'exec', target: 'bad-cmd' },
      }));

      expect(opts.auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          allowed: false,
          policyId: 'deny-rule',
          target: 'bad-cmd',
        })
      );
    });

    it('should catch unexpected errors and return -32603', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      opts.policyEnforcer.check.mockRejectedValue(new Error('unexpected'));

      const response = await sendRequest(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }));
      expect(response.error.code).toBe(-32603);
      expect(response.error.message).toBe('Internal error');
      consoleSpy.mockRestore();
    });
  });

  describe('getHandler()', () => {
    it('should return handler for each registered method', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const server = new UnixSocketServer(createServerOptions() as any);

      const methods = [
        'http_request', 'file_read', 'file_write', 'file_list',
        'exec', 'open_url', 'secret_inject', 'ping',
        'skill_install', 'skill_uninstall', 'policy_check',
        'events_batch', 'secrets_sync',
      ];

      for (const method of methods) {
        const handler = (server as any).getHandler(method);
        expect(handler).toBeDefined();
      }
    });

    it('should return undefined for unknown method', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const server = new UnixSocketServer(createServerOptions() as any);
      expect((server as any).getHandler('nonexistent')).toBeUndefined();
    });
  });

  describe('extractTarget()', () => {
    it('should extract url from params', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const server = new UnixSocketServer(createServerOptions() as any);
      expect((server as any).extractTarget({ method: 'http_request', params: { url: 'https://example.com' } }))
        .toBe('https://example.com');
    });

    it('should extract path from params', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const server = new UnixSocketServer(createServerOptions() as any);
      expect((server as any).extractTarget({ method: 'file_read', params: { path: '/tmp/file.txt' } }))
        .toBe('/tmp/file.txt');
    });

    it('should extract command from params', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const server = new UnixSocketServer(createServerOptions() as any);
      expect((server as any).extractTarget({ method: 'exec', params: { command: 'ls -la' } }))
        .toBe('ls -la');
    });

    it('should extract name from params', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const server = new UnixSocketServer(createServerOptions() as any);
      expect((server as any).extractTarget({ method: 'secret_inject', params: { name: 'API_KEY' } }))
        .toBe('API_KEY');
    });

    it('should fall back to method name', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const server = new UnixSocketServer(createServerOptions() as any);
      expect((server as any).extractTarget({ method: 'ping', params: {} }))
        .toBe('ping');
    });
  });

  describe('errorResponse()', () => {
    it('should return valid JSON-RPC error', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const server = new UnixSocketServer(createServerOptions() as any);
      const result = (server as any).errorResponse('req-1', -32600, 'Invalid');
      expect(result).toEqual({
        jsonrpc: '2.0',
        id: 'req-1',
        error: { code: -32600, message: 'Invalid' },
      });
    });

    it('should use 0 when id is null', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const server = new UnixSocketServer(createServerOptions() as any);
      const result = (server as any).errorResponse(null, -32700, 'Parse error');
      expect(result.id).toBe(0);
    });
  });
});
