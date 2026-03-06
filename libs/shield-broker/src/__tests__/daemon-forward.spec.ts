import * as net from 'node:net';
import {
  forwardPolicyToDaemon,
  forwardOpenUrlToDaemon,
  forwardEventsToDaemon,
} from '../daemon-forward.js';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// Mock net.createConnection
jest.mock('node:net', () => ({
  createConnection: jest.fn(),
}));

const mockedNet = net as jest.Mocked<typeof net>;

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockReset();
});

describe('forwardPolicyToDaemon()', () => {
  it('should try socket first when daemonSocketPath is provided', async () => {
    const { EventEmitter } = require('node:events');
    const socket = new EventEmitter();
    socket.write = jest.fn();
    socket.destroy = jest.fn();
    mockedNet.createConnection.mockImplementation((_path: any, cb: any) => {
      setImmediate(cb);
      return socket;
    });

    // Simulate socket response
    setImmediate(() => {
      socket.emit('data', JSON.stringify({ result: { allowed: true, policyId: 'p1' } }) + '\n');
    });

    const result = await forwardPolicyToDaemon(
      'exec', 'node', 'http://localhost:5200', undefined,
      { daemonSocketPath: '/tmp/daemon.sock' }
    );

    expect(mockedNet.createConnection).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(true);
    expect(result!.policyId).toBe('p1');
  });

  it('should fall back to HTTP when socket fails', async () => {
    const { EventEmitter } = require('node:events');
    const socket = new EventEmitter();
    socket.write = jest.fn();
    socket.destroy = jest.fn();
    mockedNet.createConnection.mockImplementation((_path: any, _cb: any) => {
      setImmediate(() => socket.emit('error', new Error('ENOENT')));
      return socket;
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { allowed: true, policyId: 'http-p1' } }),
    });

    const result = await forwardPolicyToDaemon(
      'exec', 'node', 'http://localhost:5200', undefined,
      { daemonSocketPath: '/tmp/missing.sock', token: 'tok' }
    );

    expect(mockFetch).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result!.policyId).toBe('http-p1');
  });

  it('should use HTTP when no socket path provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { allowed: true, policyId: 'http-p' } }),
    });

    const result = await forwardPolicyToDaemon('exec', 'node', 'http://localhost:5200');
    expect(mockFetch).toHaveBeenCalled();
    expect(result!.policyId).toBe('http-p');
  });

  it('should include auth headers in HTTP request', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { allowed: true, policyId: 'p1' } }),
    });

    await forwardPolicyToDaemon(
      'exec', 'node', 'http://localhost:5200', undefined,
      { token: 'my-token', profileId: 'profile-1' }
    );

    const callArgs = mockFetch.mock.calls[0];
    const options = callArgs[1];
    expect(options.headers['x-shield-broker-token']).toBe('my-token');
    expect(options.headers['x-shield-profile-id']).toBe('profile-1');
  });

  it('should return null when daemon returns HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const result = await forwardPolicyToDaemon('exec', 'node', 'http://localhost:5200');
    expect(result).toBeNull();
  });

  it('should return null when daemon is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await forwardPolicyToDaemon('exec', 'node', 'http://localhost:5200');
    expect(result).toBeNull();
  });

  it('should resolve null on socket timeout', async () => {
    const { EventEmitter } = require('node:events');
    const socket = new EventEmitter();
    socket.write = jest.fn();
    socket.destroy = jest.fn();
    mockedNet.createConnection.mockImplementation((_path: any, cb: any) => {
      setImmediate(cb);
      return socket;
    });

    // Socket never emits data — timeout should fire
    jest.useFakeTimers();
    const promise = forwardPolicyToDaemon(
      'exec', 'node', 'http://localhost:5200', undefined,
      { daemonSocketPath: '/tmp/test.sock' }
    );
    jest.advanceTimersByTime(3000);
    const result = await promise;
    jest.useRealTimers();

    expect(socket.destroy).toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('should resolve null when socket returns error response', async () => {
    const { EventEmitter } = require('node:events');
    const socket = new EventEmitter();
    socket.write = jest.fn();
    socket.destroy = jest.fn();
    mockedNet.createConnection.mockImplementation((_path: any, cb: any) => {
      setImmediate(cb);
      return socket;
    });

    setImmediate(() => {
      socket.emit('data', JSON.stringify({ jsonrpc: '2.0', error: { message: 'bad' } }) + '\n');
    });

    const result = await forwardPolicyToDaemon(
      'exec', 'node', 'http://localhost:5200', undefined,
      { daemonSocketPath: '/tmp/test.sock' }
    );
    expect(result).toBeNull();
  });

  it('should resolve null when socket returns invalid JSON', async () => {
    const { EventEmitter } = require('node:events');
    const socket = new EventEmitter();
    socket.write = jest.fn();
    socket.destroy = jest.fn();
    mockedNet.createConnection.mockImplementation((_path: any, cb: any) => {
      setImmediate(cb);
      return socket;
    });

    setImmediate(() => {
      socket.emit('data', 'not valid json\n');
    });

    const result = await forwardPolicyToDaemon(
      'exec', 'node', 'http://localhost:5200', undefined,
      { daemonSocketPath: '/tmp/test.sock' }
    );
    expect(result).toBeNull();
  });

  it('should return null when HTTP response has error field', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: { message: 'bad request' } }),
    });
    const result = await forwardPolicyToDaemon('exec', 'node', 'http://localhost:5200');
    expect(result).toBeNull();
  });
});

describe('interpretDaemonResult (via forwardPolicyToDaemon)', () => {
  it('should trust result with policyId', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        result: { allowed: true, policyId: 'user-rule', reason: 'User allowed', sandbox: { profile: 'strict' } },
      }),
    });
    const result = await forwardPolicyToDaemon('exec', 'node', 'http://localhost:5200');
    expect(result!.allowed).toBe(true);
    expect(result!.policyId).toBe('user-rule');
    expect(result!.sandbox).toEqual({ profile: 'strict' });
  });

  it('should return null for default-allow without policyId or sandbox', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { allowed: true } }),
    });
    const result = await forwardPolicyToDaemon('exec', 'node', 'http://localhost:5200');
    expect(result).toBeNull();
  });

  it('should return allowed with sandbox even without policyId', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        result: { allowed: true, sandbox: { profile: 'default' } },
      }),
    });
    const result = await forwardPolicyToDaemon('exec', 'node', 'http://localhost:5200');
    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(true);
    expect(result!.sandbox).toEqual({ profile: 'default' });
  });
});

describe('forwardOpenUrlToDaemon()', () => {
  it('should return { opened, reason } from daemon', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { opened: true } }),
    });
    const result = await forwardOpenUrlToDaemon('https://example.com', undefined, 'http://localhost:5200');
    expect(result).toEqual({ opened: true, reason: undefined });
  });

  it('should return null on error', async () => {
    mockFetch.mockRejectedValue(new Error('unreachable'));
    const result = await forwardOpenUrlToDaemon('https://example.com', undefined, 'http://localhost:5200');
    expect(result).toBeNull();
  });

  it('should return opened:false with reason on daemon error', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: { message: 'Policy denied' } }),
    });
    const result = await forwardOpenUrlToDaemon('https://example.com', undefined, 'http://localhost:5200');
    expect(result!.opened).toBe(false);
    expect(result!.reason).toBe('Policy denied');
  });

  it('should return result from socket when available', async () => {
    const { EventEmitter } = require('node:events');
    const socket = new EventEmitter();
    socket.write = jest.fn();
    socket.destroy = jest.fn();
    mockedNet.createConnection.mockImplementation((_path: any, cb: any) => {
      setImmediate(cb);
      return socket;
    });

    setImmediate(() => {
      socket.emit('data', JSON.stringify({ result: { opened: true, reason: 'ok' } }) + '\n');
    });

    const result = await forwardOpenUrlToDaemon(
      'https://example.com', undefined, 'http://localhost:5200',
      { daemonSocketPath: '/tmp/daemon.sock' }
    );
    expect(result).toEqual({ opened: true, reason: 'ok' });
  });

  it('should return null when HTTP is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const result = await forwardOpenUrlToDaemon(
      'https://example.com', undefined, 'http://localhost:5200'
    );
    expect(result).toBeNull();
  });
});

describe('forwardEventsToDaemon()', () => {
  it('should not throw (fire-and-forget)', () => {
    mockFetch.mockResolvedValue({ ok: true });
    expect(() => {
      forwardEventsToDaemon([{ id: 'e1' }], 'http://localhost:5200');
    }).not.toThrow();
  });

  it('should include auth headers', () => {
    mockFetch.mockResolvedValue({ ok: true });
    forwardEventsToDaemon(
      [{ id: 'e1' }],
      'http://localhost:5200',
      { token: 'tok', profileId: 'p1' }
    );

    // Allow async call to happen
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['x-shield-broker-token']).toBe('tok');
  });

  it('should try socket when daemonSocketPath provided', async () => {
    const { EventEmitter } = require('node:events');
    const socket = new EventEmitter();
    socket.write = jest.fn();
    socket.destroy = jest.fn();
    mockedNet.createConnection.mockImplementation((_path: any, cb: any) => {
      setImmediate(cb);
      return socket;
    });

    // Simulate socket response
    setImmediate(() => {
      socket.emit('data', JSON.stringify({ result: { ok: true } }) + '\n');
    });

    forwardEventsToDaemon(
      [{ id: 'e1' }],
      'http://localhost:5200',
      { daemonSocketPath: '/tmp/daemon.sock', token: 'tok' }
    );

    // Wait for socket to process
    await new Promise((r) => setTimeout(r, 100));
    expect(mockedNet.createConnection).toHaveBeenCalled();
    // HTTP should NOT be called since socket was used
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
