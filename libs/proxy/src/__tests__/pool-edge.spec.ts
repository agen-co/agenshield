/**
 * Edge-case tests for ProxyPool that require mocking createPerRunProxy.
 * Separated from pool.spec.ts to avoid mock interference with functional tests.
 */

import * as http from 'node:http';
import * as net from 'node:net';
import { EventEmitter } from 'node:events';
import { ProxyBindError } from '../errors';
import type { PolicyConfig } from '@agenshield/ipc';

// Mock createPerRunProxy so we can control server behavior
jest.mock('../server', () => ({
  createPerRunProxy: jest.fn(),
}));

// Import after mock setup
import { ProxyPool } from '../pool';
import { createPerRunProxy } from '../server';

const mockedCreatePerRunProxy = createPerRunProxy as jest.MockedFunction<typeof createPerRunProxy>;

function allowAllPolicies(): PolicyConfig[] {
  return [];
}

describe('ProxyPool — edge cases (mocked server)', () => {
  afterEach(() => {
    mockedCreatePerRunProxy.mockReset();
  });

  it('rejects with ProxyBindError when server.address() returns a string (pipe)', async () => {
    // Simulate a server that listens successfully but address() returns a string (Unix socket path)
    const fakeServer = new EventEmitter() as unknown as http.Server;
    (fakeServer as unknown as Record<string, unknown>).address = () => '/tmp/fake.sock';
    (fakeServer as unknown as Record<string, unknown>).listen = (_port: number, _host: string, cb: () => void) => {
      cb();
      return fakeServer;
    };
    (fakeServer as unknown as Record<string, unknown>).close = jest.fn();

    mockedCreatePerRunProxy.mockReturnValueOnce(fakeServer);

    const pool = new ProxyPool({}, { logger: jest.fn() });

    await expect(
      pool.acquire('exec-pipe', 'cmd', allowAllPolicies, () => 'allow'),
    ).rejects.toThrow(ProxyBindError);
  });

  it('rejects with ProxyBindError when server.address() returns null', async () => {
    const fakeServer = new EventEmitter() as unknown as http.Server;
    (fakeServer as unknown as Record<string, unknown>).address = () => null;
    (fakeServer as unknown as Record<string, unknown>).listen = (_port: number, _host: string, cb: () => void) => {
      cb();
      return fakeServer;
    };
    (fakeServer as unknown as Record<string, unknown>).close = jest.fn();

    mockedCreatePerRunProxy.mockReturnValueOnce(fakeServer);

    const pool = new ProxyPool({}, { logger: jest.fn() });

    await expect(
      pool.acquire('exec-null-addr', 'cmd', allowAllPolicies, () => 'allow'),
    ).rejects.toThrow(ProxyBindError);
  });

  it('rejects with ProxyBindError when server emits error during listen', async () => {
    const fakeServer = new EventEmitter() as unknown as http.Server;
    (fakeServer as unknown as Record<string, unknown>).listen = function (_port: number, _host: string, _cb: () => void) {
      // Don't call cb — instead emit 'error' asynchronously
      process.nextTick(() => {
        (fakeServer as unknown as EventEmitter).emit('error', new Error('EADDRINUSE'));
      });
      return fakeServer;
    };
    (fakeServer as unknown as Record<string, unknown>).close = jest.fn();

    mockedCreatePerRunProxy.mockReturnValueOnce(fakeServer);

    const pool = new ProxyPool({}, { logger: jest.fn() });

    await expect(
      pool.acquire('exec-bind-error', 'cmd', allowAllPolicies, () => 'allow'),
    ).rejects.toThrow('EADDRINUSE');
  });
});
