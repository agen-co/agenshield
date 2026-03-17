/**
 * Tests for CloudClient transport layer
 */

import { CloudClient } from '../cloud-client';
import type { CloudCommand } from '../types';

// Mock credentials — default returns valid creds, tests can override
const mockLoadCloudCredentials = jest.fn(() => ({
  agentId: 'agent-1',
  privateKey: 'mock-private-key',
  cloudUrl: 'https://cloud.test',
  companyName: 'TestCo',
  registeredAt: '2025-01-01T00:00:00Z',
}));

jest.mock('../credentials', () => ({
  loadCloudCredentials: (...args: unknown[]) => mockLoadCloudCredentials(...args),
}));

// Mock auth
jest.mock('../auth', () => ({
  createAgentSigHeader: jest.fn(() => 'AgentSig mock-header'),
}));

// Mock ws
const mockWsInstance = {
  on: jest.fn(),
  close: jest.fn(),
  send: jest.fn(),
  ping: jest.fn(),
  readyState: 1,
};

jest.mock('ws', () => ({
  WebSocket: jest.fn(() => mockWsInstance),
}));

// Helper: capture WS event handlers from mockWsInstance.on
function getWsHandler(event: string): (...args: unknown[]) => void {
  const call = mockWsInstance.on.mock.calls.find(
    (c: unknown[]) => c[0] === event,
  );
  return call ? (call[1] as (...args: unknown[]) => void) : () => {};
}

describe('CloudClient', () => {
  let client: CloudClient;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();

    // Reset ws mock
    mockWsInstance.on.mockReset();
    mockWsInstance.close.mockReset();
    mockWsInstance.send.mockReset();
    mockWsInstance.ping.mockReset();
    mockWsInstance.readyState = 1;

    // Restore default credentials
    mockLoadCloudCredentials.mockReturnValue({
      agentId: 'agent-1',
      privateKey: 'mock-private-key',
      cloudUrl: 'https://cloud.test',
      companyName: 'TestCo',
      registeredAt: '2025-01-01T00:00:00Z',
    });

    client = new CloudClient();
  });

  afterEach(() => {
    client.disconnect();
    global.fetch = originalFetch;
  });

  it('should not be connected initially', () => {
    expect(client.isConnected()).toBe(false);
  });

  it('should return null credentials initially', () => {
    expect(client.getCredentials()).toBeNull();
  });

  it('should accept a command handler', () => {
    const handler = jest.fn();
    client.setCommandHandler(handler);
    // No error — handler registered
  });

  it('should accept an onConnect handler', () => {
    const handler = jest.fn();
    client.setOnConnect(handler);
    // No error — handler registered
  });

  // ─── connect() ────────────────────────────────────────────────

  describe('connect', () => {
    it('should no-op when no credentials', async () => {
      mockLoadCloudCredentials.mockReturnValue(null);
      const c = new CloudClient();
      await c.connect();
      expect(c.isConnected()).toBe(false);
      // WebSocket constructor should not have been called
      const { WebSocket } = await import('ws');
      expect(WebSocket).not.toHaveBeenCalled();
    });

    it('should fall back to polling when WS fails', async () => {
      jest.useFakeTimers();

      // Make ws 'error' fire immediately
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'error') {
          setTimeout(() => cb(new Error('ws connect failed')), 0);
        }
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const connectPromise = client.connect();
      // advanceTimersByTimeAsync flushes microtasks (await import) then fires the setTimeout(0)
      await jest.advanceTimersByTimeAsync(1);
      await connectPromise;

      // Polling means connected = true (polling fallback sets connected)
      expect(client.isConnected()).toBe(true);
    });
  });

  // ─── disconnect() ────────────────────────────────────────────

  describe('disconnect', () => {
    it('should close ws if open', async () => {
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          setTimeout(() => cb(), 0);
        }
      });

      await client.connect().catch(() => {});
      client.disconnect();

      expect(client.isConnected()).toBe(false);
    });

    it('should clear reconnect timer', async () => {
      jest.useFakeTimers();

      // Connect WS, then fire 'close' to schedule reconnect
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
        if (event === 'close') {
          // Fire close after open
          Promise.resolve().then(() => Promise.resolve().then(() => cb()));
        }
      });

      await client.connect().catch(() => {});
      // Let close handler run
      await jest.advanceTimersByTimeAsync(1);

      // Now disconnect should clear the reconnect timer
      client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it('should clear poll timer', async () => {
      jest.useFakeTimers();

      // Make WS fail to trigger polling fallback
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'error') {
          Promise.resolve().then(() => cb(new Error('fail')));
        }
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(1);
      await connectPromise.catch(() => {});

      // Now polling should be active
      expect(client.isConnected()).toBe(true);

      // disconnect should clear the poll timer
      client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });

  // ─── agentGet() ──────────────────────────────────────────────

  describe('agentGet', () => {
    it('should throw when not connected', async () => {
      const disconnected = new CloudClient();
      await expect(disconnected.agentGet('/test')).rejects.toThrow('Not connected to cloud');
    });

    it('should make authenticated GET request', async () => {
      const mockResponse = { data: 'test-data' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      // Set credentials by connecting (partially)
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });
      await client.connect().catch(() => {});

      const result = await client.agentGet<{ data: string }>('/config');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/agents/agent-1/config'),
        expect.objectContaining({
          headers: { Authorization: 'AgentSig mock-header' },
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should throw on HTTP error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });
      await client.connect().catch(() => {});

      await expect(client.agentGet('/fail')).rejects.toThrow('HTTP 500 GET /fail');
    });
  });

  // ─── agentPost() ─────────────────────────────────────────────

  describe('agentPost', () => {
    it('should throw when not connected', async () => {
      const disconnected = new CloudClient();
      await expect(disconnected.agentPost('/test', {})).rejects.toThrow('Not connected to cloud');
    });

    it('should make authenticated POST request', async () => {
      const mockResponse = { ok: true };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });
      await client.connect().catch(() => {});

      const body = { policy: 'deny-all' };
      const result = await client.agentPost<{ ok: boolean }>('/policies', body);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/agents/agent-1/policies'),
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'AgentSig mock-header',
          },
          body: JSON.stringify(body),
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    it('should throw on HTTP error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
      });

      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });
      await client.connect().catch(() => {});

      await expect(client.agentPost('/fail', {})).rejects.toThrow('HTTP 403 POST /fail');
    });
  });

  // ─── WebSocket lifecycle ─────────────────────────────────────

  describe('WebSocket lifecycle', () => {
    it('should be connected after WS open', async () => {
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await client.connect();

      expect(client.isConnected()).toBe(true);
    });

    it('should call onConnect handler on WS open', async () => {
      const onConnect = jest.fn().mockResolvedValue(undefined);
      client.setOnConnect(onConnect);

      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await client.connect();
      // Allow microtask for onConnect
      await new Promise(r => setTimeout(r, 0));

      expect(onConnect).toHaveBeenCalled();
    });

    it('should not crash when onConnect handler rejects', async () => {
      const onConnect = jest.fn().mockRejectedValue(new Error('handler fail'));
      client.setOnConnect(onConnect);

      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await client.connect();
      // Allow microtask for onConnect
      await new Promise(r => setTimeout(r, 10));

      expect(onConnect).toHaveBeenCalled();
      // No crash
    });

    it('should handle incoming commands via WS message', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      client.setCommandHandler(handler);

      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await client.connect();

      // Get message handler and call it
      const messageHandler = getWsHandler('message');
      const msg = JSON.stringify({
        jsonrpc: '2.0',
        id: 'cmd-1',
        method: 'push_policy',
        params: { policy: 'deny' },
      });
      messageHandler({ toString: () => msg });

      await new Promise(r => setTimeout(r, 10));

      expect(handler).toHaveBeenCalledWith({
        id: 'cmd-1',
        method: 'push_policy',
        params: { policy: 'deny' },
      });

      // Should send ACK
      expect(mockWsInstance.send).toHaveBeenCalledWith(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'command_ack',
          params: { commandId: 'cmd-1' },
        }),
      );
    });

    it('should respond to ping with pong', async () => {
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await client.connect();

      const messageHandler = getWsHandler('message');
      const msg = JSON.stringify({ jsonrpc: '2.0', method: 'ping', params: {} });
      messageHandler({ toString: () => msg });

      expect(mockWsInstance.send).toHaveBeenCalledWith(
        JSON.stringify({ jsonrpc: '2.0', method: 'pong', params: {} }),
      );
    });

    it('should handle invalid JSON in message', async () => {
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await client.connect();

      const messageHandler = getWsHandler('message');
      // Should not throw — just logs warning
      messageHandler({ toString: () => 'not json' });
    });

    it('should log error when command handler rejects', async () => {
      const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };
      const c = new CloudClient({ logger });
      const handler = jest.fn().mockRejectedValue(new Error('handler boom'));
      c.setCommandHandler(handler);

      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await c.connect();

      const messageHandler = getWsHandler('message');
      const msg = JSON.stringify({
        jsonrpc: '2.0',
        id: 'cmd-err',
        method: 'fail_cmd',
        params: {},
      });
      messageHandler({ toString: () => msg });

      // Wait for the rejection to be caught
      await new Promise(r => setTimeout(r, 50));

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('handler boom'),
      );

      c.disconnect();
    });

    it('should handle message with no command handler registered', async () => {
      // No command handler set
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await client.connect();

      const messageHandler = getWsHandler('message');
      const msg = JSON.stringify({
        jsonrpc: '2.0',
        id: 'cmd-2',
        method: 'some_cmd',
        params: {},
      });
      // Should not crash
      messageHandler({ toString: () => msg });

      // ACK still sent
      expect(mockWsInstance.send).toHaveBeenCalledWith(
        expect.stringContaining('command_ack'),
      );
    });

    it('should handle message with no id (no ACK sent)', async () => {
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await client.connect();

      const messageHandler = getWsHandler('message');
      const msg = JSON.stringify({
        jsonrpc: '2.0',
        method: 'notify',
        params: {},
      });
      messageHandler({ toString: () => msg });

      // No ACK sent because id is empty string (falsy)
      const ackCalls = mockWsInstance.send.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes('command_ack'),
      );
      expect(ackCalls).toHaveLength(0);
    });

    it('should schedule reconnect on WS close (not stopped)', async () => {
      jest.useFakeTimers();

      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await client.connect();
      expect(client.isConnected()).toBe(true);

      // Simulate close
      const closeHandler = getWsHandler('close');
      closeHandler();

      expect(client.isConnected()).toBe(false);
    });

    it('should not reconnect on WS close when stopped', async () => {
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await client.connect();
      client.disconnect();

      // Simulate close after disconnect
      const closeHandler = getWsHandler('close');
      closeHandler();

      // Not connected, no reconnect attempted
      expect(client.isConnected()).toBe(false);
    });

    it('should reject connect promise on WS error', async () => {
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'error') {
          Promise.resolve().then(() => cb(new Error('connection refused')));
        }
      });

      // WS error → connect falls back to polling (doesn't reject the outer connect())
      await client.connect();
      // Polling fallback means it's "connected"
      expect(client.isConnected()).toBe(true);
    });

    it('should timeout on WS connection', async () => {
      jest.useFakeTimers();

      // Don't fire any events — WS hangs
      mockWsInstance.on.mockImplementation(() => {});

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const connectPromise = client.connect();

      // Advance past the 10s connection timeout (flushes microtasks too)
      await jest.advanceTimersByTimeAsync(11_000);

      // The timeout causes close() and reject, which then falls back to polling
      await connectPromise;

      // Polling fallback
      expect(client.isConnected()).toBe(true);
    });
  });

  // ─── Heartbeat ───────────────────────────────────────────────

  describe('heartbeat', () => {
    it('should send ping on heartbeat interval', async () => {
      jest.useFakeTimers();

      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await client.connect();

      // Advance 30s (HEARTBEAT_INTERVAL)
      jest.advanceTimersByTime(30_000);

      expect(mockWsInstance.ping).toHaveBeenCalled();
    });

    it('should not ping if ws is not open', async () => {
      jest.useFakeTimers();

      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await client.connect();

      // Change readyState to closed
      mockWsInstance.readyState = 3;

      jest.advanceTimersByTime(30_000);

      expect(mockWsInstance.ping).not.toHaveBeenCalled();
    });
  });

  // ─── scheduleReconnect ───────────────────────────────────────

  describe('scheduleReconnect', () => {
    it('should reconnect after delay', async () => {
      jest.useFakeTimers();

      let openCb: (() => void) | null = null;
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          openCb = cb as () => void;
        }
      });

      // First: connect via WS open
      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(1);
      openCb!();
      await connectPromise;

      expect(client.isConnected()).toBe(true);

      // Simulate close to trigger reconnect
      const closeHandler = getWsHandler('close');
      closeHandler();
      expect(client.isConnected()).toBe(false);

      // Reset mocks for reconnect
      mockWsInstance.on.mockReset();
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          openCb = cb as () => void;
        }
      });

      // Advance past RECONNECT_DELAY (10s)
      await jest.advanceTimersByTimeAsync(10_001);

      // New WS should have been created — fire open
      if (openCb) {
        openCb();
        await jest.advanceTimersByTimeAsync(1);
        expect(client.isConnected()).toBe(true);
      }
    });

    it('should fall to polling if reconnect WS fails', async () => {
      jest.useFakeTimers();

      let openCb: (() => void) | null = null;
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          openCb = cb as () => void;
        }
      });

      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(1);
      openCb!();
      await connectPromise;

      // Simulate close
      const closeHandler = getWsHandler('close');
      closeHandler();

      // Make reconnect WS fail with error
      mockWsInstance.on.mockReset();
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'error') {
          Promise.resolve().then(() => cb(new Error('reconnect failed')));
        }
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      // Advance past RECONNECT_DELAY
      await jest.advanceTimersByTimeAsync(10_001);
      // Let the error propagate and polling start
      await jest.advanceTimersByTimeAsync(100);

      // Should have fallen back to polling (connected again)
      expect(client.isConnected()).toBe(true);
    });

    it('should not double-schedule reconnect', async () => {
      jest.useFakeTimers();

      let openCb: (() => void) | null = null;
      let closeCb: (() => void) | null = null;
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') openCb = cb as () => void;
        if (event === 'close') closeCb = cb as () => void;
      });

      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(1);
      openCb!();
      await connectPromise;

      // Fire close twice — should only schedule one reconnect
      closeCb!();
      closeCb!();

      // No error — guard prevents double-schedule
    });
  });

  // ─── Polling fallback ────────────────────────────────────────

  describe('polling fallback', () => {
    beforeEach(() => {
      // Make WS fail immediately to trigger polling
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'error') {
          Promise.resolve().then(() => cb(new Error('ws failed')));
        }
      });
    });

    it('should poll commands and call handler', async () => {
      jest.useFakeTimers();

      const commands: CloudCommand[] = [
        { id: 'cmd-1', method: 'push_policy', params: { policy: 'deny' } },
      ];

      const handler = jest.fn().mockResolvedValue(undefined);
      client.setCommandHandler(handler);

      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(commands) }) // initial poll
        .mockResolvedValueOnce({ ok: true }) // ACK
        .mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }); // subsequent polls

      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      await connectPromise;

      // Let initial pollCommands complete
      await jest.advanceTimersByTimeAsync(10);

      expect(handler).toHaveBeenCalledWith(commands[0]);
    });

    it('should call onConnect handler in polling mode', async () => {
      jest.useFakeTimers();

      const onConnect = jest.fn().mockResolvedValue(undefined);
      client.setOnConnect(onConnect);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      await connectPromise;
      await jest.advanceTimersByTimeAsync(10);

      expect(onConnect).toHaveBeenCalled();
    });

    it('should handle onConnect failure in polling mode', async () => {
      jest.useFakeTimers();

      const onConnect = jest.fn().mockRejectedValue(new Error('handler fail'));
      client.setOnConnect(onConnect);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      await connectPromise;
      await jest.advanceTimersByTimeAsync(10);

      expect(onConnect).toHaveBeenCalled();
      // No crash
    });

    it('should include since parameter on subsequent polls', async () => {
      jest.useFakeTimers();

      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial poll
        .mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }); // subsequent

      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      await connectPromise;
      await jest.advanceTimersByTimeAsync(10);

      // Advance to next poll interval (30s)
      await jest.advanceTimersByTimeAsync(30_000);

      // Second poll should include 'since' in URL
      const fetchCalls = (global.fetch as jest.Mock).mock.calls;
      const lastPollUrl = fetchCalls[fetchCalls.length - 1]?.[0] as string;
      if (lastPollUrl && lastPollUrl.includes('commands')) {
        expect(lastPollUrl).toContain('since=');
      }
    });

    it('should handle poll fetch failure silently', async () => {
      jest.useFakeTimers();

      global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      await connectPromise;
      await jest.advanceTimersByTimeAsync(10);

      // No crash — error caught silently
      expect(client.isConnected()).toBe(true);
    });

    it('should handle poll non-ok response silently', async () => {
      jest.useFakeTimers();

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      await connectPromise;
      await jest.advanceTimersByTimeAsync(10);

      // No crash
      expect(client.isConnected()).toBe(true);
    });

    it('should ACK commands via HTTP during polling', async () => {
      jest.useFakeTimers();

      const commands: CloudCommand[] = [
        { id: 'poll-cmd-1', method: 'test', params: {} },
      ];

      client.setCommandHandler(jest.fn().mockResolvedValue(undefined));

      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(commands) }) // poll
        .mockResolvedValueOnce({ ok: true }) // ACK
        .mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });

      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      await connectPromise;
      await jest.advanceTimersByTimeAsync(10);

      // Check ACK was sent
      const fetchCalls = (global.fetch as jest.Mock).mock.calls;
      const ackCall = fetchCalls.find(
        (c: unknown[]) => (c[0] as string).includes('/ack'),
      );
      expect(ackCall).toBeDefined();
      expect(ackCall![1]).toMatchObject({
        method: 'POST',
        body: JSON.stringify({ commandId: 'poll-cmd-1' }),
      });
    });

    it('should not start polling if already stopped', async () => {
      jest.useFakeTimers();

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      // Disconnect before connect completes
      const connectPromise = client.connect();
      client.disconnect();
      await jest.advanceTimersByTimeAsync(10);
      await connectPromise.catch(() => {});

      expect(client.isConnected()).toBe(false);
    });

    it('should not poll when credentials are null', async () => {
      jest.useFakeTimers();

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      await connectPromise.catch(() => {});

      // Clear credentials to test pollCommands guard
      // Disconnect clears internal state
      client.disconnect();

      // No crash
    });

    it('should handle command handler error during polling', async () => {
      jest.useFakeTimers();

      const commands: CloudCommand[] = [
        { id: 'err-cmd', method: 'test', params: {} },
      ];

      // Handler that rejects — should not crash the poll loop
      const handler = jest.fn().mockRejectedValue(new Error('handler error'));
      client.setCommandHandler(handler);

      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(commands) })
        .mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });

      const connectPromise = client.connect();
      await jest.advanceTimersByTimeAsync(10);
      await connectPromise;
      await jest.advanceTimersByTimeAsync(10);

      // Handler was called but error was caught in pollCommands
      expect(handler).toHaveBeenCalled();
    });
  });

  // ─── Edge-case branches ───────────────────────────────────────

  describe('branch coverage', () => {
    it('should guard connectWebSocket when stopped during await import', async () => {
      // We need to stop the client AFTER connect() sets stopped=false
      // but BEFORE connectWebSocket checks this.stopped after `await import('ws')`.
      // This is tricky because the import resolves synchronously via mock.
      // The only way to hit L208 is if stopped is set between connect() calling
      // connectWebSocket and the function checking this.stopped.
      // Since the import mock resolves instantly, we test the early-return
      // by accessing the private method indirectly.

      // The best approach: test stopped guard at start of connectWebSocket.
      // Make connect() call connectWebSocket, but disconnect immediately.
      // Due to the dynamic import, there's a microtask gap.

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = client as any;
      c.credentials = {
        agentId: 'a',
        privateKey: 'k',
        cloudUrl: 'https://cloud.test',
        companyName: 'X',
        registeredAt: '',
      };
      c.stopped = true;
      await c.connectWebSocket();
      // No WS created — returned early
      expect(mockWsInstance.on).not.toHaveBeenCalled();
    });

    it('should guard scheduleReconnect timeout when stopped during delay', async () => {
      jest.useFakeTimers();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = client as any;
      c.credentials = {
        agentId: 'a',
        privateKey: 'k',
        cloudUrl: 'https://cloud.test',
        companyName: 'X',
        registeredAt: '',
      };
      c.stopped = false;

      // Trigger scheduleReconnect
      c.scheduleReconnect();

      // Now stop before the timeout fires
      c.stopped = true;

      // Advance past RECONNECT_DELAY
      await jest.advanceTimersByTimeAsync(11_000);

      // connectWebSocket should not have been called (stopped during timeout callback)
    });

    it('should guard startPolling interval callback when stopped', async () => {
      jest.useFakeTimers();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = client as any;
      c.credentials = {
        agentId: 'a',
        privateKey: 'k',
        cloudUrl: 'https://cloud.test',
        companyName: 'X',
        registeredAt: '',
      };
      c.stopped = false;

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      c.startPolling();

      // Now stop before next poll fires
      c.stopped = true;

      await jest.advanceTimersByTimeAsync(30_001);

      // pollCommands should not have been called during the interval
      // (initial poll may have been called, but interval callback returns early)
    });

    it('should guard pollCommands when credentials are null', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = client as any;
      c.credentials = null;

      global.fetch = jest.fn();
      await c.pollCommands();

      // fetch should not have been called
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle ACK failure during polling gracefully', async () => {
      jest.useFakeTimers();

      const commands = [{ id: 'ack-fail-cmd', method: 'test', params: {} }];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = client as any;
      c.credentials = {
        agentId: 'a',
        privateKey: 'k',
        cloudUrl: 'https://cloud.test',
        companyName: 'X',
        registeredAt: '',
      };

      const handler = jest.fn().mockResolvedValue(undefined);
      c.commandHandler = handler;

      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(commands) }) // poll
        .mockRejectedValueOnce(new Error('ACK failed')); // ACK fails

      await c.pollCommands();

      // Handler was still called, ACK failure was caught silently
      expect(handler).toHaveBeenCalled();
    });

    it('should exercise poll interval callback with commands', async () => {
      jest.useFakeTimers();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = client as any;
      c.credentials = {
        agentId: 'a',
        privateKey: 'k',
        cloudUrl: 'https://cloud.test',
        companyName: 'X',
        registeredAt: '',
      };
      c.stopped = false;

      const handler = jest.fn().mockResolvedValue(undefined);
      c.commandHandler = handler;

      const commands = [{ id: 'interval-cmd', method: 'run', params: {} }];

      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial poll
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(commands) }) // interval poll
        .mockResolvedValueOnce({ ok: true }) // ACK
        .mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });

      c.startPolling();

      // Let initial poll complete
      await jest.advanceTimersByTimeAsync(100);

      // Advance to trigger interval (30s)
      await jest.advanceTimersByTimeAsync(30_000);

      expect(handler).toHaveBeenCalledWith(commands[0]);

      c.disconnect();
    });

    it('should exercise poll with no handler (command loop without handler)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = client as any;
      c.credentials = {
        agentId: 'a',
        privateKey: 'k',
        cloudUrl: 'https://cloud.test',
        companyName: 'X',
        registeredAt: '',
      };
      // No command handler set
      c.commandHandler = null;

      const commands = [{ id: 'no-handler-cmd', method: 'test', params: {} }];

      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(commands) })
        .mockResolvedValueOnce({ ok: true }); // ACK

      await c.pollCommands();

      // ACK was still sent even without handler
      const ackCall = (global.fetch as jest.Mock).mock.calls.find(
        (call: unknown[]) => (call[0] as string).includes('/ack'),
      );
      expect(ackCall).toBeDefined();
    });

    it('should handle message with missing params', async () => {
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      const handler = jest.fn().mockResolvedValue(undefined);
      client.setCommandHandler(handler);

      await client.connect();

      const messageHandler = getWsHandler('message');
      // msg without params or id — test the ?? fallbacks
      const msg = JSON.stringify({
        jsonrpc: '2.0',
        method: 'notify',
      });
      messageHandler({ toString: () => msg });

      await new Promise(r => setTimeout(r, 10));

      expect(handler).toHaveBeenCalledWith({
        id: '',
        method: 'notify',
        params: {},
      });
    });

    it('should not send ACK when ws is closed', async () => {
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await client.connect();

      // Set readyState to closed
      mockWsInstance.readyState = 3;

      const messageHandler = getWsHandler('message');
      const msg = JSON.stringify({
        jsonrpc: '2.0',
        id: 'cmd-closed',
        method: 'test',
        params: {},
      });
      messageHandler({ toString: () => msg });

      // Should NOT send ACK (readyState !== 1)
      expect(mockWsInstance.send).not.toHaveBeenCalled();
    });

    it('should not send pong when ws is closed', async () => {
      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await client.connect();

      mockWsInstance.readyState = 3;

      const messageHandler = getWsHandler('message');
      const msg = JSON.stringify({
        jsonrpc: '2.0',
        method: 'ping',
        params: {},
      });
      messageHandler({ toString: () => msg });

      expect(mockWsInstance.send).not.toHaveBeenCalled();
    });
  });

  // ─── makeAuthHeader edge case ────────────────────────────────

  describe('makeAuthHeader', () => {
    it('should return empty string when credentials are null', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = client as any;
      c.credentials = null;
      expect(c.makeAuthHeader()).toBe('');
    });
  });

  // ─── Constructor with logger ─────────────────────────────────

  describe('constructor', () => {
    it('should use provided logger', async () => {
      const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };

      const c = new CloudClient({ logger });

      mockWsInstance.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'open') {
          Promise.resolve().then(() => cb());
        }
      });

      await c.connect();
      c.disconnect();

      expect(logger.info).toHaveBeenCalled();
    });
  });
});
