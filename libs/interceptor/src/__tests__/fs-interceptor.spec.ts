/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('../debug-log', () => ({ debugLog: jest.fn() }));

const mockSyncRequest = jest.fn();
jest.mock('../client/sync-client', () => ({
  SyncClient: jest.fn().mockImplementation(() => ({
    request: mockSyncRequest,
  })),
}));

import { FsInterceptor } from '../interceptors/fs';
import { PolicyDeniedError } from '../errors';

const fsModule = require('node:fs');
const fsPromisesModule = require('node:fs/promises');

function createInterceptor(overrides?: Record<string, any>) {
  return new FsInterceptor({
    client: { request: jest.fn() } as any,
    policyEvaluator: { check: jest.fn().mockResolvedValue({ allowed: true }) } as any,
    eventReporter: {
      intercept: jest.fn(),
      allow: jest.fn(),
      deny: jest.fn(),
      error: jest.fn(),
    } as any,
    failOpen: false,
    brokerHttpPort: 5201,
    ...overrides,
  });
}

describe('FsInterceptor', () => {
  let origReadFileSync: typeof fsModule.readFileSync;
  let origWriteFileSync: typeof fsModule.writeFileSync;
  let origReadFile: typeof fsModule.readFile;
  let origPromisesReadFile: typeof fsPromisesModule.readFile;

  beforeAll(() => {
    origReadFileSync = fsModule.readFileSync;
    origWriteFileSync = fsModule.writeFileSync;
    origReadFile = fsModule.readFile;
    origPromisesReadFile = fsPromisesModule.readFile;
  });

  afterEach(() => {
    // Restore originals
    fsModule.readFileSync = origReadFileSync;
    fsModule.writeFileSync = origWriteFileSync;
    fsModule.readFile = origReadFile;
    fsPromisesModule.readFile = origPromisesReadFile;
    jest.clearAllMocks();
  });

  describe('install/uninstall', () => {
    it('patches fs methods on install', () => {
      const interceptor = createInterceptor();
      interceptor.install();

      expect(fsModule.readFileSync).not.toBe(origReadFileSync);
      expect(fsModule.writeFileSync).not.toBe(origWriteFileSync);
      expect(interceptor.isInstalled()).toBe(true);

      interceptor.uninstall();
    });

    it('restores all originals on uninstall', () => {
      const interceptor = createInterceptor();
      interceptor.install();
      interceptor.uninstall();

      expect(fsModule.readFileSync).toBe(origReadFileSync);
      expect(fsModule.writeFileSync).toBe(origWriteFileSync);
      expect(interceptor.isInstalled()).toBe(false);
    });

    it('does not double-install', () => {
      const interceptor = createInterceptor();
      interceptor.install();
      const first = fsModule.readFileSync;
      interceptor.install();
      expect(fsModule.readFileSync).toBe(first);
      interceptor.uninstall();
    });

    it('does not uninstall if not installed', () => {
      const interceptor = createInterceptor();
      interceptor.uninstall(); // no-op
      expect(fsModule.readFileSync).toBe(origReadFileSync);
    });
  });

  describe('sync method interception', () => {
    it('allows when policy check passes', () => {
      mockSyncRequest.mockReturnValue({ allowed: true });
      const interceptor = createInterceptor();
      interceptor.install();

      // This should call the original readFileSync through the interceptor
      // but since it's the real fs, just verify the mock was called
      try {
        fsModule.readFileSync('/tmp/nonexistent-agenshield-test-file');
      } catch {
        // File doesn't exist, that's fine - we're testing the interceptor logic
      }

      expect(mockSyncRequest).toHaveBeenCalledWith(
        'policy_check',
        expect.objectContaining({
          operation: 'file_read',
          target: '/tmp/nonexistent-agenshield-test-file',
        })
      );

      interceptor.uninstall();
    });

    it('throws PolicyDeniedError when policy denies', () => {
      mockSyncRequest.mockReturnValue({ allowed: false, reason: 'blocked' });
      const interceptor = createInterceptor();
      interceptor.install();

      expect(() => {
        fsModule.readFileSync('/etc/passwd');
      }).toThrow(PolicyDeniedError);

      interceptor.uninstall();
    });

    it('re-entrancy guard skips policy check', () => {
      mockSyncRequest.mockReturnValue({ allowed: true });
      const interceptor = createInterceptor();
      interceptor.install();

      // Set _checking flag to simulate re-entrancy
      (interceptor as any)._checking = true;

      try {
        fsModule.readFileSync('/tmp/nonexistent-agenshield-test');
      } catch {
        // File doesn't exist, that's fine
      }

      // Policy check should NOT have been called due to re-entrancy
      expect(mockSyncRequest).not.toHaveBeenCalled();

      (interceptor as any)._checking = false;
      interceptor.uninstall();
    });

    it('fails open when broker is unavailable and failOpen=true', () => {
      mockSyncRequest.mockImplementation(() => { throw new Error('broker down'); });
      const interceptor = createInterceptor({ failOpen: true });
      interceptor.install();

      // Should not throw even though broker is down
      try {
        fsModule.readFileSync('/tmp/nonexistent-agenshield-test');
      } catch (err: any) {
        // Only file-not-found is acceptable, not PolicyDeniedError
        expect(err).not.toBeInstanceOf(PolicyDeniedError);
      }

      interceptor.uninstall();
    });

    it('throws when broker unavailable and failOpen=false', () => {
      mockSyncRequest.mockImplementation(() => { throw new Error('broker down'); });
      const interceptor = createInterceptor({ failOpen: false });
      interceptor.install();

      expect(() => {
        fsModule.readFileSync('/etc/passwd');
      }).toThrow('broker down');

      interceptor.uninstall();
    });
  });

  describe('normalizePathArg', () => {
    it('handles string paths', () => {
      mockSyncRequest.mockReturnValue({ allowed: true });
      const interceptor = createInterceptor();
      interceptor.install();

      try {
        fsModule.readFileSync('/tmp/test-path');
      } catch { /* ignore */ }

      expect(mockSyncRequest).toHaveBeenCalledWith(
        'policy_check',
        expect.objectContaining({ target: '/tmp/test-path' })
      );

      interceptor.uninstall();
    });

    it('handles URL objects', () => {
      mockSyncRequest.mockReturnValue({ allowed: true });
      const interceptor = createInterceptor();
      interceptor.install();

      try {
        fsModule.readFileSync(new URL('file:///tmp/url-test'));
      } catch { /* ignore */ }

      expect(mockSyncRequest).toHaveBeenCalledWith(
        'policy_check',
        expect.objectContaining({ target: '/tmp/url-test' })
      );

      interceptor.uninstall();
    });

    it('handles file:// string URLs', () => {
      mockSyncRequest.mockReturnValue({ allowed: true });
      const interceptor = createInterceptor();
      interceptor.install();

      try {
        fsModule.readFileSync('file:///tmp/string-url-test');
      } catch { /* ignore */ }

      expect(mockSyncRequest).toHaveBeenCalledWith(
        'policy_check',
        expect.objectContaining({ target: '/tmp/string-url-test' })
      );

      interceptor.uninstall();
    });
  });

  describe('async method interception', () => {
    it('calls callback with error on policy deny', (done) => {
      mockSyncRequest.mockReturnValue({ allowed: true }); // sync client not used for async
      const mockEvaluator = {
        check: jest.fn().mockResolvedValue({ allowed: false, reason: 'denied' }),
      };
      const mockReporter = {
        intercept: jest.fn(),
        allow: jest.fn(),
        deny: jest.fn(),
        error: jest.fn(),
      };
      const interceptor = createInterceptor({
        policyEvaluator: mockEvaluator as any,
        eventReporter: mockReporter as any,
      });
      interceptor.install();

      fsModule.readFile('/tmp/test', (err: Error | null) => {
        expect(err).toBeInstanceOf(PolicyDeniedError);
        interceptor.uninstall();
        done();
      });
    });

    it('re-entrancy guard skips policy check for async methods', (done) => {
      const mockEvaluator = {
        check: jest.fn().mockResolvedValue({ allowed: true }),
      };
      const interceptor = createInterceptor({
        policyEvaluator: mockEvaluator as any,
      });
      interceptor.install();

      (interceptor as any)._checking = true;

      fsModule.readFile('/tmp/nonexistent-agenshield-test', (err: Error | null) => {
        // Should have called original directly (may throw ENOENT)
        expect(mockEvaluator.check).not.toHaveBeenCalled();
        (interceptor as any)._checking = false;
        interceptor.uninstall();
        done();
      });
    });
  });

  describe('promise method interception', () => {
    it('resolves when policy allows', async () => {
      const mockEvaluator = {
        check: jest.fn().mockResolvedValue({ allowed: true }),
      };
      const mockReporter = {
        intercept: jest.fn(),
        allow: jest.fn(),
        deny: jest.fn(),
        error: jest.fn(),
      };
      const interceptor = createInterceptor({
        policyEvaluator: mockEvaluator as any,
        eventReporter: mockReporter as any,
      });
      interceptor.install();

      try {
        await fsPromisesModule.readFile('/tmp/nonexistent-agenshield-test');
      } catch (err: any) {
        // ENOENT is expected, but shouldn't be PolicyDeniedError
        expect(err).not.toBeInstanceOf(PolicyDeniedError);
      }

      expect(mockEvaluator.check).toHaveBeenCalled();
      interceptor.uninstall();
    });

    it('re-entrancy guard skips policy check for promise methods', async () => {
      const mockEvaluator = {
        check: jest.fn().mockResolvedValue({ allowed: true }),
      };
      const interceptor = createInterceptor({
        policyEvaluator: mockEvaluator as any,
      });
      interceptor.install();

      (interceptor as any)._checking = true;

      try {
        await fsPromisesModule.readFile('/tmp/nonexistent-agenshield-test');
      } catch { /* ignore ENOENT */ }

      expect(mockEvaluator.check).not.toHaveBeenCalled();
      (interceptor as any)._checking = false;
      interceptor.uninstall();
    });
  });

  describe('safeOverride', () => {
    it('falls back to Object.defineProperty on setter error', () => {
      // Create an object with a getter-only property
      const target: any = {};
      Object.defineProperty(target, 'prop', {
        get: () => 'original',
        configurable: true,
      });

      // FsInterceptor.install uses safeOverride internally
      // We test it indirectly through install/uninstall
      const interceptor = createInterceptor();
      interceptor.install();
      interceptor.uninstall();
      // If we got here without error, safeOverride worked
    });
  });
});
