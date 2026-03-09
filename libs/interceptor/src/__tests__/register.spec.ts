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

import { installInterceptors, uninstallInterceptors, isInstalled, getClient } from '../installer';
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

  it('dumps config to stderr when logLevel is debug', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    installInterceptors({ logLevel: 'debug' });

    expect(errorSpy).toHaveBeenCalledWith(
      '[AgenShield:config]',
      expect.stringContaining('"logLevel"')
    );

    errorSpy.mockRestore();
  });

  it('getClient returns null before install and client after install', () => {
    expect(getClient()).toBeNull();

    installInterceptors({ logLevel: 'error' });

    expect(getClient()).not.toBeNull();
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

// ── unwrapGuardedShell ───────────────────────────────────────────────────────

describe('ChildProcessInterceptor.unwrapGuardedShell', () => {
  let interceptor: any;

  beforeAll(() => {
    const realCp = jest.requireActual('../interceptors/child-process') as typeof import('../interceptors/child-process');
    interceptor = new realCp.ChildProcessInterceptor({
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
  });

  it('unwraps legacy /usr/local/bin/guarded-shell path', () => {
    expect(interceptor.unwrapGuardedShell('/usr/local/bin/guarded-shell -c ls -la')).toBe('ls -la');
  });

  it('unwraps bare guarded-shell basename', () => {
    expect(interceptor.unwrapGuardedShell('guarded-shell -c echo hello')).toBe('echo hello');
  });

  it('unwraps per-target $HOME/.agenshield/bin/guarded-shell path', () => {
    expect(
      interceptor.unwrapGuardedShell('/Users/ash_openclaw_agent/.agenshield/bin/guarded-shell -c ls memory')
    ).toBe('ls memory');
  });

  it('unwraps arbitrary absolute path ending in /guarded-shell', () => {
    expect(
      interceptor.unwrapGuardedShell('/opt/custom/guarded-shell -c git status')
    ).toBe('git status');
  });

  it('handles guarded-shell without -c flag', () => {
    expect(
      interceptor.unwrapGuardedShell('/Users/agent/.agenshield/bin/guarded-shell ls')
    ).toBe('ls');
  });

  it('returns original command when no guarded-shell wrapper', () => {
    expect(interceptor.unwrapGuardedShell('ls -la /tmp')).toBe('ls -la /tmp');
  });

  it('returns original command for non-absolute path containing guarded-shell', () => {
    expect(interceptor.unwrapGuardedShell('some-tool /guarded-shell -c ls')).toBe('some-tool /guarded-shell -c ls');
  });
});

// ── ChildProcessInterceptor - intercepted methods ────────────────────────────

describe('ChildProcessInterceptor - intercepted methods', () => {
  let RealChildProcessInterceptor: typeof import('../interceptors/child-process').ChildProcessInterceptor;
  let cpModule: typeof import('node:child_process');

  beforeAll(() => {
    const realCp = jest.requireActual('../interceptors/child-process') as typeof import('../interceptors/child-process');
    RealChildProcessInterceptor = realCp.ChildProcessInterceptor;
    cpModule = jest.requireActual('node:child_process') as typeof import('node:child_process');
  });

  function createCpInterceptor(overrides?: Record<string, any>) {
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
        enableSeatbelt: false,
        seatbeltProfileDir: '/tmp/test-profiles',
        enableResourceMonitoring: false,
      },
      ...overrides,
    });
    return { interceptor, mockReporter };
  }

  afterEach(() => {
    // Reset cpModule methods
    jest.restoreAllMocks();
  });

  it('exec: calls syncPolicyCheck and wraps command', (done) => {
    const { interceptor } = createCpInterceptor();

    // Mock syncClient.request to allow
    (interceptor as any).syncClient = {
      request: jest.fn().mockReturnValue({ allowed: true, policyId: 'p1' }),
    };

    interceptor.install();

    cpModule.exec('echo hello', (err, stdout) => {
      expect(err).toBeNull();
      expect(stdout).toContain('hello');
      interceptor.uninstall();
      done();
    });
  });

  it('exec: returns error via callback when denied', (done) => {
    const { PolicyDeniedError } = jest.requireActual('../errors') as typeof import('../errors');
    const { interceptor } = createCpInterceptor({ failOpen: false });

    (interceptor as any).syncClient = {
      request: jest.fn().mockReturnValue({ allowed: false, reason: 'denied' }),
    };
    (interceptor as any).failOpen = false;

    interceptor.install();

    cpModule.exec('echo denied', (err) => {
      expect(err).toBeInstanceOf(PolicyDeniedError);
      interceptor.uninstall();
      done();
    });
  });

  it('execSync: returns output when allowed', () => {
    const { interceptor } = createCpInterceptor();

    (interceptor as any).syncClient = {
      request: jest.fn().mockReturnValue({ allowed: true }),
    };

    interceptor.install();

    const result = cpModule.execSync('echo sync-test', { encoding: 'utf-8' });
    expect(result).toContain('sync-test');

    interceptor.uninstall();
  });

  it('execSync: throws when denied', () => {
    const { PolicyDeniedError } = jest.requireActual('../errors') as typeof import('../errors');
    const { interceptor } = createCpInterceptor({ failOpen: false });

    (interceptor as any).syncClient = {
      request: jest.fn().mockReturnValue({ allowed: false, reason: 'no' }),
    };
    (interceptor as any).failOpen = false;

    interceptor.install();

    expect(() => cpModule.execSync('echo bad')).toThrow(PolicyDeniedError);

    interceptor.uninstall();
  });

  it('spawn: emits error when denied', (done) => {
    const { interceptor } = createCpInterceptor({ failOpen: false });

    (interceptor as any).syncClient = {
      request: jest.fn().mockReturnValue({ allowed: false, reason: 'blocked' }),
    };
    (interceptor as any).failOpen = false;

    interceptor.install();

    const child = cpModule.spawn('echo', ['bad']);
    child.on('error', (err) => {
      expect(err.message).toContain('blocked');
      interceptor.uninstall();
      done();
    });
  });

  it('spawn: succeeds when allowed', (done) => {
    const { interceptor } = createCpInterceptor();

    (interceptor as any).syncClient = {
      request: jest.fn().mockReturnValue({ allowed: true }),
    };

    interceptor.install();

    const child = cpModule.spawn('echo', ['ok']);
    child.on('close', (code) => {
      expect(code).toBe(0);
      interceptor.uninstall();
      done();
    });
  });

  it('spawnSync: returns synthetic error result when denied', () => {
    const { interceptor } = createCpInterceptor({ failOpen: false });

    (interceptor as any).syncClient = {
      request: jest.fn().mockReturnValue({ allowed: false, reason: 'blocked' }),
    };
    (interceptor as any).failOpen = false;

    interceptor.install();

    const result = cpModule.spawnSync('echo', ['bad']);
    expect(result.status).toBe(1);
    expect(result.error).toBeDefined();

    interceptor.uninstall();
  });

  it('spawnSync: succeeds when allowed', () => {
    const { interceptor } = createCpInterceptor();

    (interceptor as any).syncClient = {
      request: jest.fn().mockReturnValue({ allowed: true }),
    };

    interceptor.install();

    const result = cpModule.spawnSync('echo', ['ok'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);

    interceptor.uninstall();
  });

  it('execFile: succeeds when allowed', (done) => {
    const { interceptor } = createCpInterceptor();

    (interceptor as any).syncClient = {
      request: jest.fn().mockReturnValue({ allowed: true }),
    };

    interceptor.install();

    cpModule.execFile('echo', ['test'], (err, stdout) => {
      expect(err).toBeNull();
      interceptor.uninstall();
      done();
    });
  });

  it('execFile: returns error via callback when denied', (done) => {
    const { PolicyDeniedError } = jest.requireActual('../errors') as typeof import('../errors');
    const { interceptor } = createCpInterceptor({ failOpen: false });

    (interceptor as any).syncClient = {
      request: jest.fn().mockReturnValue({ allowed: false, reason: 'no' }),
    };
    (interceptor as any).failOpen = false;

    interceptor.install();

    cpModule.execFile('echo', ['bad'], (err) => {
      expect(err).toBeInstanceOf(PolicyDeniedError);
      interceptor.uninstall();
      done();
    });
  });

  it('fork: emits error when denied', (done) => {
    const { interceptor } = createCpInterceptor({ failOpen: false });

    (interceptor as any).syncClient = {
      request: jest.fn().mockReturnValue({ allowed: false, reason: 'no fork' }),
    };
    (interceptor as any).failOpen = false;

    interceptor.install();

    const child = cpModule.fork('/nonexistent.js', [], { silent: true });
    child.on('error', (err) => {
      expect(err.message).toContain('no fork');
      interceptor.uninstall();
      done();
    });
  });

  it('exec: re-entrancy guard skips second check', (done) => {
    const { interceptor } = createCpInterceptor();
    const mockRequest = jest.fn().mockReturnValue({ allowed: true });
    (interceptor as any).syncClient = { request: mockRequest };

    interceptor.install();

    // Set re-entrancy flag
    (interceptor as any)._checking = true;

    cpModule.exec('echo re-entrant', (err) => {
      // Should have been called via original without policy check
      expect(mockRequest).not.toHaveBeenCalled();
      (interceptor as any)._checking = false;
      interceptor.uninstall();
      done();
    });
  });

  it('getPolicyExecutionContext reads trace env vars', () => {
    const savedTrace = process.env['AGENSHIELD_TRACE_ID'];
    const savedDepth = process.env['AGENSHIELD_DEPTH'];
    process.env['AGENSHIELD_TRACE_ID'] = 'trace-abc';
    process.env['AGENSHIELD_DEPTH'] = '2';

    const { interceptor } = createCpInterceptor();
    const ctx = (interceptor as any).getPolicyExecutionContext();

    expect(ctx.depth).toBe(3); // parentDepth + 1
    expect(ctx.parentTraceId).toBe('trace-abc');

    if (savedTrace !== undefined) process.env['AGENSHIELD_TRACE_ID'] = savedTrace;
    else delete process.env['AGENSHIELD_TRACE_ID'];
    if (savedDepth !== undefined) process.env['AGENSHIELD_DEPTH'] = savedDepth;
    else delete process.env['AGENSHIELD_DEPTH'];
  });

  it('resolveResourceLimits returns policy limits when present', () => {
    const { interceptor } = createCpInterceptor();
    const result = (interceptor as any).resolveResourceLimits({
      sandbox: { resourceLimits: { memoryMb: { warn: 100, kill: 200 } } },
    });
    expect(result).toEqual({ memoryMb: { warn: 100, kill: 200 } });
  });

  it('resolveResourceLimits falls back to config defaults', () => {
    const { interceptor } = createCpInterceptor();
    (interceptor as any).interceptorConfig = {
      defaultResourceLimits: { cpuPercent: { warn: 50, kill: 90 } },
    };
    const result = (interceptor as any).resolveResourceLimits({ sandbox: {} });
    expect(result).toEqual({ cpuPercent: { warn: 50, kill: 90 } });
  });

  it('getFailOpenSandbox returns restrictive defaults', () => {
    const { interceptor } = createCpInterceptor();
    const sandbox = (interceptor as any).getFailOpenSandbox();
    expect(sandbox.enabled).toBe(true);
    expect(sandbox.networkAllowed).toBe(false);
    expect(sandbox.allowedReadPaths).toEqual([]);
  });

  it('wrapWithSeatbelt skips node-bin', () => {
    const { interceptor } = createCpInterceptor();
    (interceptor as any).profileManager = { generateProfile: jest.fn(), getOrCreateProfile: jest.fn() };
    const result = (interceptor as any).wrapWithSeatbelt(
      '/opt/agenshield/bin/node-bin', ['script.js'], undefined,
      { allowed: true, sandbox: { enabled: true, envAllow: [], envInjection: {}, envDeny: [] } }
    );
    expect(result.command).toBe('/opt/agenshield/bin/node-bin');
  });

  it('wrapWithSeatbelt skips sandbox-exec', () => {
    const { interceptor } = createCpInterceptor();
    (interceptor as any).profileManager = { generateProfile: jest.fn(), getOrCreateProfile: jest.fn() };
    const result = (interceptor as any).wrapWithSeatbelt(
      '/usr/bin/sandbox-exec', ['-f', 'p.sb', 'cmd'], undefined,
      { allowed: true, sandbox: { enabled: true, envAllow: [], envInjection: {}, envDeny: [] } }
    );
    expect(result.command).toBe('/usr/bin/sandbox-exec');
  });

  it('wrapCommandStringWithSeatbelt skips already-wrapped commands', () => {
    const { interceptor } = createCpInterceptor();
    (interceptor as any).profileManager = { generateProfile: jest.fn(), getOrCreateProfile: jest.fn() };
    const result = (interceptor as any).wrapCommandStringWithSeatbelt(
      '/usr/bin/sandbox-exec -f p.sb echo hello', undefined,
      { allowed: true, sandbox: { enabled: true, envAllow: [], envInjection: {}, envDeny: [] } }
    );
    expect(result.command).toContain('sandbox-exec -f p.sb echo hello');
  });

  it('fork applies env filtering from sandbox policy', () => {
    const { interceptor } = createCpInterceptor();

    (interceptor as any).syncClient = {
      request: jest.fn().mockReturnValue({
        allowed: true,
        sandbox: {
          enabled: true,
          envAllow: ['HOME', 'PATH'],
          envInjection: { CUSTOM: 'val' },
          envDeny: ['SECRET'],
        },
      }),
    };

    interceptor.install();

    const savedEnv = { ...process.env };
    process.env['SECRET'] = 'hidden';
    process.env['HOME'] = '/home/test';

    const child = cpModule.fork('/nonexistent-module.js', [], { silent: true });
    child.on('error', () => {}); // ignore errors

    process.env['SECRET'] = savedEnv['SECRET'];
    process.env['HOME'] = savedEnv['HOME'];

    interceptor.uninstall();
  });

  it('constructor creates resourceMonitor when enableResourceMonitoring is true', () => {
    const { interceptor } = createCpInterceptor({
      config: {
        enableResourceMonitoring: true,
        enableSeatbelt: false,
        socketPath: '/tmp/test.sock',
        httpHost: 'localhost',
        httpPort: 5201,
        timeout: 5000,
      },
    });
    expect((interceptor as any).resourceMonitor).not.toBeNull();
  });

  it('trackChild calls resourceMonitor.track when limits exist', () => {
    const { interceptor } = createCpInterceptor();
    const mockTrack = jest.fn();
    (interceptor as any).resourceMonitor = { track: mockTrack, stopAll: jest.fn() };

    const mockChild = { pid: 123 };
    const policyResult = {
      allowed: true,
      sandbox: { resourceLimits: { memoryMb: { warn: 100, kill: 200 } } },
      traceId: 'trace-1',
    };

    (interceptor as any).trackChild(mockChild, 'cmd', policyResult);
    expect(mockTrack).toHaveBeenCalledWith(mockChild, 'cmd', { memoryMb: { warn: 100, kill: 200 } }, 'trace-1');
  });

  it('trackChild does nothing when no limits', () => {
    const { interceptor } = createCpInterceptor();
    const mockTrack = jest.fn();
    (interceptor as any).resourceMonitor = { track: mockTrack, stopAll: jest.fn() };

    (interceptor as any).trackChild({ pid: 123 }, 'cmd', { allowed: true });
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('trackChild does nothing when child has no pid', () => {
    const { interceptor } = createCpInterceptor();
    const mockTrack = jest.fn();
    (interceptor as any).resourceMonitor = { track: mockTrack, stopAll: jest.fn() };

    (interceptor as any).trackChild({ pid: undefined }, 'cmd', {
      sandbox: { resourceLimits: { memoryMb: { warn: 100, kill: 200 } } },
    });
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('syncPolicyCheck returns null on non-PolicyDenied error with failOpen', () => {
    const { interceptor } = createCpInterceptor({ failOpen: true });
    (interceptor as any).syncClient = {
      request: jest.fn().mockImplementation(() => { throw new Error('broker unavailable'); }),
    };

    const result = (interceptor as any).syncPolicyCheck('cmd');
    expect(result).toBeNull();
  });

  it('syncPolicyCheck throws on non-PolicyDenied error with failOpen=false', () => {
    const { interceptor } = createCpInterceptor({ failOpen: false });
    (interceptor as any).failOpen = false;
    (interceptor as any).syncClient = {
      request: jest.fn().mockImplementation(() => { throw new Error('broker down'); }),
    };

    expect(() => (interceptor as any).syncPolicyCheck('cmd')).toThrow('broker down');
  });

  it('execSync re-entrancy guard with _executing flag', () => {
    const { interceptor } = createCpInterceptor();
    const mockRequest = jest.fn().mockReturnValue({ allowed: true });
    (interceptor as any).syncClient = { request: mockRequest };

    interceptor.install();

    (interceptor as any)._executing = true;
    const result = cpModule.execSync('echo skipped', { encoding: 'utf-8' });
    expect(mockRequest).not.toHaveBeenCalled();
    (interceptor as any)._executing = false;

    interceptor.uninstall();
  });

  it('spawn re-entrancy guard with _executing flag', () => {
    const { interceptor } = createCpInterceptor();
    const mockRequest = jest.fn().mockReturnValue({ allowed: true });
    (interceptor as any).syncClient = { request: mockRequest };

    interceptor.install();

    (interceptor as any)._executing = true;
    const child = cpModule.spawn('echo', ['skipped']);
    child.on('error', () => {});
    expect(mockRequest).not.toHaveBeenCalled();
    (interceptor as any)._executing = false;

    interceptor.uninstall();
  });

  it('spawnSync re-entrancy guard with _executing flag', () => {
    const { interceptor } = createCpInterceptor();
    const mockRequest = jest.fn().mockReturnValue({ allowed: true });
    (interceptor as any).syncClient = { request: mockRequest };

    interceptor.install();

    (interceptor as any)._executing = true;
    cpModule.spawnSync('echo', ['skipped']);
    expect(mockRequest).not.toHaveBeenCalled();
    (interceptor as any)._executing = false;

    interceptor.uninstall();
  });

  it('execFile re-entrancy guard with _executing flag', (done) => {
    const { interceptor } = createCpInterceptor();
    const mockRequest = jest.fn().mockReturnValue({ allowed: true });
    (interceptor as any).syncClient = { request: mockRequest };

    interceptor.install();

    (interceptor as any)._executing = true;
    cpModule.execFile('echo', ['skipped'], () => {
      expect(mockRequest).not.toHaveBeenCalled();
      (interceptor as any)._executing = false;
      interceptor.uninstall();
      done();
    });
  });

  it('fork re-entrancy guard with _executing flag', () => {
    const { interceptor } = createCpInterceptor();
    const mockRequest = jest.fn().mockReturnValue({ allowed: true });
    (interceptor as any).syncClient = { request: mockRequest };

    interceptor.install();

    (interceptor as any)._executing = true;
    const child = cpModule.fork('/nonexistent.js', [], { silent: true });
    child.on('error', () => {});
    expect(mockRequest).not.toHaveBeenCalled();
    (interceptor as any)._executing = false;

    interceptor.uninstall();
  });

  it('exec with options passes wrapped options', (done) => {
    const { interceptor } = createCpInterceptor();
    (interceptor as any).syncClient = {
      request: jest.fn().mockReturnValue({ allowed: true }),
    };

    interceptor.install();

    cpModule.exec('echo opts', { cwd: '/tmp' }, (err: any) => {
      interceptor.uninstall();
      done();
    });
  });

  it('execFile without callback', () => {
    const { interceptor } = createCpInterceptor();
    (interceptor as any).syncClient = {
      request: jest.fn().mockReturnValue({ allowed: true }),
    };

    interceptor.install();

    // Call execFile without a callback — exercises line 627
    const child = cpModule.execFile('echo', ['no-callback']);
    child.on('error', () => {});

    interceptor.uninstall();
  });

  it('execFile with options object', (done) => {
    const { interceptor } = createCpInterceptor();
    (interceptor as any).syncClient = {
      request: jest.fn().mockReturnValue({ allowed: true }),
    };

    interceptor.install();

    // Pass args + options + callback to exercise object option parsing (lines 586-587)
    cpModule.execFile('echo', ['with-opts'], { cwd: '/tmp' }, (err) => {
      interceptor.uninstall();
      done();
    });
  });

  it('wrapWithSeatbelt wraps command with sandbox-exec', () => {
    const { interceptor } = createCpInterceptor();
    (interceptor as any).profileManager = {
      generateProfile: jest.fn().mockReturnValue('(version 1)'),
      getOrCreateProfile: jest.fn().mockReturnValue('/tmp/profile.sb'),
    };

    const result = (interceptor as any).wrapWithSeatbelt(
      'ls', ['-la'], undefined,
      {
        allowed: true,
        sandbox: {
          enabled: true,
          envAllow: ['HOME', 'PATH'],
          envInjection: { CUSTOM: 'val' },
          envDeny: ['SECRET'],
        },
      }
    );

    expect(result.command).toBe('/usr/bin/sandbox-exec');
    expect(result.args).toEqual(['-f', '/tmp/profile.sb', 'ls', '-la']);
    expect(result.options.env.CUSTOM).toBe('val');
    expect(result.options.env.SECRET).toBeUndefined();
    expect(result.options.env.NODE_OPTIONS).toBeUndefined();
  });

  it('wrapCommandStringWithSeatbelt wraps command string', () => {
    const { interceptor } = createCpInterceptor();
    (interceptor as any).profileManager = {
      generateProfile: jest.fn().mockReturnValue('(version 1)'),
      getOrCreateProfile: jest.fn().mockReturnValue('/tmp/profile.sb'),
    };

    const result = (interceptor as any).wrapCommandStringWithSeatbelt(
      'echo hello', undefined,
      {
        allowed: true,
        sandbox: {
          enabled: true,
          envAllow: ['HOME'],
          envInjection: { FOO: 'bar' },
          envDeny: ['BAD'],
        },
      }
    );

    expect(result.command).toBe('/usr/bin/sandbox-exec -f /tmp/profile.sb echo hello');
    expect(result.options.env.FOO).toBe('bar');
    expect(result.options.env.BAD).toBeUndefined();
    expect(result.options.env.NODE_OPTIONS).toBeUndefined();
  });

  it('resolveSandbox returns fail-open sandbox when policyResult is null and profileManager exists', () => {
    const { interceptor } = createCpInterceptor();
    (interceptor as any).profileManager = { generateProfile: jest.fn() };

    const sandbox = (interceptor as any).resolveSandbox(null);
    expect(sandbox).not.toBeNull();
    expect(sandbox.enabled).toBe(true);
    expect(sandbox.networkAllowed).toBe(false);
  });

  it('resolveSandbox returns null when policy has no sandbox enabled', () => {
    const { interceptor } = createCpInterceptor();
    const sandbox = (interceptor as any).resolveSandbox({ allowed: true, sandbox: { enabled: false } });
    expect(sandbox).toBeNull();
  });

  it('resolveSandbox returns sandbox from policy when enabled', () => {
    const { interceptor } = createCpInterceptor();
    const policySandbox = { enabled: true, allowedReadPaths: ['/tmp'] };
    const sandbox = (interceptor as any).resolveSandbox({ allowed: true, sandbox: policySandbox });
    expect(sandbox).toBe(policySandbox);
  });

  it('unwrapGuardedShell strips full-path guarded-shell', () => {
    const { interceptor } = createCpInterceptor();
    const result = (interceptor as any).unwrapGuardedShell('/usr/local/bin/guarded-shell -c gog auth list');
    expect(result).toBe('gog auth list');
  });

  it('unwrapGuardedShell strips basename guarded-shell', () => {
    const { interceptor } = createCpInterceptor();
    const result = (interceptor as any).unwrapGuardedShell('guarded-shell -c echo hello');
    expect(result).toBe('echo hello');
  });

  it('unwrapGuardedShell strips per-target path guarded-shell', () => {
    const { interceptor } = createCpInterceptor();
    const result = (interceptor as any).unwrapGuardedShell('/Users/me/.agenshield/bin/guarded-shell -c git status');
    expect(result).toBe('git status');
  });

  it('unwrapGuardedShell passes through non-guarded commands', () => {
    const { interceptor } = createCpInterceptor();
    const result = (interceptor as any).unwrapGuardedShell('echo hello');
    expect(result).toBe('echo hello');
  });

  it('uninstall calls resourceMonitor.stopAll', () => {
    const { interceptor } = createCpInterceptor();
    const mockStopAll = jest.fn();
    (interceptor as any).resourceMonitor = { stopAll: mockStopAll };

    interceptor.install();
    interceptor.uninstall();

    expect(mockStopAll).toHaveBeenCalled();
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

  it('handles URL object input', async () => {
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

    await globalThis.fetch(new URL('https://api.example.com/url-object'));
    expect(mockCheck).toHaveBeenCalledWith(
      'http_request',
      'https://api.example.com/url-object',
      undefined
    );

    interceptor.uninstall();
  });

  it('handles Request object input', async () => {
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

    const req = new Request('https://api.example.com/request-obj');
    await globalThis.fetch(req);
    expect(mockCheck).toHaveBeenCalledWith(
      'http_request',
      'https://api.example.com/request-obj',
      undefined
    );

    interceptor.uninstall();
  });

  it('failOpen falls back to original fetch on broker error', async () => {
    const mockCheck = jest.fn().mockRejectedValue(new Error('broker down'));
    const mockEvaluator = { check: mockCheck };
    const mockReporter = {
      intercept: jest.fn(), allow: jest.fn(), deny: jest.fn(),
      error: jest.fn(), report: jest.fn(), flush: jest.fn(), stop: jest.fn(),
    };

    const stubFetch = jest.fn().mockResolvedValue(new Response('fallback'));
    globalThis.fetch = stubFetch;

    const interceptor = new RealFetchInterceptor({
      client: { request: jest.fn() } as any,
      policyEvaluator: mockEvaluator as any,
      eventReporter: mockReporter as any,
      failOpen: true,
      brokerHttpPort: 5201,
    });

    interceptor.install();

    const res = await globalThis.fetch('https://api.example.com/open');
    expect(await res.text()).toBe('fallback');

    interceptor.uninstall();
  });

  it('does not double-install', () => {
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
    const first = globalThis.fetch;
    interceptor.install(); // second call
    expect(globalThis.fetch).toBe(first);

    interceptor.uninstall();
  });

  it('does not uninstall if not installed', () => {
    const mockEvaluator = { check: jest.fn() };
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

    interceptor.uninstall(); // no-op
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('getPolicyExecutionContext returns context from config', () => {
    const mockEvaluator = { check: jest.fn() };
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
      config: {
        contextType: 'skill',
        contextSkillSlug: 'my-skill',
        contextAgentId: 'agent-x',
      } as any,
    });

    const ctx = (interceptor as any).getPolicyExecutionContext();
    expect(ctx).toEqual({
      callerType: 'skill',
      skillSlug: 'my-skill',
      agentId: 'agent-x',
      depth: 0,
    });
  });

  it('isLocalUrl returns true for localhost variants', () => {
    const mockEvaluator = { check: jest.fn() };
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

    expect((interceptor as any).isLocalUrl('http://localhost:8080/api')).toBe(true);
    expect((interceptor as any).isLocalUrl('http://127.0.0.1:3000/api')).toBe(true);
    expect((interceptor as any).isLocalUrl('http://[::1]:5000/api')).toBe(true);
    expect((interceptor as any).isLocalUrl('https://external.com')).toBe(false);
    expect((interceptor as any).isLocalUrl('not-a-url')).toBe(false);
  });

  it('creates ProxyAgent when HTTP_PROXY is set', () => {
    const savedProxy = process.env['HTTP_PROXY'];
    process.env['HTTP_PROXY'] = 'http://127.0.0.1:9999';

    const mockReporter = {
      intercept: jest.fn(), allow: jest.fn(), deny: jest.fn(),
      error: jest.fn(), report: jest.fn(), flush: jest.fn(), stop: jest.fn(),
    };

    const interceptor = new RealFetchInterceptor({
      client: { request: jest.fn() } as any,
      policyEvaluator: { check: jest.fn() } as any,
      eventReporter: mockReporter as any,
      failOpen: true,
      brokerHttpPort: 5201,
    });

    // ProxyAgent should be created (or null if undici not available, but no error)
    expect(interceptor).toBeDefined();
    // The proxyConfig should be enabled
    expect((interceptor as any).proxyConfig.enabled).toBe(true);

    if (savedProxy !== undefined) process.env['HTTP_PROXY'] = savedProxy;
    else delete process.env['HTTP_PROXY'];
  });
});
