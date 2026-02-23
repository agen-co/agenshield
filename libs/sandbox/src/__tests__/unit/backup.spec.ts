jest.mock('node:fs', () => ({
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  rmSync: jest.fn(),
  renameSync: jest.fn(),
}));

jest.mock('node:os', () => ({
  userInfo: jest.fn().mockReturnValue({ username: 'testuser' }),
  homedir: jest.fn().mockReturnValue('/Users/testuser'),
}));

jest.mock('../../exec/sudo', () => ({
  sudoExec: jest.fn().mockReturnValue({ success: true, output: '' }),
}));

jest.mock('@agenshield/ipc', () => ({
  BACKUP_CONFIG: {
    backupPath: '/etc/agenshield/backup.json',
    configDir: '/etc/agenshield',
    dirMode: 0o755,
    fileMode: 0o600,
  },
  backupConfigPath: jest.fn().mockReturnValue('/Users/testuser/.agenshield/backup.json'),
}));

import { backupExists, loadBackup } from '../../backup/backup';
import { sudoExec } from '../../exec/sudo';

const mockedSudoExec = sudoExec as jest.MockedFunction<typeof sudoExec>;

describe('backupExists', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when backup file exists at new path', () => {
    mockedSudoExec.mockReturnValueOnce({ success: true, output: 'exists' });

    expect(backupExists()).toBe(true);
  });

  it('returns false when no backup exists at either path', () => {
    mockedSudoExec
      .mockReturnValueOnce({ success: false, error: 'not found' })
      .mockReturnValueOnce({ success: false, error: 'not found' });

    expect(backupExists()).toBe(false);
  });

  it('falls back to legacy path when new path does not exist', () => {
    mockedSudoExec
      .mockReturnValueOnce({ success: false, error: 'not found' })
      .mockReturnValueOnce({ success: true, output: 'exists' });

    expect(backupExists()).toBe(true);
    expect(mockedSudoExec).toHaveBeenCalledTimes(2);
  });

  it('uses sudo test -f to check file existence', () => {
    mockedSudoExec.mockReturnValueOnce({ success: true, output: 'exists' });

    backupExists();

    const firstCall = mockedSudoExec.mock.calls[0][0];
    expect(firstCall).toContain('test -f');
    expect(firstCall).toContain('echo "exists"');
  });
});

describe('loadBackup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when sudo cat fails', () => {
    mockedSudoExec
      .mockReturnValueOnce({ success: false, error: 'not found' })
      .mockReturnValueOnce({ success: false, error: 'not found' });

    const result = loadBackup();

    expect(result).toBeNull();
  });

  it('returns null when output is empty', () => {
    mockedSudoExec
      .mockReturnValueOnce({ success: true, output: '' })
      .mockReturnValueOnce({ success: true, output: '' });

    const result = loadBackup();

    expect(result).toBeNull();
  });

  it('returns null on invalid JSON', () => {
    mockedSudoExec.mockReturnValueOnce({
      success: true,
      output: 'not valid json',
    });

    const result = loadBackup();

    expect(result).toBeNull();
  });

  it('returns null for unknown backup version', () => {
    const backup = {
      version: '99.0',
      timestamp: '2024-01-01',
    };
    mockedSudoExec.mockReturnValueOnce({
      success: true,
      output: JSON.stringify(backup),
    });

    // Mock console.error to prevent noise
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const result = loadBackup();

    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });

  it('returns parsed backup on valid version 1.0 data', () => {
    const backup = {
      version: '1.0',
      timestamp: '2024-01-01T00:00:00.000Z',
      originalUser: 'testuser',
      originalUserHome: '/Users/testuser',
      originalInstallation: { method: 'npm' },
      sandboxUser: { username: 'ash_default_agent' },
      migratedPaths: {},
    };
    mockedSudoExec.mockReturnValueOnce({
      success: true,
      output: JSON.stringify(backup),
    });

    const result = loadBackup();

    expect(result).not.toBeNull();
    expect(result!.version).toBe('1.0');
    expect(result!.originalUser).toBe('testuser');
  });

  it('falls back to legacy path when new path cat fails', () => {
    const backup = {
      version: '1.0',
      timestamp: '2024-01-01T00:00:00.000Z',
      originalUser: 'testuser',
      originalUserHome: '/Users/testuser',
      originalInstallation: {},
      sandboxUser: { username: 'test' },
      migratedPaths: {},
    };

    mockedSudoExec
      .mockReturnValueOnce({ success: false, error: 'not found' })
      .mockReturnValueOnce({ success: true, output: JSON.stringify(backup) });

    const result = loadBackup();

    expect(result).not.toBeNull();
    expect(mockedSudoExec).toHaveBeenCalledTimes(2);
  });
});
