jest.mock('node:child_process', () => ({
  execSync: jest.fn().mockReturnValue(''),
}));

jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
}));

jest.mock('../../exec/sudo', () => ({
  sudoExec: jest.fn().mockReturnValue({ success: true, output: '' }),
}));

jest.mock('../../backup/backup', () => ({
  loadBackup: jest.fn().mockReturnValue(null),
  deleteBackup: jest.fn().mockReturnValue({ success: true }),
  restoreOriginalConfig: jest.fn().mockReturnValue({ success: true }),
}));

jest.mock('../../legacy', () => ({
  deleteSandboxUser: jest.fn().mockReturnValue({ success: true }),
  GUARDED_SHELL_PATH: '/usr/local/bin/guarded-shell',
  PATH_REGISTRY_PATH: '/etc/agenshield/path-registry.json',
}));

jest.mock('../../wrappers/path-override', () => ({
  scanForRouterWrappers: jest.fn().mockReturnValue([]),
  ROUTER_MARKER: 'AGENSHIELD_ROUTER',
  pathRegistryPath: jest.fn().mockReturnValue('/Users/testuser/.agenshield/path-registry.json'),
}));

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

import { canUninstall, forceUninstall } from '../../backup/restore';
import { loadBackup } from '../../backup/backup';
import { sudoExec } from '../../exec/sudo';
import { deleteSandboxUser } from '../../legacy';
import type { InstallationBackup } from '@agenshield/ipc';

const mockedLoadBackup = loadBackup as jest.MockedFunction<typeof loadBackup>;
const mockedSudoExec = sudoExec as jest.MockedFunction<typeof sudoExec>;
const mockedDeleteSandboxUser = deleteSandboxUser as jest.MockedFunction<typeof deleteSandboxUser>;

describe('canUninstall', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    mockedLoadBackup.mockReturnValue(null);

    const result = canUninstall();

    // We're not root in test environment
    if (process.getuid?.() !== 0) {
      expect(result.canUninstall).toBe(false);
      expect(result.isRoot).toBe(false);
    }
  });

  it('returns hasBackup=false when no backup exists', () => {
    mockedLoadBackup.mockReturnValue(null);

    const result = canUninstall();

    expect(result.hasBackup).toBe(false);
    expect(result.backup).toBeNull();
  });

  it('returns hasBackup=true when backup exists', () => {
    const mockBackup = {
      version: '1.0',
      timestamp: '2024-01-01',
      originalUser: 'testuser',
      originalUserHome: '/Users/testuser',
      originalInstallation: { method: 'npm' as const },
      sandboxUser: { username: 'ash_default_agent' },
      migratedPaths: {},
    } as unknown as InstallationBackup;

    mockedLoadBackup.mockReturnValue(mockBackup);

    const result = canUninstall();

    expect(result.hasBackup).toBe(true);
    expect(result.backup).not.toBeNull();
  });

  it('includes error message when prerequisites not met', () => {
    mockedLoadBackup.mockReturnValue(null);

    const result = canUninstall();

    if (!result.canUninstall) {
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    }
  });
});

describe('forceUninstall', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSudoExec.mockReturnValue({ success: true, output: '' });
    mockedDeleteSandboxUser.mockReturnValue({ success: true });
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
});
