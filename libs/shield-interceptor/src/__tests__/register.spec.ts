/**
 * Tests for interceptor registration and installation flow.
 *
 * Covers: installer.ts (installInterceptors, uninstallInterceptors, error handling),
 * ChildProcessInterceptor (install, uninstall, re-entrancy, policy checks),
 * FetchInterceptor (install, uninstall, broker skip, policy checks).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock debug-log before any imports
jest.mock('../debug-log', () => ({
  debugLog: jest.fn(),
}));

// ── Mock the heavy dependencies so we don't need a real broker/socket ────────

const mockAsyncRequest = jest.fn();
jest.mock('../client/http-client', () => ({
  AsyncClient: jest.fn().mockImplementation(() => ({
    request: mockAsyncRequest,
  })),
}));

const mockSyncRequest = jest.fn();
jest.mock('../client/sync-client', () => ({
  SyncClient: jest.fn().mockImplementation(() => ({
    request: mockSyncRequest,
  })),
}));

// Capture install/uninstall calls on each interceptor class
const mockFetchInstall = jest.fn();
const mockFetchUninstall = jest.fn();
jest.mock('../interceptors/fetch', () => ({
  FetchInterceptor: jest.fn().mockImplementation(() => ({
    install: mockFetchInstall,
    uninstall: mockFetchUninstall,
  })),
}));

const mockHttpInstall = jest.fn();
const mockHttpUninstall = jest.fn();
jest.mock('../interceptors/http', () => ({
  HttpInterceptor: jest.fn().mockImplementation(() => ({
    install: mockHttpInstall,
    uninstall: mockHttpUninstall,
  })),
}));

const mockWsInstall = jest.fn();
const mockWsUninstall = jest.fn();
jest.mock('../interceptors/websocket', () => ({
  WebSocketInterceptor: jest.fn().mockImplementation(() => ({
    install: mockWsInstall,
    uninstall: mockWsUninstall,
  })),
}));

const mockCpInstall = jest.fn();
const mockCpUninstall = jest.fn();
jest.mock('../interceptors/child-process', () => ({
  ChildProcessInterceptor: jest.fn().mockImplementation(() => ({
    install: mockCpInstall,
    uninstall: mockCpUninstall,
  })),
}));

const mockFsInstall = jest.fn();
const mockFsUninstall = jest.fn();
jest.mock('../interceptors/fs', () => ({
  FsInterceptor: jest.fn().mockImplementation(() => ({
    install: mockFsInstall,
    uninstall: mockFsUninstall,
  })),
}));

jest.mock('../events/reporter', () => ({
  EventReporter: jest.fn().mockImplementation(() => ({
    intercept: jest.fn(),
    allow: jest.fn(),
    deny: jest.fn(),
    error: jest.fn(),
    report: jest.fn(),
    flush: jest.fn(),
    stop: jest.fn(),
  })),
}));

jest.mock('../policy/evaluator', () => ({
  PolicyEvaluator: jest.fn().mockImplementation(() => ({
    check: jest.fn(),
  })),
}));

import { installInterceptors, uninstallInterceptors, isInstalled } from '../installer';
import { FetchInterceptor } from '../interceptors/fetch';
import { HttpInterceptor } from '../interceptors/http';
import { WebSocketInterceptor } from '../interceptors/websocket';
import { ChildProcessInterceptor } from '../interceptors/child-process';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('installInterceptors', () => {
  beforeEach(() => {
    // Reset module state between tests
    if (isInstalled()) {
      uninstallInterceptors();
    }
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (isInstalled()) {
      uninstallInterceptors();
    }
  });

  it('installs all interceptors when config enables them', () => {
    installInterceptors({
      interceptFetch: true,
      interceptHttp: true,
      interceptWs: true,
      interceptExec: true,
      interceptFs: true,
      logLevel: 'error', // suppress log output
    });

    expect(isInstalled()).toBe(true);
    expect(mockFetchInstall).toHaveBeenCalledTimes(1);
    expect(mockHttpInstall).toHaveBeenCalledTimes(1);
    expect(mockWsInstall).toHaveBeenCalledTimes(1);
    expect(mockCpInstall).toHaveBeenCalledTimes(1);
    expect(mockFsInstall).toHaveBeenCalledTimes(1);
  });

  it('skips interceptors when config disables them', () => {
    installInterceptors({
      interceptFetch: false,
      interceptHttp: false,
      interceptWs: false,
      interceptExec: false,
      interceptFs: false,
      logLevel: 'error',
    });

    expect(isInstalled()).toBe(true);
    expect(mockFetchInstall).not.toHaveBeenCalled();
    expect(mockHttpInstall).not.toHaveBeenCalled();
    expect(mockWsInstall).not.toHaveBeenCalled();
    expect(mockCpInstall).not.toHaveBeenCalled();
    expect(mockFsInstall).not.toHaveBeenCalled();
  });

  it('sets installed flag to prevent double installation', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    installInterceptors({ logLevel: 'error' });
    installInterceptors({ logLevel: 'error' }); // second call

    expect(consoleSpy).toHaveBeenCalledWith('AgenShield interceptors already installed');
    // Interceptors should only be created once
    expect(FetchInterceptor).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });

  it('cleans up on installation failure', () => {
    // Make one interceptor constructor throw
    (ChildProcessInterceptor as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Simulated constructor failure');
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    expect(() =>
      installInterceptors({
        interceptFetch: true,
        interceptExec: true, // will throw
        logLevel: 'error',
      })
    ).toThrow('Simulated constructor failure');

    // State should be cleaned up
    expect(isInstalled()).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[AgenShield] Failed to install interceptors:',
      'Simulated constructor failure'
    );

    consoleSpy.mockRestore();
  });

  it('can reinstall after failure cleanup', () => {
    // First: fail
    (ChildProcessInterceptor as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Simulated failure');
    });
    jest.spyOn(console, 'error').mockImplementation();

    expect(() =>
      installInterceptors({ interceptExec: true, logLevel: 'error' })
    ).toThrow();

    expect(isInstalled()).toBe(false);

    // Restore mock to normal behavior
    (ChildProcessInterceptor as jest.Mock).mockImplementation(() => ({
      install: mockCpInstall,
      uninstall: mockCpUninstall,
    }));

    // Second: succeed
    installInterceptors({ interceptExec: true, logLevel: 'error' });
    expect(isInstalled()).toBe(true);
    expect(mockCpInstall).toHaveBeenCalled();

    jest.restoreAllMocks();
  });

  it('logs success message on successful install', () => {
    const consoleSpy = jest.spyOn(console, 'info').mockImplementation();

    installInterceptors({ logLevel: 'info' });

    expect(consoleSpy).toHaveBeenCalledWith('[AgenShield] AgenShield interceptors installed');

    consoleSpy.mockRestore();
  });

  it('passes config to interceptor constructors', () => {
    installInterceptors({
      interceptFetch: true,
      interceptHttp: false,
      interceptWs: false,
      interceptExec: false,
      interceptFs: false,
      failOpen: true,
      httpPort: 9999,
      logLevel: 'error',
    });

    // FetchInterceptor should have been constructed with correct options
    expect(FetchInterceptor).toHaveBeenCalledWith(
      expect.objectContaining({
        failOpen: true,
        brokerHttpPort: 9999,
      })
    );
  });
});

describe('uninstallInterceptors', () => {
  beforeEach(() => {
    if (isInstalled()) {
      uninstallInterceptors();
    }
    jest.clearAllMocks();
  });

  it('calls uninstall on all installed interceptors', () => {
    installInterceptors({
      interceptFetch: true,
      interceptHttp: true,
      interceptWs: true,
      interceptExec: true,
      logLevel: 'error',
    });

    uninstallInterceptors();

    expect(isInstalled()).toBe(false);
    expect(mockFetchUninstall).toHaveBeenCalledTimes(1);
    expect(mockHttpUninstall).toHaveBeenCalledTimes(1);
    expect(mockWsUninstall).toHaveBeenCalledTimes(1);
    expect(mockCpUninstall).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when not installed', () => {
    // Should not throw
    uninstallInterceptors();
    expect(isInstalled()).toBe(false);
  });
});

// ── ChildProcessInterceptor (real, not mocked) ──────────────────────────────

describe('ChildProcessInterceptor (integration)', () => {
  // For these tests, we use the REAL ChildProcessInterceptor to verify
  // monkey-patching behavior. We unmock it for this describe block.

  // We test with a separate import to get the real implementation
  let RealChildProcessInterceptor: typeof import('../interceptors/child-process').ChildProcessInterceptor;
  let cpModule: typeof import('node:child_process');

  beforeAll(async () => {
    // We need to require the real modules — jest.requireActual works for this
    const realCp = jest.requireActual('../interceptors/child-process') as typeof import('../interceptors/child-process');
    RealChildProcessInterceptor = realCp.ChildProcessInterceptor;
    cpModule = jest.requireActual('node:child_process') as typeof import('node:child_process');
  });

  it('patches all 6 child_process methods on install', () => {
    const origExec = cpModule.exec;
    const origExecSync = cpModule.execSync;
    const origSpawn = cpModule.spawn;
    const origSpawnSync = cpModule.spawnSync;
    const origExecFile = cpModule.execFile;
    const origFork = cpModule.fork;

    const mockReporter = {
      intercept: jest.fn(),
      allow: jest.fn(),
      deny: jest.fn(),
      error: jest.fn(),
      report: jest.fn(),
      flush: jest.fn(),
      stop: jest.fn(),
    };

    const interceptor = new RealChildProcessInterceptor({
      client: { request: jest.fn() } as any,
      policyEvaluator: { check: jest.fn() } as any,
      eventReporter: mockReporter as any,
      failOpen: true,
      brokerHttpPort: 5201,
      config: {
        socketPath: '/tmp/test.sock',
        httpHost: 'localhost',
        httpPort: 5201,
        failOpen: true,
        logLevel: 'error',
        interceptFetch: false,
        interceptHttp: false,
        interceptWs: false,
        interceptFs: false,
        interceptExec: true,
        timeout: 5000,
        contextType: 'agent' as const,
        enableSeatbelt: false,
        seatbeltProfileDir: '/tmp/test-profiles',
      },
    });

    interceptor.install();

    // After install, the module methods should be different
    expect(cpModule.exec).not.toBe(origExec);
    expect(cpModule.execSync).not.toBe(origExecSync);
    expect(cpModule.spawn).not.toBe(origSpawn);
    expect(cpModule.spawnSync).not.toBe(origSpawnSync);
    expect(cpModule.execFile).not.toBe(origExecFile);
    expect(cpModule.fork).not.toBe(origFork);

    // Uninstall should restore
    interceptor.uninstall();

    expect(cpModule.exec).toBe(origExec);
    expect(cpModule.execSync).toBe(origExecSync);
    expect(cpModule.spawn).toBe(origSpawn);
    expect(cpModule.spawnSync).toBe(origSpawnSync);
    expect(cpModule.execFile).toBe(origExecFile);
    expect(cpModule.fork).toBe(origFork);
  });

  it('restores originals on uninstall', () => {
    const origExec = cpModule.exec;

    const interceptor = new RealChildProcessInterceptor({
      client: { request: jest.fn() } as any,
      policyEvaluator: { check: jest.fn() } as any,
      eventReporter: { intercept: jest.fn(), allow: jest.fn(), deny: jest.fn(), error: jest.fn(), report: jest.fn(), flush: jest.fn(), stop: jest.fn() } as any,
      failOpen: true,
      config: {
        socketPath: '/tmp/test.sock',
        httpHost: 'localhost',
        httpPort: 5201,
        failOpen: true,
        logLevel: 'error',
        interceptFetch: false,
        interceptHttp: false,
        interceptWs: false,
        interceptFs: false,
        interceptExec: true,
        timeout: 5000,
        contextType: 'agent' as const,
        enableSeatbelt: false,
        seatbeltProfileDir: '/tmp/test-profiles',
      },
    });

    interceptor.install();
    expect(cpModule.exec).not.toBe(origExec);

    interceptor.uninstall();
    expect(cpModule.exec).toBe(origExec);

    // Double uninstall is safe
    interceptor.uninstall();
    expect(cpModule.exec).toBe(origExec);
  });

  it('applies env allowlist and strips dangerous vars in seatbelt wrapping', () => {
    // Set up env to test allowlist filtering
    const savedEnv: Record<string, string | undefined> = {};
    const testVars: Record<string, string> = {
      NODE_OPTIONS: '--require /opt/agenshield/dist/register.cjs',
      HOME: '/Users/testagent',
      PATH: '/usr/bin:/bin',
      DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
      LD_PRELOAD: '/tmp/evil.so',
      AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI',
      GITHUB_TOKEN: 'ghp_xxxx',
      AGENSHIELD_SOCKET: '/var/run/agenshield/agenshield.sock',
    };
    for (const [key, value] of Object.entries(testVars)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }

    const mockReporter = {
      intercept: jest.fn(), allow: jest.fn(), deny: jest.fn(),
      error: jest.fn(), report: jest.fn(), flush: jest.fn(), stop: jest.fn(),
    };

    const interceptor = new RealChildProcessInterceptor({
      client: { request: jest.fn() } as any,
      policyEvaluator: { check: jest.fn() } as any,
      eventReporter: mockReporter as any,
      failOpen: true,
      brokerHttpPort: 5201,
      config: {
        socketPath: '/tmp/test.sock',
        httpHost: 'localhost',
        httpPort: 5201,
        failOpen: true,
        logLevel: 'error',
        interceptFetch: false,
        interceptHttp: false,
        interceptWs: false,
        interceptFs: false,
        interceptExec: true,
        timeout: 5000,
        contextType: 'agent' as const,
        enableSeatbelt: true,
        seatbeltProfileDir: '/tmp/test-profiles',
      },
    });

    // Mock profileManager to avoid filesystem access
    (interceptor as any).profileManager = {
      generateProfile: jest.fn().mockReturnValue('(version 1)(deny default)'),
      getOrCreateProfile: jest.fn().mockReturnValue('/tmp/test-profiles/sb-test.sb'),
    };

    const sandboxResult = {
      allowed: true,
      sandbox: {
        enabled: true,
        allowedReadPaths: [],
        allowedWritePaths: [],
        deniedPaths: [],
        networkAllowed: false,
        allowedHosts: [],
        allowedPorts: [],
        allowedBinaries: [],
        deniedBinaries: [],
        envInjection: {},
        envDeny: [],
        envAllow: [],
      },
    };

    // Test wrapWithSeatbelt (spawn-style)
    const spawnResult = (interceptor as any).wrapWithSeatbelt(
      '/usr/sbin/networksetup', ['-getairportnetwork', 'en0'], undefined, sandboxResult
    );
    expect(spawnResult.command).toBe('/usr/bin/sandbox-exec');
    const spawnEnv = spawnResult.options.env;
    // Allowlisted vars present
    expect(spawnEnv['HOME']).toBe('/Users/testagent');
    expect(spawnEnv['PATH']).toBe('/usr/bin:/bin');
    expect(spawnEnv['AGENSHIELD_SOCKET']).toBe('/var/run/agenshield/agenshield.sock');
    // Dangerous vars stripped
    expect(spawnEnv['NODE_OPTIONS']).toBeUndefined();
    expect(spawnEnv['DYLD_INSERT_LIBRARIES']).toBeUndefined();
    expect(spawnEnv['LD_PRELOAD']).toBeUndefined();
    expect(spawnEnv['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    expect(spawnEnv['GITHUB_TOKEN']).toBeUndefined();

    // Test wrapCommandStringWithSeatbelt (exec-style)
    const execResult = (interceptor as any).wrapCommandStringWithSeatbelt(
      'networksetup -getairportnetwork en0', undefined, sandboxResult
    );
    expect(execResult.command).toContain('/usr/bin/sandbox-exec');
    const execEnv = execResult.options.env;
    expect(execEnv['HOME']).toBe('/Users/testagent');
    expect(execEnv['NODE_OPTIONS']).toBeUndefined();
    expect(execEnv['DYLD_INSERT_LIBRARIES']).toBeUndefined();
    expect(execEnv['AWS_SECRET_ACCESS_KEY']).toBeUndefined();

    // Cleanup
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  });
});

// ── FetchInterceptor (real, not mocked) ──────────────────────────────────────

describe('FetchInterceptor (integration)', () => {
  let RealFetchInterceptor: typeof import('../interceptors/fetch').FetchInterceptor;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    const realFetch = jest.requireActual('../interceptors/fetch') as typeof import('../interceptors/fetch');
    RealFetchInterceptor = realFetch.FetchInterceptor;
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    // Restore globalThis.fetch in case a test didn't uninstall
    globalThis.fetch = originalFetch;
  });

  it('patches globalThis.fetch on install', () => {
    const mockEvaluator = { check: jest.fn().mockResolvedValue({ allowed: true }) };
    const mockReporter = {
      intercept: jest.fn(), allow: jest.fn(), deny: jest.fn(),
      error: jest.fn(), report: jest.fn(), flush: jest.fn(), stop: jest.fn(),
    };

    const interceptor = new RealFetchInterceptor({
      client: { request: jest.fn() } as any,
      policyEvaluator: mockEvaluator as any,
      eventReporter: mockReporter as any,
      failOpen: true,
      brokerHttpPort: 5201,
    });

    interceptor.install();
    expect(globalThis.fetch).not.toBe(originalFetch);

    interceptor.uninstall();
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('restores original fetch on uninstall', () => {
    const mockEvaluator = { check: jest.fn().mockResolvedValue({ allowed: true }) };
    const mockReporter = {
      intercept: jest.fn(), allow: jest.fn(), deny: jest.fn(),
      error: jest.fn(), report: jest.fn(), flush: jest.fn(), stop: jest.fn(),
    };

    const interceptor = new RealFetchInterceptor({
      client: { request: jest.fn() } as any,
      policyEvaluator: mockEvaluator as any,
      eventReporter: mockReporter as any,
      failOpen: true,
      brokerHttpPort: 5201,
    });

    interceptor.install();
    interceptor.uninstall();

    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('skips broker URLs', async () => {
    const mockCheck = jest.fn().mockResolvedValue({ allowed: true });
    const mockEvaluator = { check: mockCheck };
    const mockReporter = {
      intercept: jest.fn(), allow: jest.fn(), deny: jest.fn(),
      error: jest.fn(), report: jest.fn(), flush: jest.fn(), stop: jest.fn(),
    };

    // Stub original fetch to return a mock response
    const stubFetch = jest.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = stubFetch;

    const interceptor = new RealFetchInterceptor({
      client: { request: jest.fn() } as any,
      policyEvaluator: mockEvaluator as any,
      eventReporter: mockReporter as any,
      failOpen: true,
      brokerHttpPort: 5201,
    });

    interceptor.install();

    // Broker URL should bypass policy check
    await globalThis.fetch('http://127.0.0.1:5201/rpc');
    expect(mockCheck).not.toHaveBeenCalled();
    expect(stubFetch).toHaveBeenCalledTimes(1);

    interceptor.uninstall();
  });

  it('calls checkPolicy for non-broker URLs', async () => {
    const mockCheck = jest.fn().mockResolvedValue({ allowed: true });
    const mockEvaluator = { check: mockCheck };
    const mockReporter = {
      intercept: jest.fn(), allow: jest.fn(), deny: jest.fn(),
      error: jest.fn(), report: jest.fn(), flush: jest.fn(), stop: jest.fn(),
    };

    const stubFetch = jest.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = stubFetch;

    const interceptor = new RealFetchInterceptor({
      client: { request: jest.fn() } as any,
      policyEvaluator: mockEvaluator as any,
      eventReporter: mockReporter as any,
      failOpen: true,
      brokerHttpPort: 5201,
    });

    interceptor.install();

    await globalThis.fetch('https://api.example.com/data');
    expect(mockCheck).toHaveBeenCalledWith(
      'http_request',
      'https://api.example.com/data',
      undefined
    );

    interceptor.uninstall();
  });

  it('denied policy throws PolicyDeniedError', async () => {
    const { PolicyDeniedError } = jest.requireActual('../errors') as typeof import('../errors');

    const mockCheck = jest.fn().mockResolvedValue({
      allowed: false,
      reason: 'Blocked by test policy',
      policyId: 'test-deny',
    });
    const mockEvaluator = { check: mockCheck };
    const mockReporter = {
      intercept: jest.fn(), allow: jest.fn(), deny: jest.fn(),
      error: jest.fn(), report: jest.fn(), flush: jest.fn(), stop: jest.fn(),
    };

    const stubFetch = jest.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = stubFetch;

    const interceptor = new RealFetchInterceptor({
      client: { request: jest.fn() } as any,
      policyEvaluator: mockEvaluator as any,
      eventReporter: mockReporter as any,
      failOpen: false,
      brokerHttpPort: 5201,
    });

    interceptor.install();

    await expect(
      globalThis.fetch('https://evil.example.com')
    ).rejects.toThrow(PolicyDeniedError);

    // Original fetch should NOT be called
    expect(stubFetch).not.toHaveBeenCalled();

    interceptor.uninstall();
  });

  it('allowed policy calls original fetch', async () => {
    const mockCheck = jest.fn().mockResolvedValue({ allowed: true, policyId: 'allow-all' });
    const mockEvaluator = { check: mockCheck };
    const mockReporter = {
      intercept: jest.fn(), allow: jest.fn(), deny: jest.fn(),
      error: jest.fn(), report: jest.fn(), flush: jest.fn(), stop: jest.fn(),
    };

    const stubFetch = jest.fn().mockResolvedValue(new Response('hello'));
    globalThis.fetch = stubFetch;

    const interceptor = new RealFetchInterceptor({
      client: { request: jest.fn() } as any,
      policyEvaluator: mockEvaluator as any,
      eventReporter: mockReporter as any,
      failOpen: false,
      brokerHttpPort: 5201,
    });

    interceptor.install();

    const response = await globalThis.fetch('https://api.example.com/ok');
    expect(stubFetch).toHaveBeenCalledTimes(1);
    expect(await response.text()).toBe('hello');

    interceptor.uninstall();
  });
});
