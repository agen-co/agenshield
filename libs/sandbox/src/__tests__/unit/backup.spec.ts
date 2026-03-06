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

import * as fs from 'node:fs';
import {
  backupExists,
  loadBackup,
  saveBackup,
  deleteBackup,
  restoreOriginalConfig,
} from '../../backup/backup';
import { sudoExec } from '../../exec/sudo';

const mockedSudoExec = sudoExec as jest.MockedFunction<typeof sudoExec>;
const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockedWriteFileSync = fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>;
const mockedUnlinkSync = fs.unlinkSync as jest.MockedFunction<typeof fs.unlinkSync>;
const mockedRmSync = fs.rmSync as jest.MockedFunction<typeof fs.rmSync>;
const mockedRenameSync = fs.renameSync as jest.MockedFunction<typeof fs.renameSync>;

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

describe('saveBackup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes temp file and moves it to final location on success', () => {
    // ensureBackupDir: mkdir, chmod, chown all succeed
    mockedSudoExec
      .mockReturnValueOnce({ success: true, output: '' })  // mkdir -p
      .mockReturnValueOnce({ success: true, output: '' })  // chmod dir
      .mockReturnValueOnce({ success: true, output: '' })  // chown dir
      .mockReturnValueOnce({ success: true, output: '' })  // mv temp -> final
      .mockReturnValueOnce({ success: true, output: '' })  // chmod file
      .mockReturnValueOnce({ success: true, output: '' }); // chown file

    const result = saveBackup({
      originalInstallation: { method: 'npm', packagePath: '/usr/local/lib/node_modules/openclaw' },
      sandboxUser: { username: 'ash_default_agent', uid: 501, gid: 501, homeDir: '/Users/ash_default_agent' },
      migratedPaths: { packagePath: '/opt/openclaw', configPath: '/etc/openclaw', binaryPath: '/usr/local/bin/openclaw' },
    });

    expect(result.success).toBe(true);
    // Temp file written
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      '/tmp/agenshield-backup.json',
      expect.stringContaining('"version": "1.0"'),
      { mode: 0o600 },
    );
    // Moved via sudo mv
    const mvCall = mockedSudoExec.mock.calls[3][0];
    expect(mvCall).toContain('mv');
    expect(mvCall).toContain('/tmp/agenshield-backup.json');
    expect(mvCall).toContain('.agenshield/backup.json');
  });

  it('returns failure when ensureBackupDir fails on mkdir', () => {
    mockedSudoExec.mockReturnValueOnce({ success: false, error: 'Permission denied' });

    const result = saveBackup({
      originalInstallation: { method: 'npm', packagePath: '/usr/local/lib' },
      sandboxUser: { username: 'agent', uid: 501, gid: 501, homeDir: '/Users/agent' },
      migratedPaths: { packagePath: '/opt', configPath: '/etc', binaryPath: '/usr/local/bin' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to create backup dir');
  });

  it('returns failure when ensureBackupDir fails on chmod', () => {
    mockedSudoExec
      .mockReturnValueOnce({ success: true, output: '' })  // mkdir -p succeeds
      .mockReturnValueOnce({ success: false, error: 'chmod failed' }); // chmod fails

    const result = saveBackup({
      originalInstallation: { method: 'npm', packagePath: '/usr/local/lib' },
      sandboxUser: { username: 'agent', uid: 501, gid: 501, homeDir: '/Users/agent' },
      migratedPaths: { packagePath: '/opt', configPath: '/etc', binaryPath: '/usr/local/bin' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to set dir permissions');
  });

  it('returns failure when ensureBackupDir fails on chown', () => {
    mockedSudoExec
      .mockReturnValueOnce({ success: true, output: '' })  // mkdir
      .mockReturnValueOnce({ success: true, output: '' })  // chmod
      .mockReturnValueOnce({ success: false, error: 'chown failed' }); // chown fails

    const result = saveBackup({
      originalInstallation: { method: 'npm', packagePath: '/usr/local/lib' },
      sandboxUser: { username: 'agent', uid: 501, gid: 501, homeDir: '/Users/agent' },
      migratedPaths: { packagePath: '/opt', configPath: '/etc', binaryPath: '/usr/local/bin' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to set dir ownership');
  });

  it('returns failure when writeFileSync for temp file throws', () => {
    // ensureBackupDir succeeds
    mockedSudoExec
      .mockReturnValueOnce({ success: true, output: '' })
      .mockReturnValueOnce({ success: true, output: '' })
      .mockReturnValueOnce({ success: true, output: '' });

    mockedWriteFileSync.mockImplementationOnce(() => {
      throw new Error('ENOSPC');
    });

    const result = saveBackup({
      originalInstallation: { method: 'npm', packagePath: '/usr/local/lib' },
      sandboxUser: { username: 'agent', uid: 501, gid: 501, homeDir: '/Users/agent' },
      migratedPaths: { packagePath: '/opt', configPath: '/etc', binaryPath: '/usr/local/bin' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to write temp backup');
  });

  it('returns failure and cleans up temp file when sudo mv fails', () => {
    mockedSudoExec
      .mockReturnValueOnce({ success: true, output: '' })  // mkdir
      .mockReturnValueOnce({ success: true, output: '' })  // chmod dir
      .mockReturnValueOnce({ success: true, output: '' })  // chown dir
      .mockReturnValueOnce({ success: false, error: 'mv failed' }); // mv fails

    const result = saveBackup({
      originalInstallation: { method: 'npm', packagePath: '/usr/local/lib' },
      sandboxUser: { username: 'agent', uid: 501, gid: 501, homeDir: '/Users/agent' },
      migratedPaths: { packagePath: '/opt', configPath: '/etc', binaryPath: '/usr/local/bin' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to install backup');
    // Temp file cleanup attempted
    expect(mockedUnlinkSync).toHaveBeenCalledWith('/tmp/agenshield-backup.json');
  });

  it('returns failure when chmod on final file fails', () => {
    mockedSudoExec
      .mockReturnValueOnce({ success: true, output: '' })  // mkdir
      .mockReturnValueOnce({ success: true, output: '' })  // chmod dir
      .mockReturnValueOnce({ success: true, output: '' })  // chown dir
      .mockReturnValueOnce({ success: true, output: '' })  // mv
      .mockReturnValueOnce({ success: false, error: 'chmod failed' }); // chmod file fails

    const result = saveBackup({
      originalInstallation: { method: 'npm', packagePath: '/usr/local/lib' },
      sandboxUser: { username: 'agent', uid: 501, gid: 501, homeDir: '/Users/agent' },
      migratedPaths: { packagePath: '/opt', configPath: '/etc', binaryPath: '/usr/local/bin' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to set backup permissions');
  });

  it('returns failure when chown on final file fails', () => {
    mockedSudoExec
      .mockReturnValueOnce({ success: true, output: '' })  // mkdir
      .mockReturnValueOnce({ success: true, output: '' })  // chmod dir
      .mockReturnValueOnce({ success: true, output: '' })  // chown dir
      .mockReturnValueOnce({ success: true, output: '' })  // mv
      .mockReturnValueOnce({ success: true, output: '' })  // chmod file
      .mockReturnValueOnce({ success: false, error: 'chown failed' }); // chown file fails

    const result = saveBackup({
      originalInstallation: { method: 'npm', packagePath: '/usr/local/lib' },
      sandboxUser: { username: 'agent', uid: 501, gid: 501, homeDir: '/Users/agent' },
      migratedPaths: { packagePath: '/opt', configPath: '/etc', binaryPath: '/usr/local/bin' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to set backup ownership');
  });

  it('includes correct metadata in backup JSON', () => {
    mockedSudoExec.mockReturnValue({ success: true, output: '' });

    saveBackup({
      originalInstallation: { method: 'git', packagePath: '/opt/openclaw' },
      sandboxUser: { username: 'ash_default_agent', uid: 501, gid: 501, homeDir: '/Users/ash_default_agent' },
      migratedPaths: { packagePath: '/opt', configPath: '/etc', binaryPath: '/usr/local/bin' },
    });

    const writtenContent = mockedWriteFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenContent);

    expect(parsed.version).toBe('1.0');
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.originalUser).toBe('testuser');
    expect(parsed.originalUserHome).toBe('/Users/testuser');
    expect(parsed.originalInstallation.method).toBe('git');
    expect(parsed.sandboxUser.username).toBe('ash_default_agent');
  });
});

describe('deleteBackup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('always returns success', () => {
    mockedSudoExec.mockReturnValue({ success: true, output: '' });

    const result = deleteBackup();

    expect(result.success).toBe(true);
  });

  it('calls sudo rm -f on both new and legacy paths', () => {
    mockedSudoExec.mockReturnValue({ success: true, output: '' });

    deleteBackup();

    expect(mockedSudoExec).toHaveBeenCalledTimes(2);
    const firstCall = mockedSudoExec.mock.calls[0][0];
    const secondCall = mockedSudoExec.mock.calls[1][0];
    expect(firstCall).toContain('rm -f');
    expect(firstCall).toContain('.agenshield/backup.json');
    expect(secondCall).toContain('rm -f');
    expect(secondCall).toContain('/etc/agenshield/backup.json');
  });

  it('returns success even when sudo rm fails', () => {
    mockedSudoExec.mockReturnValue({ success: false, error: 'rm failed' });

    const result = deleteBackup();

    expect(result.success).toBe(true);
  });
});

describe('restoreOriginalConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns failure when backup path does not exist', () => {
    mockedExistsSync.mockReturnValue(false);

    const result = restoreOriginalConfig('/tmp/backup', '/etc/config');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Backup path does not exist');
  });

  it('removes existing target before renaming backup', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      // Both backup and target exist
      return true;
    });

    const result = restoreOriginalConfig('/tmp/backup', '/etc/config');

    expect(result.success).toBe(true);
    expect(mockedRmSync).toHaveBeenCalledWith('/etc/config', { recursive: true });
    expect(mockedRenameSync).toHaveBeenCalledWith('/tmp/backup', '/etc/config');
  });

  it('renames backup to target when target does not exist', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/tmp/backup') return true;
      if (s === '/etc/config') return false;
      return false;
    });

    const result = restoreOriginalConfig('/tmp/backup', '/etc/config');

    expect(result.success).toBe(true);
    expect(mockedRmSync).not.toHaveBeenCalled();
    expect(mockedRenameSync).toHaveBeenCalledWith('/tmp/backup', '/etc/config');
  });

  it('returns failure when rmSync on existing target throws', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedRmSync.mockImplementation(() => {
      throw new Error('EPERM');
    });

    const result = restoreOriginalConfig('/tmp/backup', '/etc/config');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to remove existing config');
  });

  it('returns failure when renameSync throws', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      if (String(p) === '/tmp/backup') return true;
      return false;
    });
    mockedRenameSync.mockImplementation(() => {
      throw new Error('EXDEV: cross-device link not permitted');
    });

    const result = restoreOriginalConfig('/tmp/backup', '/etc/config');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to restore config');
    expect(result.error).toContain('EXDEV');
  });
});
