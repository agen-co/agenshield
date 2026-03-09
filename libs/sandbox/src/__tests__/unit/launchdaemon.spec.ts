/* eslint-disable no-var */
import { generateBrokerPlist, generateBrokerLauncherScript } from '../../enforcement/launchdaemon';
import type { UserConfig } from '@agenshield/ipc';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/*                                                                     */
/*  jest.mock factories are hoisted above ALL const/let declarations,  */
/*  so we must use `var` (no TDZ) for any references used inside them. */
/* ------------------------------------------------------------------ */

var mockExecAsync: jest.Mock;
var mockAccess: jest.Mock;

jest.mock('node:child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('node:util', () => {
  mockExecAsync = jest.fn();
  return { promisify: () => mockExecAsync };
});

jest.mock('node:fs/promises', () => {
  mockAccess = jest.fn();
  return { access: (...args: unknown[]) => mockAccess(...args) };
});

jest.mock('../../legacy', () => ({
  generateBrokerPlistLegacy: jest.fn(() => '<plist>LEGACY_CONTENT</plist>'),
}));

/* ------------------------------------------------------------------ */
/*  Re-imports (after mocks are in place)                              */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generateBrokerPlistLegacy } = require('../../legacy') as {
  generateBrokerPlistLegacy: jest.Mock;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  installLaunchDaemon,
  loadLaunchDaemon,
  unloadLaunchDaemon,
  uninstallLaunchDaemon,
  isDaemonRunning,
  getDaemonStatus,
  restartDaemon,
  fixSocketPermissions,
} = require('../../enforcement/launchdaemon') as typeof import('../../enforcement/launchdaemon');

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const PLIST_PATH = '/Library/LaunchDaemons/com.agenshield.broker.plist';
const LABEL = 'com.agenshield.broker';

const mockUserConfig: UserConfig = {
  agentUser: {
    username: 'ash_test_agent',
    uid: 5200,
    gid: 5100,
    home: '/Users/ash_test_agent',
    shell: '/Users/ash_test_agent/.agenshield/bin/guarded-shell',
    realname: 'AgenShield Agent (test)',
    groups: ['ash_test'],
  },
  brokerUser: {
    username: 'ash_test_broker',
    uid: 5201,
    gid: 5100,
    home: '/var/empty',
    shell: '/bin/bash',
    realname: 'AgenShield Broker (test)',
    groups: ['ash_test'],
  },
  groups: {
    socket: {
      name: 'ash_test',
      gid: 5100,
      description: 'AgenShield socket access (test)',
    },
  },
  prefix: '',
  baseName: 'test',
  baseUid: 5200,
  baseGid: 5100,
};

/* ------------------------------------------------------------------ */
/*  Setup / teardown                                                   */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  jest.clearAllMocks();
  mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  mockAccess.mockResolvedValue(undefined);
});

/* ================================================================== */
/*  EXISTING TESTS -- pure / synchronous functions                     */
/* ================================================================== */

describe('generateBrokerPlist', () => {
  it('generates valid XML plist', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(plist).toContain('<!DOCTYPE plist');
    expect(plist).toContain('<plist version="1.0">');
    expect(plist).toContain('</plist>');
  });

  it('contains the correct label', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('<string>com.agenshield.broker</string>');
  });

  it('uses custom baseName in label when provided', () => {
    const plist = generateBrokerPlist(mockUserConfig, {
      baseName: 'openclaw',
      hostHome: '/Users/testuser',
    });

    expect(plist).toContain(
      '<string>com.agenshield.broker.openclaw</string>',
    );
  });

  it('contains broker username and socket group', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('<string>ash_test_broker</string>');
    expect(plist).toContain('<string>ash_test</string>');
  });

  it('has RunAtLoad and KeepAlive set to true', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
  });

  it('contains environment variables', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('AGENSHIELD_CONFIG');
    expect(plist).toContain('AGENSHIELD_SOCKET');
    expect(plist).toContain('AGENSHIELD_AGENT_HOME');
    expect(plist).toContain('NODE_ENV');
    expect(plist).toContain('production');
  });

  it('references agent home in socket path', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain(
      '/Users/ash_test_agent/.agenshield/run/agenshield.sock',
    );
  });

  it('contains log paths under agent home', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('/Users/ash_test_agent/.agenshield/logs/broker.log');
    expect(plist).toContain(
      '/Users/ash_test_agent/.agenshield/logs/broker.error.log',
    );
  });

  it('always includes the associated bundle identifier', () => {
    const plist = generateBrokerPlist(mockUserConfig, {
      hostHome: '/Users/testuser',
    });

    expect(plist).toContain('AssociatedBundleIdentifiers');
    expect(plist).toContain('com.frontegg.AgenShield');
  });

  it('uses per-target node-bin and shared broker binary', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('/Users/ash_test_agent/bin/node-bin');
    expect(plist).toContain('/Users/testuser/.agenshield/libexec/agenshield-broker');
  });

  it('omits node-bin from ProgramArguments when isSEABinary is true', () => {
    const plist = generateBrokerPlist(mockUserConfig, {
      hostHome: '/Users/testuser',
      isSEABinary: true,
    });

    expect(plist).toContain('/Users/testuser/.agenshield/libexec/agenshield-broker');
    expect(plist).not.toContain('node-bin');
  });

  it('includes node-bin in ProgramArguments when isSEABinary is false', () => {
    const plist = generateBrokerPlist(mockUserConfig, {
      hostHome: '/Users/testuser',
      isSEABinary: false,
    });

    expect(plist).toContain('/Users/ash_test_agent/bin/node-bin');
    expect(plist).toContain('/Users/testuser/.agenshield/libexec/agenshield-broker');
  });

  it('uses /bin/bash + launcher script in ProgramArguments when launcherScriptPath is set', () => {
    const launcherPath = '/Users/ash_test_agent/.agenshield/bin/broker-launcher.sh';
    const plist = generateBrokerPlist(mockUserConfig, {
      hostHome: '/Users/testuser',
      launcherScriptPath: launcherPath,
    });

    expect(plist).toContain('<string>/bin/bash</string>');
    expect(plist).toContain(`<string>${launcherPath}</string>`);
    expect(plist).not.toMatch(/<array>[\s\S]*node-bin[\s\S]*<\/array>/);
  });

  it('launcherScriptPath takes precedence over isSEABinary', () => {
    const launcherPath = '/Users/ash_test_agent/.agenshield/bin/broker-launcher.sh';
    const plist = generateBrokerPlist(mockUserConfig, {
      hostHome: '/Users/testuser',
      isSEABinary: true,
      launcherScriptPath: launcherPath,
    });

    expect(plist).toContain('<string>/bin/bash</string>');
    expect(plist).toContain(`<string>${launcherPath}</string>`);
    const programArgs = plist.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
    expect(programArgs).toBeTruthy();
    expect(programArgs![1]).toContain('/bin/bash');
    expect(programArgs![1]).toContain(launcherPath);
    expect(programArgs![1]).not.toContain('agenshield-broker');
  });
});

describe('generateBrokerLauncherScript', () => {
  const defaultOpts = {
    brokerBinaryPath: '/Users/testuser/.agenshield/libexec/agenshield-broker',
    configPath: '/Users/ash_test_agent/.agenshield/config/shield.json',
    socketPath: '/Users/ash_test_agent/.agenshield/run/agenshield.sock',
    agentHome: '/Users/ash_test_agent',
    hostHome: '/Users/testuser',
    logDir: '/Users/ash_test_agent/.agenshield/logs',
    daemonUrl: 'http://127.0.0.1:5200',
    profileId: 'ash_test_agent',
  };

  it('starts with bash shebang and set -euo pipefail', () => {
    const script = generateBrokerLauncherScript(defaultOpts);

    expect(script).toMatch(/^#!\/bin\/bash\n/);
    expect(script).toContain('set -euo pipefail');
  });

  it('exports all required environment variables', () => {
    const script = generateBrokerLauncherScript(defaultOpts);

    expect(script).toContain(`export AGENSHIELD_CONFIG="${defaultOpts.configPath}"`);
    expect(script).toContain(`export AGENSHIELD_SOCKET="${defaultOpts.socketPath}"`);
    expect(script).toContain(`export AGENSHIELD_AGENT_HOME="${defaultOpts.agentHome}"`);
    expect(script).toContain(`export AGENSHIELD_HOST_HOME="${defaultOpts.hostHome}"`);
    expect(script).toContain(`export AGENSHIELD_DAEMON_URL="${defaultOpts.daemonUrl}"`);
    expect(script).toContain(`export AGENSHIELD_PROFILE_ID="${defaultOpts.profileId}"`);
    expect(script).toContain('export NODE_ENV="production"');
  });

  it('exec-replaces with the broker binary path', () => {
    const script = generateBrokerLauncherScript(defaultOpts);

    expect(script).toContain(`exec "${defaultOpts.brokerBinaryPath}"`);
  });

  it('includes BETTER_SQLITE3_BINDING when nativeModulePath is set', () => {
    const script = generateBrokerLauncherScript({
      ...defaultOpts,
      nativeModulePath: '/Users/testuser/.agenshield/lib/v1.0.0/native/better_sqlite3.node',
    });

    expect(script).toContain('export BETTER_SQLITE3_BINDING="/Users/testuser/.agenshield/lib/v1.0.0/native/better_sqlite3.node"');
  });

  it('omits BETTER_SQLITE3_BINDING when nativeModulePath is not set', () => {
    const script = generateBrokerLauncherScript(defaultOpts);

    expect(script).not.toContain('BETTER_SQLITE3_BINDING');
  });
});

describe('generateBrokerPlistLegacy', () => {
  // The legacy module is mocked for installLaunchDaemon tests.
  // These tests verify the mock is callable and returns expected stub content.
  it('returns stub plist content from mock', () => {
    const plist = generateBrokerPlistLegacy();

    expect(plist).toContain('LEGACY_CONTENT');
  });

  it('is called with provided options', () => {
    generateBrokerPlistLegacy({
      brokerBinary: '/custom/broker',
      configPath: '/custom/config.json',
      socketPath: '/custom/socket.sock',
    });

    expect(generateBrokerPlistLegacy).toHaveBeenCalledWith({
      brokerBinary: '/custom/broker',
      configPath: '/custom/config.json',
      socketPath: '/custom/socket.sock',
    });
  });
});

/* ================================================================== */
/*  NEW TESTS -- async functions                                       */
/* ================================================================== */

describe('installLaunchDaemon', () => {
  it('writes plist content and sets permissions when called with a string', async () => {
    const plistContent = '<plist>TEST</plist>';
    const result = await installLaunchDaemon(plistContent);

    expect(result.success).toBe(true);
    expect(result.plistPath).toBe(PLIST_PATH);
    expect(result.loaded).toBe(true);
    expect(result.message).toContain('LaunchDaemon installed');

    // Verify the exec calls: tee, chown, chmod, bootout, bootstrap
    expect(mockExecAsync).toHaveBeenCalledTimes(5);
    expect(mockExecAsync.mock.calls[0][0]).toContain('sudo tee');
    expect(mockExecAsync.mock.calls[0][0]).toContain(plistContent);
    expect(mockExecAsync.mock.calls[1][0]).toContain('sudo chown root:wheel');
    expect(mockExecAsync.mock.calls[2][0]).toContain('sudo chmod 644');
    expect(mockExecAsync.mock.calls[3][0]).toContain('bootout');
    expect(mockExecAsync.mock.calls[4][0]).toContain('bootstrap');
  });

  it('uses generateBrokerPlistLegacy when called with options object', async () => {
    const opts = { brokerBinary: '/custom/broker' };
    const result = await installLaunchDaemon(opts);

    expect(result.success).toBe(true);
    expect(generateBrokerPlistLegacy).toHaveBeenCalledWith(opts);
    expect(mockExecAsync.mock.calls[0][0]).toContain('LEGACY_CONTENT');
  });

  it('uses generateBrokerPlistLegacy when called with no arguments', async () => {
    const result = await installLaunchDaemon();

    expect(result.success).toBe(true);
    expect(generateBrokerPlistLegacy).toHaveBeenCalledWith(undefined);
  });

  it('returns failure when execAsync throws', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('permission denied'));

    const result = await installLaunchDaemon('<plist/>');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to install LaunchDaemon');
    expect(result.message).toContain('permission denied');
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('loadLaunchDaemon', () => {
  it('bootout then bootstrap and returns success', async () => {
    const result = await loadLaunchDaemon();

    expect(result.success).toBe(true);
    expect(result.message).toBe('LaunchDaemon loaded');

    expect(mockExecAsync).toHaveBeenCalledTimes(2);
    expect(mockExecAsync.mock.calls[0][0]).toContain(`bootout system/${LABEL}`);
    expect(mockExecAsync.mock.calls[1][0]).toContain(`bootstrap system "${PLIST_PATH}"`);
  });

  it('returns failure when bootstrap throws', async () => {
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('bootstrap failed'));

    const result = await loadLaunchDaemon();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to load LaunchDaemon');
    expect(result.message).toContain('bootstrap failed');
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('unloadLaunchDaemon', () => {
  it('unloads and returns success', async () => {
    const result = await unloadLaunchDaemon();

    expect(result.success).toBe(true);
    expect(result.message).toBe('LaunchDaemon unloaded');

    expect(mockExecAsync).toHaveBeenCalledTimes(1);
    expect(mockExecAsync.mock.calls[0][0]).toContain(`sudo launchctl unload "${PLIST_PATH}"`);
  });

  it('returns success with "was not loaded" when error contains "Could not find"', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('Could not find specified service'));

    const result = await unloadLaunchDaemon();

    expect(result.success).toBe(true);
    expect(result.message).toBe('LaunchDaemon was not loaded');
  });

  it('returns failure for other errors', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('unexpected error'));

    const result = await unloadLaunchDaemon();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to unload LaunchDaemon');
    expect(result.message).toContain('unexpected error');
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('uninstallLaunchDaemon', () => {
  it('unloads then removes the plist file', async () => {
    const result = await uninstallLaunchDaemon();

    expect(result.success).toBe(true);
    expect(result.message).toBe('LaunchDaemon uninstalled');

    // unloadLaunchDaemon calls execAsync once (unload), then uninstall calls rm
    expect(mockExecAsync).toHaveBeenCalledTimes(2);
    expect(mockExecAsync.mock.calls[0][0]).toContain('launchctl unload');
    expect(mockExecAsync.mock.calls[1][0]).toContain(`sudo rm -f "${PLIST_PATH}"`);
  });

  it('still removes plist if unload says daemon was not loaded', async () => {
    mockExecAsync
      .mockRejectedValueOnce(new Error('Could not find specified service'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await uninstallLaunchDaemon();

    expect(result.success).toBe(true);
    expect(result.message).toBe('LaunchDaemon uninstalled');
  });

  it('returns failure when rm throws', async () => {
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('rm: permission denied'));

    const result = await uninstallLaunchDaemon();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to uninstall LaunchDaemon');
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('isDaemonRunning', () => {
  it('returns true when grep finds the label', async () => {
    mockExecAsync.mockResolvedValueOnce({
      stdout: `12345\t0\t${LABEL}\n`,
      stderr: '',
    });

    const result = await isDaemonRunning();

    expect(result).toBe(true);
    expect(mockExecAsync.mock.calls[0][0]).toContain(`launchctl list | grep ${LABEL}`);
  });

  it('returns false when grep output is empty', async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await isDaemonRunning();

    expect(result).toBe(false);
  });

  it('returns false when grep output is only whitespace', async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: '   \n  ', stderr: '' });

    const result = await isDaemonRunning();

    expect(result).toBe(false);
  });

  it('returns false when execAsync throws (daemon not loaded)', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('exit code 1'));

    const result = await isDaemonRunning();

    expect(result).toBe(false);
  });
});

describe('getDaemonStatus', () => {
  it('returns installed:false when plist does not exist', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

    const status = await getDaemonStatus();

    expect(status).toEqual({ installed: false, running: false });
    expect(mockAccess).toHaveBeenCalledWith(PLIST_PATH);
    expect(mockExecAsync).not.toHaveBeenCalled();
  });

  it('returns installed:true, running:false when plist exists but launchctl list fails', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockExecAsync.mockRejectedValueOnce(new Error('not running'));

    const status = await getDaemonStatus();

    expect(status.installed).toBe(true);
    expect(status.running).toBe(false);
    expect(status.pid).toBeUndefined();
    expect(status.lastExitStatus).toBeUndefined();
  });

  it('returns running:true with PID and LastExitStatus parsed from launchctl output', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockExecAsync.mockResolvedValueOnce({
      stdout: [
        `LimitLoadToSessionType = System;`,
        `Label = ${LABEL};`,
        `TimeOut = 30;`,
        `OnDemand = false;`,
        `LastExitStatus = 256;`,
        `PID = 42;`,
        `Program = /opt/agenshield/bin/agenshield-broker;`,
      ].join('\n'),
      stderr: '',
    });

    const status = await getDaemonStatus();

    expect(status.installed).toBe(true);
    expect(status.running).toBe(true);
    expect(status.pid).toBe(42);
    expect(status.lastExitStatus).toBe(256);
  });

  it('returns running:true without PID when output has no PID line', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockExecAsync.mockResolvedValueOnce({
      stdout: `Label = ${LABEL};\nLastExitStatus = 0;\n`,
      stderr: '',
    });

    const status = await getDaemonStatus();

    expect(status.installed).toBe(true);
    expect(status.running).toBe(true);
    expect(status.pid).toBeUndefined();
    expect(status.lastExitStatus).toBe(0);
  });

  it('returns running:true without LastExitStatus when output has no exit line', async () => {
    mockAccess.mockResolvedValueOnce(undefined);
    mockExecAsync.mockResolvedValueOnce({
      stdout: `PID = 99;\n`,
      stderr: '',
    });

    const status = await getDaemonStatus();

    expect(status.running).toBe(true);
    expect(status.pid).toBe(99);
    expect(status.lastExitStatus).toBeUndefined();
  });
});

describe('restartDaemon', () => {
  it('unloads then loads and returns success', async () => {
    const result = await restartDaemon();

    expect(result.success).toBe(true);
    expect(result.message).toBe('LaunchDaemon restarted');

    // unload (1 call) + load (2 calls: bootout + bootstrap)
    expect(mockExecAsync).toHaveBeenCalledTimes(3);
    expect(mockExecAsync.mock.calls[0][0]).toContain('launchctl unload');
    expect(mockExecAsync.mock.calls[1][0]).toContain('bootout');
    expect(mockExecAsync.mock.calls[2][0]).toContain('bootstrap');
  });

  it('still succeeds when unload reports "Could not find"', async () => {
    mockExecAsync
      .mockRejectedValueOnce(new Error('Could not find specified service'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await restartDaemon();

    expect(result.success).toBe(true);
    expect(result.message).toBe('LaunchDaemon restarted');
  });

  it('returns success even when load fails internally (load catches its own errors)', async () => {
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })  // unload
      .mockResolvedValueOnce({ stdout: '', stderr: '' })  // bootout
      .mockRejectedValueOnce(new Error('bootstrap kaboom')); // bootstrap

    const result = await restartDaemon();

    // loadLaunchDaemon catches internally and returns {success:false}, which
    // doesn't throw, so restartDaemon sees no exception.
    expect(result.success).toBe(true);
  });
});

describe('fixSocketPermissions', () => {
  it('sets directory permissions, waits for socket, then sets socket permissions', async () => {
    const result = await fixSocketPermissions(mockUserConfig);

    expect(result.success).toBe(true);
    expect(result.message).toBe('Socket permissions configured');

    // Calls: chmod dir, chmod socket, chown socket
    expect(mockExecAsync).toHaveBeenCalledTimes(3);
    expect(mockExecAsync.mock.calls[0][0]).toContain('sudo chmod 2770');
    expect(mockExecAsync.mock.calls[0][0]).toContain('/Users/ash_test_agent/.agenshield/run');
    expect(mockExecAsync.mock.calls[1][0]).toContain('sudo chmod 666');
    expect(mockExecAsync.mock.calls[1][0]).toContain('agenshield.sock');
    expect(mockExecAsync.mock.calls[2][0]).toContain('sudo chown ash_test_broker:ash_test');
  });

  it('uses default config values when no config is provided', async () => {
    const result = await fixSocketPermissions();

    expect(result.success).toBe(true);
    expect(mockExecAsync.mock.calls[0][0]).toContain('/Users/agenshield_agent/.agenshield/run');
    expect(mockExecAsync.mock.calls[2][0]).toContain('ash_default_broker:ash_default');
  });

  it('respects socketDir and socketPath overrides', async () => {
    const result = await fixSocketPermissions(mockUserConfig, {
      socketDir: '/custom/run',
      socketPath: '/custom/run/custom.sock',
    });

    expect(result.success).toBe(true);
    expect(mockExecAsync.mock.calls[0][0]).toContain('sudo chmod 2770 "/custom/run"');
    expect(mockExecAsync.mock.calls[1][0]).toContain('sudo chmod 666 "/custom/run/custom.sock"');
  });

  it('returns failure if socket is not created within retries', async () => {
    jest.useFakeTimers();
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const promise = fixSocketPermissions(mockUserConfig);

    // Advance past all 20 retry intervals (20 x 500ms)
    for (let i = 0; i < 20; i++) {
      await jest.advanceTimersByTimeAsync(500);
    }

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.message).toContain('Broker socket not created after 10s');
    expect(result.message).toContain('broker.error.log');

    jest.useRealTimers();
  });

  it('retries fs.access until the socket appears', async () => {
    jest.useFakeTimers();
    mockAccess
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(undefined);

    const promise = fixSocketPermissions(mockUserConfig);

    // Advance past 3 retry intervals so the 4th attempt succeeds
    for (let i = 0; i < 3; i++) {
      await jest.advanceTimersByTimeAsync(500);
    }

    const result = await promise;

    expect(result.success).toBe(true);
    expect(mockAccess).toHaveBeenCalledTimes(4);

    jest.useRealTimers();
  });

  it('returns failure when chmod throws', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('chmod: operation not permitted'));

    const result = await fixSocketPermissions(mockUserConfig);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to fix socket permissions');
    expect(result.message).toContain('operation not permitted');
    expect(result.error).toBeInstanceOf(Error);
  });
});
