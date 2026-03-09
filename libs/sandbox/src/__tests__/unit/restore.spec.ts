/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Use `var` for mock holders to avoid TDZ errors with SWC/Jest hoisting.
// ---------------------------------------------------------------------------
var mockExecSync: jest.Mock;
var mockExistsSync: jest.Mock;
var mockReaddirSync: jest.Mock;
var mockSudoExec: jest.Mock;
var mockLoadBackup: jest.Mock;
var mockRestoreOriginalConfig: jest.Mock;
var mockDeleteSandboxUser: jest.Mock;
var mockScanForRouterWrappers: jest.Mock;
var mockPathRegistryPath: jest.Mock;
var mockProcessKill: jest.SpyInstance;

jest.mock('node:child_process', () => {
  mockExecSync = jest.fn().mockReturnValue('');
  return { execSync: mockExecSync };
});

jest.mock('node:fs', () => {
  mockExistsSync = jest.fn().mockReturnValue(false);
  mockReaddirSync = jest.fn().mockReturnValue([]);
  return {
    existsSync: mockExistsSync,
    readFileSync: jest.fn(),
    readdirSync: mockReaddirSync,
  };
});

jest.mock('../../exec/sudo', () => {
  mockSudoExec = jest.fn().mockReturnValue({ success: true, output: '' });
  return { sudoExec: mockSudoExec };
});

jest.mock('../../backup/backup', () => {
  mockLoadBackup = jest.fn().mockReturnValue(null);
  mockRestoreOriginalConfig = jest.fn().mockReturnValue({ success: true });
  return {
    loadBackup: mockLoadBackup,
    deleteBackup: jest.fn().mockReturnValue({ success: true }),
    restoreOriginalConfig: mockRestoreOriginalConfig,
  };
});

jest.mock('../../legacy', () => {
  mockDeleteSandboxUser = jest.fn().mockReturnValue({ success: true });
  return {
    deleteSandboxUser: mockDeleteSandboxUser,
    GUARDED_SHELL_PATH: '/usr/local/bin/guarded-shell',
    PATH_REGISTRY_PATH: '/etc/agenshield/path-registry.json',
  };
});

jest.mock('../../wrappers/path-override', () => {
  mockScanForRouterWrappers = jest.fn().mockReturnValue([]);
  mockPathRegistryPath = jest.fn().mockReturnValue('/Users/testuser/.agenshield/path-registry.json');
  return {
    scanForRouterWrappers: mockScanForRouterWrappers,
    ROUTER_MARKER: 'AGENSHIELD_ROUTER',
    pathRegistryPath: mockPathRegistryPath,
  };
});

jest.mock('@agenshield/ipc', () => ({
  BACKUP_CONFIG: {
    backupPath: '/etc/agenshield/backup.json',
    configDir: '/etc/agenshield',
    dirMode: 0o755,
    fileMode: 0o600,
  },
  DEFAULT_PORT: 5200,
  backupConfigPath: jest.fn().mockReturnValue('/Users/testuser/.agenshield/backup.json'),
}));

import { canUninstall, forceUninstall, restoreInstallation } from '../../backup/restore';
import type { InstallationBackup } from '@agenshield/ipc';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBackup(overrides: Record<string, any> = {}): InstallationBackup {
  return {
    version: '1.0',
    timestamp: '2024-01-01T00:00:00Z',
    originalUser: 'testuser',
    originalUserHome: '/Users/testuser',
    originalInstallation: {
      method: 'npm' as const,
      packagePath: '/usr/local/lib/node_modules/openclaw',
      binaryPath: '/usr/local/bin/openclaw',
      configPath: '/Users/testuser/.openclaw',
      configBackupPath: '/Users/testuser/.openclaw.backup-20240101',
    },
    sandboxUser: {
      username: 'ash_default_agent',
      uid: 502,
      gid: 502,
      homeDir: '/Users/ash_default_agent',
    },
    migratedPaths: {
      packagePath: '/opt/agenshield/package',
      configPath: '/opt/agenshield/config',
      binaryPath: '/opt/agenshield/bin/openclaw',
    },
    ...overrides,
  } as unknown as InstallationBackup;
}

function resetDefaultMocks(): void {
  mockExecSync.mockReturnValue('');
  mockExistsSync.mockReturnValue(false);
  mockReaddirSync.mockReturnValue([]);
  mockSudoExec.mockReturnValue({ success: true, output: '' });
  mockLoadBackup.mockReturnValue(null);
  mockRestoreOriginalConfig.mockReturnValue({ success: true });
  mockDeleteSandboxUser.mockReturnValue({ success: true });
  mockScanForRouterWrappers.mockReturnValue([]);
  mockPathRegistryPath.mockReturnValue('/Users/testuser/.agenshield/path-registry.json');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('canUninstall', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDefaultMocks();
  });

  it('returns correct shape', () => {
    const result = canUninstall();

    expect(result).toHaveProperty('canUninstall');
    expect(result).toHaveProperty('isRoot');
    expect(result).toHaveProperty('hasBackup');
    expect(result).toHaveProperty('backup');
    expect(typeof result.canUninstall).toBe('boolean');
    expect(typeof result.isRoot).toBe('boolean');
    expect(typeof result.hasBackup).toBe('boolean');
  });

  it('returns canUninstall=false when not root', () => {
    mockLoadBackup.mockReturnValue(null);

    const result = canUninstall();

    // We're not root in test environment
    if (process.getuid?.() !== 0) {
      expect(result.canUninstall).toBe(false);
      expect(result.isRoot).toBe(false);
    }
  });

  it('returns hasBackup=false when no backup exists', () => {
    mockLoadBackup.mockReturnValue(null);

    const result = canUninstall();

    expect(result.hasBackup).toBe(false);
    expect(result.backup).toBeNull();
  });

  it('returns hasBackup=true when backup exists', () => {
    const mockBackup = makeBackup();
    mockLoadBackup.mockReturnValue(mockBackup);

    const result = canUninstall();

    expect(result.hasBackup).toBe(true);
    expect(result.backup).not.toBeNull();
  });

  it('includes error message when prerequisites not met', () => {
    mockLoadBackup.mockReturnValue(null);

    const result = canUninstall();

    if (!result.canUninstall) {
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    }
  });

  it('returns canUninstall=false with error when root but no backup', () => {
    mockLoadBackup.mockReturnValue(null);
    const origGetuid = process.getuid;
    process.getuid = (() => 0) as any;

    try {
      const result = canUninstall();
      expect(result.canUninstall).toBe(false);
      expect(result.isRoot).toBe(true);
      expect(result.hasBackup).toBe(false);
      expect(result.error).toContain('No backup found');
    } finally {
      process.getuid = origGetuid;
    }
  });

  it('returns canUninstall=true when root and backup exists', () => {
    mockLoadBackup.mockReturnValue(makeBackup());
    const origGetuid = process.getuid;
    process.getuid = (() => 0) as any;

    try {
      const result = canUninstall();
      expect(result.canUninstall).toBe(true);
      expect(result.isRoot).toBe(true);
      expect(result.hasBackup).toBe(true);
    } finally {
      process.getuid = origGetuid;
    }
  });
});

// ---------------------------------------------------------------------------
// restoreInstallation
// ---------------------------------------------------------------------------

describe('restoreInstallation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDefaultMocks();
    mockProcessKill = jest.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    mockProcessKill.mockRestore();
  });

  // ---- stopDaemon (via restoreInstallation) ----

  describe('stopDaemon step', () => {
    it('handles plist exists path — removes plist and unloads', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/Library/LaunchDaemons/com.agenshield.daemon.plist') return true;
        return false;
      });

      const result = restoreInstallation(makeBackup());

      // Should have called sudoExec to rm and unload the plist
      expect(mockSudoExec).toHaveBeenCalledWith(
        expect.stringContaining('rm -f "/Library/LaunchDaemons/com.agenshield.daemon.plist"')
      );
      expect(mockSudoExec).toHaveBeenCalledWith(
        expect.stringContaining('launchctl unload')
      );
      const stopStep = result.steps.find((s) => s.step === 'stop-daemon');
      expect(stopStep?.success).toBe(true);
    });

    it('handles PID found on port — sends SIGTERM', () => {
      // lsof returns a PID
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('lsof') && !cmd.includes('sudo')) {
          return '12345\n';
        }
        return '';
      });
      // process.kill(pid, 0) throws ESRCH meaning process exited
      mockProcessKill.mockImplementation((pid: number, sig?: string | number) => {
        if (sig === 'SIGTERM') return true;
        if (sig === 0) {
          const err: any = new Error('ESRCH');
          err.code = 'ESRCH';
          throw err;
        }
        return true;
      });

      const result = restoreInstallation(makeBackup());

      const stopStep = result.steps.find((s) => s.step === 'stop-daemon');
      expect(stopStep?.success).toBe(true);
      expect(mockProcessKill).toHaveBeenCalledWith(12345, 'SIGTERM');
    });

    it('handles ESRCH on SIGTERM — process already terminated', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('lsof') && !cmd.includes('sudo')) {
          return '99\n';
        }
        return '';
      });
      mockProcessKill.mockImplementation((_pid: number, sig?: string | number) => {
        if (sig === 'SIGTERM') {
          const err: any = new Error('ESRCH');
          err.code = 'ESRCH';
          throw err;
        }
        return true;
      });

      const result = restoreInstallation(makeBackup());

      const stopStep = result.steps.find((s) => s.step === 'stop-daemon');
      expect(stopStep?.success).toBe(true);
      expect(stopStep?.message).toContain('already terminated');
    });

    it('handles EPERM on SIGTERM — falls back to sudo kill', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('lsof') && !cmd.includes('sudo')) {
          return '101\n';
        }
        return '';
      });
      mockProcessKill.mockImplementation((_pid: number, sig?: string | number) => {
        if (sig === 'SIGTERM') {
          const err: any = new Error('EPERM');
          err.code = 'EPERM';
          throw err;
        }
        // process.kill(pid, 0) should throw ESRCH (process exited after sudo kill)
        if (sig === 0) {
          const err: any = new Error('ESRCH');
          err.code = 'ESRCH';
          throw err;
        }
        return true;
      });

      const result = restoreInstallation(makeBackup());

      expect(mockSudoExec).toHaveBeenCalledWith('kill -9 101');
      const stopStep = result.steps.find((s) => s.step === 'stop-daemon');
      expect(stopStep?.success).toBe(true);
    });

    it('handles no plist and no PID — daemon not installed', () => {
      // All defaults: existsSync false, execSync returns ''
      const result = restoreInstallation(makeBackup());

      const stopStep = result.steps.find((s) => s.step === 'stop-daemon');
      expect(stopStep?.success).toBe(true);
      expect(stopStep?.message).toContain('not installed');
    });
  });

  // ---- findDaemonPidByPort paths ----

  describe('findDaemonPidByPort (via stopDaemon)', () => {
    it('returns PID from non-sudo lsof', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('lsof') && !cmd.includes('sudo')) {
          return '42\n';
        }
        return '';
      });
      mockProcessKill.mockImplementation((_p: number, sig?: string | number) => {
        if (sig === 0) {
          const err: any = new Error('ESRCH');
          err.code = 'ESRCH';
          throw err;
        }
        return true;
      });

      const result = restoreInstallation(makeBackup());
      const stopStep = result.steps.find((s) => s.step === 'stop-daemon');
      expect(stopStep?.message).toContain('42');
    });

    it('falls back to sudo lsof when non-sudo fails', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('lsof') && !cmd.includes('sudo')) {
          throw new Error('lsof failed');
        }
        if (typeof cmd === 'string' && cmd.includes('sudo lsof')) {
          return '77\n';
        }
        return '';
      });
      mockProcessKill.mockImplementation((_p: number, sig?: string | number) => {
        if (sig === 0) {
          const err: any = new Error('ESRCH');
          err.code = 'ESRCH';
          throw err;
        }
        return true;
      });

      const result = restoreInstallation(makeBackup());
      const stopStep = result.steps.find((s) => s.step === 'stop-daemon');
      expect(stopStep?.message).toContain('77');
    });

    it('handles NaN from lsof output', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('lsof') && !cmd.includes('sudo')) {
          return 'not-a-number\n';
        }
        if (typeof cmd === 'string' && cmd.includes('sudo lsof')) {
          return 'also-nan\n';
        }
        return '';
      });

      const result = restoreInstallation(makeBackup());
      const stopStep = result.steps.find((s) => s.step === 'stop-daemon');
      expect(stopStep?.success).toBe(true);
      expect(stopStep?.message).toContain('not installed');
    });

    it('returns null when both lsof calls fail', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('lsof')) {
          throw new Error('lsof failed');
        }
        return '';
      });

      const result = restoreInstallation(makeBackup());
      const stopStep = result.steps.find((s) => s.step === 'stop-daemon');
      expect(stopStep?.success).toBe(true);
      expect(stopStep?.message).toContain('not installed');
    });
  });

  // ---- waitForProcessExit paths ----

  describe('waitForProcessExit (via stopDaemon)', () => {
    it('returns true when process exits immediately after SIGTERM', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('lsof') && !cmd.includes('sudo')) {
          return '200\n';
        }
        return '';
      });
      mockProcessKill.mockImplementation((_p: number, sig?: string | number) => {
        if (sig === 'SIGTERM') return true;
        // Process already exited
        if (sig === 0) {
          const err: any = new Error('ESRCH');
          err.code = 'ESRCH';
          throw err;
        }
        return true;
      });

      const result = restoreInstallation(makeBackup());
      const stopStep = result.steps.find((s) => s.step === 'stop-daemon');
      expect(stopStep?.success).toBe(true);
      expect(stopStep?.message).toContain('200');
    });

    it('escalates to SIGKILL when process does not exit after SIGTERM', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('lsof') && !cmd.includes('sudo')) {
          return '300\n';
        }
        return '';
      });

      // Fake time so the polling loop times out quickly
      const origDateNow = Date.now;
      var fakeTime = 0;
      Date.now = () => {
        fakeTime += 6000; // Jump past the 5000ms timeout immediately
        return fakeTime;
      };

      try {
        var sigkillSent = false;
        mockProcessKill.mockImplementation((_p: number, sig?: string | number) => {
          if (sig === 'SIGTERM') return true;
          if (sig === 'SIGKILL') {
            sigkillSent = true;
            return true;
          }
          if (sig === 0) {
            // After SIGKILL, process exits
            if (sigkillSent) {
              const err: any = new Error('ESRCH');
              err.code = 'ESRCH';
              throw err;
            }
            return true; // still alive during SIGTERM phase
          }
          return true;
        });

        const result = restoreInstallation(makeBackup());
        const stopStep = result.steps.find((s) => s.step === 'stop-daemon');
        expect(stopStep?.success).toBe(true);
        expect(sigkillSent).toBe(true);
      } finally {
        Date.now = origDateNow;
      }
    });

    it('uses sudo kill -9 as last resort when process never exits', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('lsof') && !cmd.includes('sudo')) {
          return '400\n';
        }
        return '';
      });

      // Fake time so polling loops timeout
      const origDateNow = Date.now;
      var fakeTime = 0;
      Date.now = () => {
        fakeTime += 10000; // Jump past all timeouts
        return fakeTime;
      };

      try {
        mockProcessKill.mockImplementation((_p: number, sig?: string | number) => {
          if (sig === 'SIGTERM') return true;
          if (sig === 'SIGKILL') return true;
          if (sig === 0) return true; // always alive
          return true;
        });

        const result = restoreInstallation(makeBackup());
        const stopStep = result.steps.find((s) => s.step === 'stop-daemon');
        expect(stopStep?.success).toBe(true);

        // Should have called sudoExec with kill -9 as last resort (line 146)
        expect(mockSudoExec).toHaveBeenCalledWith('kill -9 400');
      } finally {
        Date.now = origDateNow;
      }
    });

    it('handles SIGKILL throwing (process already gone)', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('lsof') && !cmd.includes('sudo')) {
          return '500\n';
        }
        return '';
      });

      const origDateNow = Date.now;
      var fakeTime = 0;
      Date.now = () => {
        fakeTime += 6000;
        return fakeTime;
      };

      try {
        mockProcessKill.mockImplementation((_p: number, sig?: string | number) => {
          if (sig === 'SIGTERM') return true;
          if (sig === 'SIGKILL') {
            // Process already gone when we try to SIGKILL
            const err: any = new Error('ESRCH');
            err.code = 'ESRCH';
            throw err;
          }
          if (sig === 0) return true; // alive during poll
          return true;
        });

        const result = restoreInstallation(makeBackup());
        const stopStep = result.steps.find((s) => s.step === 'stop-daemon');
        expect(stopStep?.success).toBe(true);
      } finally {
        Date.now = origDateNow;
      }
    });
  });

  // ---- stopBrokerDaemon ----

  describe('stopBrokerDaemon step', () => {
    it('handles plist exists — removes and unloads', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/Library/LaunchDaemons/com.agenshield.broker.plist') return true;
        return false;
      });

      const result = restoreInstallation(makeBackup());

      const brokerStep = result.steps.find((s) => s.step === 'stop-broker');
      expect(brokerStep?.success).toBe(true);
      expect(brokerStep?.message).toContain('stopped');
    });

    it('handles plist not found', () => {
      const result = restoreInstallation(makeBackup());

      const brokerStep = result.steps.find((s) => s.step === 'stop-broker');
      expect(brokerStep?.success).toBe(true);
      expect(brokerStep?.message).toContain('not installed');
    });
  });

  // ---- killUserProcesses ----

  describe('killUserProcesses step', () => {
    it('kills processes for sandbox user', () => {
      const result = restoreInstallation(makeBackup());

      const killStep = result.steps.find(
        (s) => s.step === 'kill-processes' && s.message.includes('ash_default_agent')
      );
      expect(killStep).toBeDefined();
      expect(killStep?.success).toBe(true);
    });

    it('kills broker user processes when username ends with _agent', () => {
      const result = restoreInstallation(makeBackup());

      const brokerKillStep = result.steps.find(
        (s) => s.step === 'kill-processes' && s.message.includes('ash_default_broker')
      );
      expect(brokerKillStep).toBeDefined();
      expect(brokerKillStep?.success).toBe(true);
    });

    it('always returns success even if sudoExec throws on pkill', () => {
      // Only throw for pkill commands — other sudoExec calls must still succeed
      mockSudoExec.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('pkill')) {
          throw new Error('pkill failed');
        }
        return { success: true, output: '' };
      });

      const result = restoreInstallation(makeBackup());

      // killUserProcesses catches all errors and returns success
      const killStep = result.steps.find((s) => s.step === 'kill-processes');
      expect(killStep?.success).toBe(true);
    });
  });

  // ---- restoreConfig ----

  describe('restoreConfig step', () => {
    it('skips when no configBackupPath', () => {
      const backup = makeBackup({
        originalInstallation: {
          method: 'npm' as const,
          packagePath: '/usr/local/lib/node_modules/openclaw',
        },
      });

      const result = restoreInstallation(backup);

      const configStep = result.steps.find((s) => s.step === 'restore-config');
      expect(configStep?.success).toBe(true);
      expect(configStep?.message).toContain('No config backup');
    });

    it('skips when backup path does not exist on disk', () => {
      // existsSync returns false for all paths
      const result = restoreInstallation(makeBackup());

      const configStep = result.steps.find((s) => s.step === 'restore-config');
      expect(configStep?.success).toBe(true);
      expect(configStep?.message).toContain('not found');
    });

    it('calls restoreOriginalConfig when backup exists', () => {
      const backup = makeBackup();
      mockExistsSync.mockImplementation((p: string) => {
        if (p === backup.originalInstallation.configBackupPath) return true;
        return false;
      });

      const result = restoreInstallation(backup);

      const configStep = result.steps.find((s) => s.step === 'restore-config');
      expect(configStep?.success).toBe(true);
      expect(configStep?.message).toContain('restored');
      expect(mockRestoreOriginalConfig).toHaveBeenCalled();
    });

    it('returns failure when restoreOriginalConfig fails', () => {
      const backup = makeBackup();
      mockExistsSync.mockImplementation((p: string) => {
        if (p === backup.originalInstallation.configBackupPath) return true;
        return false;
      });
      mockRestoreOriginalConfig.mockReturnValue({ success: false, error: 'copy error' });

      const result = restoreInstallation(backup);

      const configStep = result.steps.find((s) => s.step === 'restore-config');
      expect(configStep?.success).toBe(false);
      expect(configStep?.error).toBe('copy error');
    });

    it('uses originalUserHome when configPath is undefined', () => {
      const backup = makeBackup({
        originalInstallation: {
          method: 'npm' as const,
          packagePath: '/usr/local/lib/node_modules/openclaw',
          configBackupPath: '/tmp/backup-config',
          // configPath intentionally omitted
        },
      });
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/tmp/backup-config') return true;
        return false;
      });

      restoreInstallation(backup);

      expect(mockRestoreOriginalConfig).toHaveBeenCalledWith(
        '/tmp/backup-config',
        expect.stringContaining('.openclaw')
      );
    });
  });

  // ---- restorePackage ----

  describe('restorePackage step', () => {
    it('returns success for npm method (package not moved)', () => {
      const result = restoreInstallation(makeBackup());

      const pkgStep = result.steps.find((s) => s.step === 'restore-package');
      expect(pkgStep?.success).toBe(true);
      expect(pkgStep?.message).toContain('npm');
    });

    it('returns success for git method when packagePath exists', () => {
      const backup = makeBackup({
        originalInstallation: {
          method: 'git' as const,
          packagePath: '/Users/testuser/openclaw-git',
        },
      });
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/Users/testuser/openclaw-git') return true;
        return false;
      });

      const result = restoreInstallation(backup);

      const pkgStep = result.steps.find((s) => s.step === 'restore-package');
      expect(pkgStep?.success).toBe(true);
      expect(pkgStep?.message).toContain('Git package');
    });

    it('returns success for git method when packagePath missing', () => {
      const backup = makeBackup({
        originalInstallation: {
          method: 'git' as const,
          packagePath: '/nonexistent/path',
        },
      });

      const result = restoreInstallation(backup);

      const pkgStep = result.steps.find((s) => s.step === 'restore-package');
      expect(pkgStep?.success).toBe(true);
      expect(pkgStep?.message).toContain('Package location verified');
    });
  });

  // ---- deleteUser ----

  describe('deleteUser step', () => {
    it('succeeds when deleteSandboxUser succeeds', () => {
      const result = restoreInstallation(makeBackup());

      const deleteStep = result.steps.find(
        (s) => s.step === 'delete-user' && s.message.includes('ash_default_agent')
      );
      expect(deleteStep?.success).toBe(true);
    });

    it('short-circuits when deleteUser fails', () => {
      mockDeleteSandboxUser.mockReturnValue({ success: false, error: 'user locked' });

      const result = restoreInstallation(makeBackup());

      expect(result.success).toBe(false);
      expect(result.error).toBe('user locked');
      // Verify no further steps run after the failure
      const verifyStep = result.steps.find((s) => s.step === 'verify');
      expect(verifyStep).toBeUndefined();
    });
  });

  // ---- broker user deletion ----

  describe('broker user deletion', () => {
    it('deletes broker user when agent username ends with _agent', () => {
      const result = restoreInstallation(makeBackup());

      // deleteSandboxUser should be called for both agent and broker
      expect(mockDeleteSandboxUser).toHaveBeenCalledWith('ash_default_agent', { removeHomeDir: true });
      expect(mockDeleteSandboxUser).toHaveBeenCalledWith('ash_default_broker', { removeHomeDir: true });
    });

    it('does not attempt broker deletion when username does not end with _agent', () => {
      const backup = makeBackup({
        sandboxUser: { username: 'ash_custom', uid: 502, gid: 502, homeDir: '/Users/ash_custom' },
      });

      const result = restoreInstallation(backup);

      // Only the primary user should be deleted
      expect(mockDeleteSandboxUser).toHaveBeenCalledWith('ash_custom', { removeHomeDir: true });
      expect(mockDeleteSandboxUser).not.toHaveBeenCalledWith(
        expect.stringContaining('_broker'),
        expect.anything()
      );
    });

    it('reports broker deletion failure as a step', () => {
      var callCount = 0;
      mockDeleteSandboxUser.mockImplementation((username: string) => {
        callCount++;
        if (username.includes('broker')) {
          return { success: false, error: 'broker user busy' };
        }
        return { success: true };
      });

      const result = restoreInstallation(makeBackup());

      const brokerDeleteStep = result.steps.find(
        (s) => s.step === 'delete-user' && s.message.includes('broker')
      );
      expect(brokerDeleteStep).toBeDefined();
    });
  });

  // ---- removeGuardedShell ----

  describe('removeGuardedShell step', () => {
    it('removes shell entries from /etc/shells', () => {
      const result = restoreInstallation(makeBackup());

      const shellStep = result.steps.find((s) => s.step === 'remove-shell');
      expect(shellStep?.success).toBe(true);
      expect(mockSudoExec).toHaveBeenCalledWith(
        expect.stringContaining('/usr/local/bin/guarded-shell')
      );
      expect(mockSudoExec).toHaveBeenCalledWith(
        expect.stringContaining('.agenshield/bin/guarded-shell')
      );
    });

    it('removes guarded shell binary when it exists', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/usr/local/bin/guarded-shell') return true;
        return false;
      });

      const result = restoreInstallation(makeBackup());

      const shellStep = result.steps.find((s) => s.step === 'remove-shell');
      expect(shellStep?.success).toBe(true);
      expect(mockSudoExec).toHaveBeenCalledWith('rm -f "/usr/local/bin/guarded-shell"');
    });

    it('returns failure when rm fails for guarded shell', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/usr/local/bin/guarded-shell') return true;
        return false;
      });
      mockSudoExec.mockImplementation((cmd: string) => {
        if (cmd.includes('rm -f "/usr/local/bin/guarded-shell"')) {
          return { success: false, error: 'permission denied' };
        }
        return { success: true, output: '' };
      });

      const result = restoreInstallation(makeBackup());

      const shellStep = result.steps.find((s) => s.step === 'remove-shell');
      expect(shellStep?.success).toBe(false);
      expect(shellStep?.error).toBe('permission denied');
    });
  });

  // ---- removeRouterWrappers ----

  describe('removeRouterWrappers step', () => {
    it('reports no wrappers found', () => {
      const result = restoreInstallation(makeBackup());

      const routerStep = result.steps.find(
        (s) => s.step === 'cleanup' && s.message.includes('router')
      );
      expect(routerStep?.success).toBe(true);
      expect(routerStep?.message).toContain('No PATH router');
    });

    it('restores backup when wrapper has backup file', () => {
      mockScanForRouterWrappers.mockReturnValue(['openclaw']);
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/usr/local/bin/.openclaw.agenshield-backup') return true;
        return false;
      });

      const result = restoreInstallation(makeBackup());

      expect(mockSudoExec).toHaveBeenCalledWith(
        'mv "/usr/local/bin/.openclaw.agenshield-backup" "/usr/local/bin/openclaw"'
      );
    });

    it('removes wrapper when no backup exists', () => {
      mockScanForRouterWrappers.mockReturnValue(['openclaw']);

      const result = restoreInstallation(makeBackup());

      expect(mockSudoExec).toHaveBeenCalledWith('rm -f "/usr/local/bin/openclaw"');
    });

    it('collects errors from wrapper remove operations', () => {
      mockScanForRouterWrappers.mockReturnValue(['bin1', 'bin2']);
      mockSudoExec.mockImplementation((cmd: string) => {
        if (cmd.includes('rm -f "/usr/local/bin/bin1"')) {
          return { success: false, error: 'rm failed for bin1', output: '' };
        }
        return { success: true, output: '' };
      });

      const result = restoreInstallation(makeBackup());

      const routerStep = result.steps.find(
        (s) => s.step === 'cleanup' && s.message.includes('partial')
      );
      expect(routerStep).toBeDefined();
      expect(routerStep?.message).toContain('bin1');
    });

    it('collects errors from wrapper restore (mv) operations', () => {
      mockScanForRouterWrappers.mockReturnValue(['mybin']);
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/usr/local/bin/.mybin.agenshield-backup') return true;
        return false;
      });
      mockSudoExec.mockImplementation((cmd: string) => {
        if (cmd.includes('mv "/usr/local/bin/.mybin.agenshield-backup"')) {
          return { success: false, error: 'mv failed', output: '' };
        }
        return { success: true, output: '' };
      });

      const result = restoreInstallation(makeBackup());

      const routerStep = result.steps.find(
        (s) => s.step === 'cleanup' && s.message.includes('partial')
      );
      expect(routerStep).toBeDefined();
      expect(routerStep?.message).toContain('mybin');
    });

    it('cleans up path registries', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/Users/testuser/.agenshield/path-registry.json') return true;
        if (p === '/etc/agenshield/path-registry.json') return true;
        return false;
      });

      restoreInstallation(makeBackup());

      expect(mockSudoExec).toHaveBeenCalledWith(
        'rm -f "/Users/testuser/.agenshield/path-registry.json"'
      );
      expect(mockSudoExec).toHaveBeenCalledWith(
        'rm -f "/etc/agenshield/path-registry.json"'
      );
    });
  });

  // ---- cleanup ----

  describe('cleanup step', () => {
    it('removes existing paths', () => {
      const originalHome = process.env['HOME'];
      process.env['HOME'] = '/Users/testuser';

      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/etc/agenshield') return true;
        if (p === '/opt/agenshield') return true;
        return false;
      });

      const result = restoreInstallation(makeBackup());

      expect(mockSudoExec).toHaveBeenCalledWith('rm -rf "/etc/agenshield"');
      expect(mockSudoExec).toHaveBeenCalledWith('rm -rf "/opt/agenshield"');

      process.env['HOME'] = originalHome;
    });

    it('cleans up sudoers files', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/etc/sudoers.d') return true;
        return false;
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === '/etc/sudoers.d') return ['agenshield-openclaw', 'other-file'];
        return [];
      });

      restoreInstallation(makeBackup());

      expect(mockSudoExec).toHaveBeenCalledWith(
        'rm -f "/etc/sudoers.d/agenshield-openclaw"'
      );
      // Should not remove non-agenshield files
      expect(mockSudoExec).not.toHaveBeenCalledWith(
        expect.stringContaining('other-file')
      );
    });

    it('cleans up per-target plists in /Library/LaunchDaemons', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/Library/LaunchDaemons') return true;
        return false;
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === '/Library/LaunchDaemons') {
          return ['com.agenshield.broker.claudecode.plist', 'com.apple.something.plist'];
        }
        return [];
      });

      restoreInstallation(makeBackup());

      expect(mockSudoExec).toHaveBeenCalledWith(
        'launchctl bootout system/com.agenshield.broker.claudecode 2>/dev/null || true'
      );
      expect(mockSudoExec).toHaveBeenCalledWith(
        expect.stringContaining('rm -f "/Library/LaunchDaemons/com.agenshield.broker.claudecode.plist"')
      );
    });

    it('reports errors when cleanup fails', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/opt/agenshield') return true;
        return false;
      });
      mockSudoExec.mockImplementation((cmd: string) => {
        if (cmd.includes('/opt/agenshield')) {
          return { success: false, error: 'busy', output: '' };
        }
        return { success: true, output: '' };
      });

      const result = restoreInstallation(makeBackup());

      const cleanupStep = result.steps.find(
        (s) => s.step === 'cleanup' && s.message === 'Some cleanup failed'
      );
      expect(cleanupStep?.success).toBe(false);
      expect(cleanupStep?.error).toContain('busy');
    });

    it('handles errors from sudoers cleanup gracefully', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/etc/sudoers.d') return true;
        return false;
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === '/etc/sudoers.d') throw new Error('read error');
        return [];
      });

      // Should not throw
      const result = restoreInstallation(makeBackup());
      expect(result.success).toBe(true);
    });

    it('handles sudoers rm failure', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/etc/sudoers.d') return true;
        return false;
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === '/etc/sudoers.d') return ['agenshield-test'];
        return [];
      });
      mockSudoExec.mockImplementation((cmd: string) => {
        if (cmd.includes('sudoers.d/agenshield-test')) {
          return { success: false, error: 'sudoers perm denied', output: '' };
        }
        return { success: true, output: '' };
      });

      const result = restoreInstallation(makeBackup());

      // Should report the error but not crash
      const cleanupStep = result.steps.find(
        (s) => s.step === 'cleanup' && s.error?.includes('sudoers')
      );
      expect(cleanupStep).toBeDefined();
    });

    it('handles plist rm failure', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/Library/LaunchDaemons') return true;
        return false;
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p === '/Library/LaunchDaemons') return ['com.agenshield.daemon.plist'];
        return [];
      });
      mockSudoExec.mockImplementation((cmd: string) => {
        if (cmd.includes('rm -f "/Library/LaunchDaemons/com.agenshield.daemon.plist"')) {
          return { success: false, error: 'plist rm failed', output: '' };
        }
        return { success: true, output: '' };
      });

      const result = restoreInstallation(makeBackup());
      const cleanupStep = result.steps.find(
        (s) => s.step === 'cleanup' && s.error?.includes('plist rm failed')
      );
      expect(cleanupStep).toBeDefined();
    });
  });

  // ---- verify ----

  describe('verify step', () => {
    it('verifies binary when it exists and runs successfully', () => {
      const backup = makeBackup();
      mockExistsSync.mockImplementation((p: string) => {
        if (p === backup.originalInstallation.binaryPath) return true;
        return false;
      });
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('--version')) {
          return 'openclaw v1.2.3\n';
        }
        return '';
      });

      const result = restoreInstallation(backup);

      const verifyStep = result.steps.find((s) => s.step === 'verify');
      expect(verifyStep?.success).toBe(true);
      expect(verifyStep?.message).toContain('v1.2.3');
    });

    it('falls back to plain openclaw command for npm method', () => {
      const backup = makeBackup({
        originalInstallation: {
          method: 'npm' as const,
          packagePath: '/usr/local/lib/node_modules/openclaw',
          // binaryPath intentionally omitted
        },
      });

      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd === 'openclaw --version') {
          return 'openclaw v2.0.0\n';
        }
        return '';
      });

      const result = restoreInstallation(backup);

      const verifyStep = result.steps.find((s) => s.step === 'verify');
      expect(verifyStep?.success).toBe(true);
      expect(verifyStep?.message).toContain('v2.0.0');
    });

    it('returns binary not found when no binaryPath and not npm', () => {
      const backup = makeBackup({
        originalInstallation: {
          method: 'git' as const,
          packagePath: '/Users/testuser/openclaw',
          // binaryPath intentionally omitted
        },
      });

      const result = restoreInstallation(backup);

      const verifyStep = result.steps.find((s) => s.step === 'verify');
      expect(verifyStep?.success).toBe(true);
      expect(verifyStep?.message).toContain('binary path not found');
    });

    it('handles exec failure gracefully', () => {
      const backup = makeBackup();
      mockExistsSync.mockImplementation((p: string) => {
        if (p === backup.originalInstallation.binaryPath) return true;
        return false;
      });
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('--version')) {
          throw new Error('command not found');
        }
        return '';
      });

      const result = restoreInstallation(backup);

      const verifyStep = result.steps.find((s) => s.step === 'verify');
      expect(verifyStep?.success).toBe(true);
      expect(verifyStep?.message).toContain('Could not verify');
    });
  });

  // ---- full flow ----

  describe('full flow', () => {
    it('calls onProgress for each step', () => {
      const progressSteps: string[] = [];

      restoreInstallation(makeBackup(), (progress) => {
        progressSteps.push(progress.step);
      });

      expect(progressSteps).toContain('stop-daemon');
      expect(progressSteps).toContain('stop-broker');
      expect(progressSteps).toContain('kill-processes');
      expect(progressSteps).toContain('restore-config');
      expect(progressSteps).toContain('restore-package');
      expect(progressSteps).toContain('delete-user');
    });

    it('skips kill-processes when no sandboxUser.username', () => {
      const backup = makeBackup({
        sandboxUser: { username: '', uid: 0, gid: 0, homeDir: '' },
      });

      const result = restoreInstallation(backup);

      const killStep = result.steps.find((s) => s.step === 'kill-processes');
      expect(killStep).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// forceUninstall
// ---------------------------------------------------------------------------

describe('forceUninstall', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDefaultMocks();
    mockProcessKill = jest.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    mockProcessKill.mockRestore();
  });

  it('calls steps in order and returns result', () => {
    const progressCalls: string[] = [];
    const onProgress = (progress: { step: string; message: string }) => {
      progressCalls.push(progress.step);
    };

    const result = forceUninstall(onProgress);

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('steps');
    expect(Array.isArray(result.steps)).toBe(true);
    expect(result.success).toBe(true);
  });

  it('returns steps with success status', () => {
    const result = forceUninstall();

    for (const step of result.steps) {
      expect(step).toHaveProperty('step');
      expect(step).toHaveProperty('success');
      expect(step).toHaveProperty('message');
    }
  });

  it('includes verify step at the end', () => {
    const result = forceUninstall();

    const lastStep = result.steps[result.steps.length - 1];
    expect(lastStep.step).toBe('verify');
  });

  it('includes daemon stop step', () => {
    const result = forceUninstall();

    const stopStep = result.steps.find((s) => s.step === 'stop-daemon');
    expect(stopStep).toBeDefined();
  });

  it('includes guarded shell removal', () => {
    const result = forceUninstall();

    const shellStep = result.steps.find((s) => s.message.includes('Guarded shell'));
    expect(shellStep).toBeDefined();
  });

  it('reports progress via callback', () => {
    const progressMessages: string[] = [];

    forceUninstall((progress) => {
      progressMessages.push(progress.message);
    });

    expect(progressMessages.length).toBeGreaterThan(0);
  });

  it('discovers and deletes sandbox users', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('dscl . -list /Users')) {
        return 'root\ntestuser\nash_default_agent\nash_default_broker\n';
      }
      if (typeof cmd === 'string' && cmd.includes('dscl . -list /Groups')) {
        return 'staff\nash_default_sock\n';
      }
      return '';
    });

    const result = forceUninstall();

    // Should have kill-processes and delete-user steps for discovered users
    const killSteps = result.steps.filter((s) => s.step === 'kill-processes');
    expect(killSteps.length).toBeGreaterThanOrEqual(2);
    const deleteSteps = result.steps.filter((s) => s.step === 'delete-user');
    expect(deleteSteps.length).toBeGreaterThanOrEqual(2);
  });

  it('reports no sandbox users found', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('dscl . -list /Users')) {
        return 'root\ntestuser\n';
      }
      return '';
    });

    const result = forceUninstall();

    const noUsersStep = result.steps.find(
      (s) => s.step === 'delete-user' && s.message.includes('No sandbox users')
    );
    expect(noUsersStep).toBeDefined();
  });

  it('handles dscl failure for users gracefully', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('dscl')) {
        throw new Error('dscl failed');
      }
      return '';
    });

    const result = forceUninstall();
    expect(result.success).toBe(true);
  });

  it('discovers and deletes socket groups', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('dscl . -list /Users')) {
        return 'root\n';
      }
      if (typeof cmd === 'string' && cmd.includes('dscl . -list /Groups')) {
        return 'staff\nash_sock_group\n';
      }
      return '';
    });

    const result = forceUninstall();

    expect(mockSudoExec).toHaveBeenCalledWith('dscl . -delete /Groups/ash_sock_group');
  });

  it('handles socket group deletion failure as non-critical', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('dscl . -list /Users')) {
        return 'root\n';
      }
      if (typeof cmd === 'string' && cmd.includes('dscl . -list /Groups')) {
        return 'ash_mygroup\n';
      }
      return '';
    });
    mockSudoExec.mockImplementation((cmd: string) => {
      if (cmd.includes('dscl . -delete /Groups/ash_mygroup')) {
        return { success: false, error: 'group locked', output: '' };
      }
      return { success: true, output: '' };
    });

    const result = forceUninstall();

    const groupStep = result.steps.find(
      (s) => s.step === 'cleanup' && s.message.includes('ash_mygroup')
    );
    expect(groupStep?.success).toBe(true); // Non-critical
  });

  it('cleans up sudoers files first', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === '/etc/sudoers.d') return true;
      return false;
    });
    mockReaddirSync.mockImplementation((p: string) => {
      if (p === '/etc/sudoers.d') return ['agenshield-target1'];
      return [];
    });

    forceUninstall();

    expect(mockSudoExec).toHaveBeenCalledWith(
      'rm -f "/etc/sudoers.d/agenshield-target1"'
    );
  });

  it('cleans up agenshield plists in /Library/LaunchDaemons', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === '/Library/LaunchDaemons') return true;
      return false;
    });
    mockReaddirSync.mockImplementation((p: string) => {
      if (p === '/Library/LaunchDaemons') {
        return ['com.agenshield.broker.target1.plist'];
      }
      return [];
    });

    forceUninstall();

    expect(mockSudoExec).toHaveBeenCalledWith(
      'launchctl bootout system/com.agenshield.broker.target1 2>/dev/null || true'
    );
    expect(mockSudoExec).toHaveBeenCalledWith(
      'rm -f "/Library/LaunchDaemons/com.agenshield.broker.target1.plist"'
    );
  });

  it('retries kill when daemon still on port after plist cleanup', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('lsof') && !cmd.includes('sudo')) {
        return '555\n';
      }
      return '';
    });
    mockProcessKill.mockImplementation((_p: number, sig?: string | number) => {
      if (sig === 0) {
        const err: any = new Error('ESRCH');
        err.code = 'ESRCH';
        throw err;
      }
      return true;
    });

    forceUninstall();

    // Should have called sudoExec with kill -9 for the remaining PID
    expect(mockSudoExec).toHaveBeenCalledWith('kill -9 555');
  });

  it('handles deleteSandboxUser failure for discovered users', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('dscl . -list /Users')) {
        return 'ash_failing_agent\n';
      }
      return '';
    });
    mockDeleteSandboxUser.mockReturnValue({ success: false, error: 'delete failed' });

    const result = forceUninstall();

    const deleteStep = result.steps.find(
      (s) => s.step === 'delete-user' && s.message.includes('Failed')
    );
    expect(deleteStep).toBeDefined();
    expect(deleteStep?.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isDaemonPresent / isBrokerPresent (tested indirectly via forceUninstall)
// ---------------------------------------------------------------------------

describe('isDaemonPresent and isBrokerPresent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDefaultMocks();
    mockProcessKill = jest.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    mockProcessKill.mockRestore();
  });

  it('isDaemonPresent returns true when plist exists', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === '/Library/LaunchDaemons/com.agenshield.daemon.plist') return true;
      return false;
    });

    // forceUninstall path exercises isDaemonPresent indirectly by checking for the plist
    // and finding a PID, but we can't call isDaemonPresent directly since it's not exported.
    // Instead, verify it via the stopDaemon path in forceUninstall
    const result = forceUninstall();
    const stopStep = result.steps.find((s) => s.step === 'stop-daemon');
    expect(stopStep).toBeDefined();
  });

  it('isDaemonPresent returns true when process found on port', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('lsof') && !cmd.includes('sudo')) {
        return '999\n';
      }
      return '';
    });
    mockProcessKill.mockImplementation((_p: number, sig?: string | number) => {
      if (sig === 0) {
        const err: any = new Error('ESRCH');
        err.code = 'ESRCH';
        throw err;
      }
      return true;
    });

    const result = forceUninstall();
    // The daemon PID was found and killed
    expect(mockSudoExec).toHaveBeenCalledWith('kill -9 999');
  });
});
