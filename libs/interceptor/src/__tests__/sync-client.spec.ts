/* eslint-disable @typescript-eslint/no-explicit-any */

// The SyncClient captures fs/cp functions at module load via `.bind()`.
// We must provide real function stubs that support .bind().

const _mockExistsSync = jest.fn();
const _mockReadFileSync = jest.fn();
const _mockUnlinkSync = jest.fn();
const _mockReaddirSync = jest.fn();
const _mockStatSync = jest.fn();
const _mockSpawnSync = jest.fn();
const _mockExecSync = jest.fn();

jest.mock('node:fs', () => {
  // Return an object whose methods are real functions (support .bind)
  return {
    existsSync: (...args: any[]) => _mockExistsSync(...args),
    readFileSync: (...args: any[]) => _mockReadFileSync(...args),
    unlinkSync: (...args: any[]) => _mockUnlinkSync(...args),
    readdirSync: (...args: any[]) => _mockReaddirSync(...args),
    statSync: (...args: any[]) => _mockStatSync(...args),
    appendFileSync: (...args: any[]) => {},
    writeSync: (...args: any[]) => {},
  };
});

jest.mock('node:child_process', () => ({
  execSync: (...args: any[]) => _mockExecSync(...args),
  spawnSync: (...args: any[]) => _mockSpawnSync(...args),
}));

jest.mock('../debug-log', () => ({
  debugLog: jest.fn(),
}));

import { SyncClient } from '../client/sync-client';

// Re-export for convenience
const mockExistsSync = _mockExistsSync;
const mockReadFileSync = _mockReadFileSync;
const mockUnlinkSync = _mockUnlinkSync;
const mockReaddirSync = _mockReaddirSync;
const mockStatSync = _mockStatSync;
const mockSpawnSync = _mockSpawnSync;
const mockExecSync = _mockExecSync;

describe('SyncClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env['AGENSHIELD_PROFILE_ID'];
    delete process.env['AGENSHIELD_BROKER_TOKEN'];
    // Constructor calls cleanupStaleTmpFiles, so mock readdirSync by default
    mockReaddirSync.mockReturnValue([]);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function createClient() {
    return new SyncClient({
      socketPath: '/tmp/test.sock',
      httpHost: 'localhost',
      httpPort: 5201,
      timeout: 5000,
    });
  }

  describe('constructor', () => {
    it('calls cleanupStaleTmpFiles', () => {
      mockReaddirSync.mockReturnValue([
        'agenshield-sync-old.json',
        'other-file.txt',
        'agenshield-sync-new.json',
      ]);
      const cutoff = Date.now() - 5 * 60 * 1000;
      mockStatSync
        .mockReturnValueOnce({ mtimeMs: cutoff - 1000 }) // old → delete
        .mockReturnValueOnce({ mtimeMs: Date.now() }); // new → keep

      createClient();

      expect(mockUnlinkSync).toHaveBeenCalledWith('/tmp/agenshield-sync-old.json');
      expect(mockUnlinkSync).not.toHaveBeenCalledWith('/tmp/agenshield-sync-new.json');
    });

    it('reads profileId and brokerToken from env', () => {
      process.env['AGENSHIELD_PROFILE_ID'] = 'profile-abc';
      process.env['AGENSHIELD_BROKER_TOKEN'] = 'token-xyz';

      const client = createClient();
      // Access private fields via any
      expect((client as any).profileId).toBe('profile-abc');
      expect((client as any).brokerToken).toBe('token-xyz');
    });

    it('ignores cleanup errors', () => {
      mockReaddirSync.mockImplementation(() => { throw new Error('EACCES'); });
      // Should not throw
      expect(() => createClient()).not.toThrow();
    });

    it('ignores per-file stat errors during cleanup', () => {
      mockReaddirSync.mockReturnValue(['agenshield-sync-x.json']);
      mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });
      expect(() => createClient()).not.toThrow();
    });
  });

  describe('request - socket path', () => {
    it('returns result on successful socket response', () => {
      const client = createClient();

      mockSpawnSync.mockReturnValue({ status: 0, error: null, signal: null });
      mockExistsSync
        .mockReturnValueOnce(true) // tmpFile check after spawn
        .mockReturnValueOnce(false); // cleanup check
      mockReadFileSync.mockReturnValueOnce(JSON.stringify({
        result: { allowed: true, policyId: 'p1' },
      }));

      const result = client.request('policy_check', { target: 'ls' });
      expect(result).toEqual({ allowed: true, policyId: 'p1' });
    });

    it('resets socket fail count on success', () => {
      const client = createClient();

      // First: succeed
      mockSpawnSync.mockReturnValue({ status: 0 });
      mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);
      mockReadFileSync.mockReturnValueOnce(JSON.stringify({ result: 'ok' }));

      client.request('test', {});
      expect((client as any).socketFailCount).toBe(0);
    });

    it('throws when response has error field', () => {
      const client = createClient();

      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);
      mockReadFileSync.mockReturnValueOnce(JSON.stringify({ error: 'denied' }));

      // Socket fails, falls through to HTTP
      mockExecSync.mockReturnValue(JSON.stringify({ result: 'ok' }));

      const result = client.request('test', {});
      expect(result).toBe('ok');
    });

    it('throws when no response file exists', () => {
      const client = createClient();

      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExistsSync.mockReturnValue(false);

      // Socket fails → HTTP fallback
      mockExecSync.mockReturnValue(JSON.stringify({ result: 'http-ok' }));

      const result = client.request('test', {});
      expect(result).toBe('http-ok');
    });
  });

  describe('request - circuit breaker', () => {
    it('skips socket after 2 consecutive failures', () => {
      const client = createClient();

      // Fail socket twice
      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockReturnValue(JSON.stringify({ result: 'ok' }));

      client.request('test', {}); // fail 1
      client.request('test', {}); // fail 2 → circuit open

      // Third call should skip socket entirely
      jest.clearAllMocks();
      mockReaddirSync.mockReturnValue([]);
      mockExecSync.mockReturnValue(JSON.stringify({ result: 'http-only' }));

      const result = client.request('test', {});
      expect(result).toBe('http-only');
      // spawnSync should NOT be called (circuit is open)
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });
  });

  describe('request - HTTP fallback', () => {
    it('falls back to curl when socket fails', () => {
      const client = createClient();

      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockReturnValue(JSON.stringify({
        result: { allowed: true },
      }));

      const result = client.request('test', {});
      expect(result).toEqual({ allowed: true });
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('/usr/bin/curl'),
        expect.objectContaining({ timeout: 5000, encoding: 'utf-8' })
      );
    });

    it('throws when HTTP response has error field', () => {
      const client = createClient();

      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockReturnValue(JSON.stringify({
        error: { message: 'not found' },
      }));

      expect(() => client.request('test', {})).toThrow('Sync request failed');
    });

    it('throws when curl fails', () => {
      const client = createClient();

      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockImplementation(() => { throw new Error('curl timeout'); });

      expect(() => client.request('test', {})).toThrow('Sync request failed: curl timeout');
    });
  });

  describe('request - identity headers', () => {
    it('includes profileId and brokerToken in socket request params', () => {
      process.env['AGENSHIELD_PROFILE_ID'] = 'pid-123';
      process.env['AGENSHIELD_BROKER_TOKEN'] = 'tok-abc';
      const client = createClient();

      mockSpawnSync.mockReturnValue({ status: 0 });
      mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);
      mockReadFileSync.mockReturnValueOnce(JSON.stringify({ result: 'ok' }));

      client.request('test', {});

      // The spawn script contains the request with enriched params
      const spawnCall = mockSpawnSync.mock.calls[0];
      const script = spawnCall[1][1]; // ['-e', script]
      expect(script).toContain('__profileId');
      expect(script).toContain('__brokerToken');
    });

    it('includes identity headers in curl requests', () => {
      process.env['AGENSHIELD_BROKER_TOKEN'] = 'tok-abc';
      process.env['AGENSHIELD_PROFILE_ID'] = 'pid-123';
      const client = createClient();

      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockReturnValue(JSON.stringify({ result: 'ok' }));

      client.request('test', {});

      const curlCall = mockExecSync.mock.calls[0][0] as string;
      expect(curlCall).toContain('x-shield-broker-token: tok-abc');
      expect(curlCall).toContain('x-shield-profile-id: pid-123');
    });
  });

  describe('request - tmp file cleanup', () => {
    it('cleans up tmp file in finally block', () => {
      const client = createClient();

      mockSpawnSync.mockReturnValue({ status: 0 });
      mockExistsSync
        .mockReturnValueOnce(true) // main check
        .mockReturnValueOnce(true); // finally check
      mockReadFileSync.mockReturnValueOnce(JSON.stringify({ result: 'ok' }));

      client.request('test', {});

      // unlinkSync called at least once for the tmp file
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('ignores cleanup errors in finally block', () => {
      const client = createClient();

      mockSpawnSync.mockReturnValue({ status: 0 });
      mockExistsSync
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
      mockReadFileSync.mockReturnValueOnce(JSON.stringify({ result: 'ok' }));
      // Second unlinkSync (in finally) throws
      mockUnlinkSync
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => { throw new Error('EBUSY'); });

      expect(() => client.request('test', {})).not.toThrow();
    });
  });

  describe('ping', () => {
    it('returns true when request succeeds', () => {
      const client = createClient();

      mockSpawnSync.mockReturnValue({ status: 0 });
      mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);
      mockReadFileSync.mockReturnValueOnce(JSON.stringify({ result: {} }));

      expect(client.ping()).toBe(true);
    });

    it('returns false when request fails', () => {
      const client = createClient();

      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockImplementation(() => { throw new Error('fail'); });

      expect(client.ping()).toBe(false);
    });
  });
});
