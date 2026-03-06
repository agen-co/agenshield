/* eslint-disable @typescript-eslint/no-require-imports */

// ---- Mock holders (use `var` to avoid TDZ with SWC/Jest hoisting) ----
var mockSpawnSync: jest.Mock;
var mockExecSync: jest.Mock;
var mockExistsSync: jest.Mock;
var mockWriteFileSync: jest.Mock;
var mockSudoExec: jest.Mock;

jest.mock('node:child_process', () => {
  mockSpawnSync = jest.fn();
  mockExecSync = jest.fn();
  return { spawnSync: mockSpawnSync, execSync: mockExecSync };
});

jest.mock('node:fs', () => {
  mockExistsSync = jest.fn();
  mockWriteFileSync = jest.fn();
  return {
    existsSync: mockExistsSync,
    writeFileSync: mockWriteFileSync,
    readFileSync: jest.fn(),
  };
});

jest.mock('../../exec/sudo', () => {
  mockSudoExec = jest.fn();
  return { sudoExec: mockSudoExec };
});

jest.mock('../../shell/guarded-shell', () => ({
  GUARDED_SHELL_CONTENT: '#!/bin/zsh\n# mock guarded shell content\n',
}));

import {
  GUARDED_SHELL_PATH,
  ZDOT_DIR,
  SHIELD_EXEC_PATH,
  PATH_REGISTRY_PATH,
  ZDOT_ZSHENV_CONTENT,
  SHIELD_EXEC_CONTENT,
  userExistsSync,
  deleteSandboxUser,
  createSandboxUser,
  createGuardedShell,
  backupOriginalConfig,
  generateBrokerPlistLegacy,
} from '../../legacy';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('legacy', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-establish default implementations after clearAllMocks
    mockSpawnSync.mockReturnValue({ status: 1 });
    mockExecSync.mockReturnValue('');
    mockExistsSync.mockReturnValue(false);
    mockWriteFileSync.mockImplementation(() => {});
    mockSudoExec.mockReturnValue({ success: true, output: '' });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  describe('constants', () => {
    it('exports GUARDED_SHELL_PATH', () => {
      expect(GUARDED_SHELL_PATH).toBe('/usr/local/bin/guarded-shell');
    });

    it('exports ZDOT_DIR', () => {
      expect(ZDOT_DIR).toBe('/etc/agenshield/zdot');
    });

    it('exports SHIELD_EXEC_PATH', () => {
      expect(SHIELD_EXEC_PATH).toBe('/opt/agenshield/bin/shield-exec');
    });

    it('exports PATH_REGISTRY_PATH', () => {
      expect(PATH_REGISTRY_PATH).toBe('/etc/agenshield/path-registry.json');
    });

    it('exports ZDOT_ZSHENV_CONTENT as non-empty string', () => {
      expect(typeof ZDOT_ZSHENV_CONTENT).toBe('string');
      expect(ZDOT_ZSHENV_CONTENT.length).toBeGreaterThan(0);
    });

    it('exports SHIELD_EXEC_CONTENT as non-empty string', () => {
      expect(typeof SHIELD_EXEC_CONTENT).toBe('string');
      expect(SHIELD_EXEC_CONTENT.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // userExistsSync
  // -----------------------------------------------------------------------

  describe('userExistsSync', () => {
    it('returns true when dscl status is 0', () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      expect(userExistsSync('testuser')).toBe(true);
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'dscl',
        ['.', '-read', '/Users/testuser'],
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
    });

    it('returns false when dscl status is non-zero', () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      expect(userExistsSync('nonexistent')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // deleteSandboxUser
  // -----------------------------------------------------------------------

  describe('deleteSandboxUser', () => {
    it('returns success when user does not exist', () => {
      // spawnSync returns status 1 by default (user doesn't exist)
      const result = deleteSandboxUser('nobody');
      expect(result).toEqual({ success: true });
    });

    it('deletes user and group when user exists', () => {
      // user exists
      mockSpawnSync.mockReturnValue({ status: 0 });
      // execSync for homeDir throws (key not found)
      mockExecSync.mockImplementation(() => { throw new Error('No such key'); });
      // sudoExec: delete user, delete group
      mockSudoExec
        .mockReturnValueOnce({ success: true, output: '' })  // delete user
        .mockReturnValueOnce({ success: true, output: '' }); // delete group

      const result = deleteSandboxUser('testuser');
      expect(result).toEqual({ success: true });
      expect(mockSudoExec).toHaveBeenCalledWith('dscl . -delete /Users/testuser');
      expect(mockSudoExec).toHaveBeenCalledWith('dscl . -delete /Groups/testuser');
    });

    it('reads home directory from dscl when available', () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      mockExecSync.mockReturnValue('NFSHomeDirectory: /Users/custom_home\n');
      mockSudoExec
        .mockReturnValueOnce({ success: true, output: '' })  // delete user
        .mockReturnValueOnce({ success: true, output: '' }); // delete group

      const result = deleteSandboxUser('testuser');
      expect(result).toEqual({ success: true });
    });

    it('falls back to default homeDir when dscl returns no match', () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      // Return output that doesn't match the regex
      mockExecSync.mockReturnValue('SomeOtherKey: value\n');
      mockSudoExec.mockReturnValue({ success: true, output: '' });

      const result = deleteSandboxUser('testuser');
      expect(result).toEqual({ success: true });
    });

    it('returns failure when delete user fails', () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      mockExecSync.mockImplementation(() => { throw new Error('fail'); });
      mockSudoExec.mockReturnValue({ success: false, error: 'Permission denied' });

      const result = deleteSandboxUser('testuser');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to delete user');
    });

    it('removes home directory when removeHomeDir=true', () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      mockExecSync.mockReturnValue('NFSHomeDirectory: /Users/sandbox_user\n');
      mockSudoExec.mockReturnValue({ success: true, output: '' });

      const result = deleteSandboxUser('sandbox_user', { removeHomeDir: true });
      expect(result).toEqual({ success: true });
      // Should have called rm -rf
      expect(mockSudoExec).toHaveBeenCalledWith('rm -rf "/Users/sandbox_user"');
    });

    it('skips removal for protected paths', () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      mockExecSync.mockReturnValue('NFSHomeDirectory: /var/empty\n');
      mockSudoExec.mockReturnValue({ success: true, output: '' });

      const result = deleteSandboxUser('testuser', { removeHomeDir: true });
      expect(result).toEqual({ success: true });
      // rm -rf should NOT be called for protected path
      const rmCalls = mockSudoExec.mock.calls.filter((c: string[]) => c[0].includes('rm -rf'));
      expect(rmCalls).toHaveLength(0);
    });

    it('warns but succeeds when home directory removal fails', () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      mockExecSync.mockReturnValue('NFSHomeDirectory: /Users/sandbox_user\n');
      mockSudoExec
        .mockReturnValueOnce({ success: true, output: '' })   // delete user
        .mockReturnValueOnce({ success: true, output: '' })   // delete group
        .mockReturnValueOnce({ success: false, error: 'rm failed' }); // rm -rf

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = deleteSandboxUser('sandbox_user', { removeHomeDir: true });

      expect(result).toEqual({ success: true });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Could not remove home directory'));
      warnSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // createSandboxUser
  // -----------------------------------------------------------------------

  describe('createSandboxUser', () => {
    it('returns existing user info when user already exists', () => {
      mockSpawnSync.mockReturnValue({ status: 0 }); // user exists
      mockExecSync
        .mockReturnValueOnce('501\n')   // UniqueID
        .mockReturnValueOnce('501\n');  // PrimaryGroupID

      const result = createSandboxUser({ username: 'existing_user' });
      expect(result.success).toBe(true);
      expect(result.user).toEqual({
        username: 'existing_user',
        uid: 501,
        gid: 501,
        homeDir: '/Users/existing_user',
        shell: '/usr/local/bin/guarded-shell',
      });
    });

    it('returns error when user exists but info read fails', () => {
      mockSpawnSync.mockReturnValue({ status: 0 });
      mockExecSync.mockImplementation(() => { throw new Error('dscl read fail'); });

      const result = createSandboxUser({ username: 'broken_user' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('User exists but could not read info');
    });

    it('creates new user with default config when user does not exist', () => {
      // user does not exist
      mockSpawnSync.mockReturnValue({ status: 1 });
      // getNextUid: returns max uid
      mockExecSync.mockReturnValue('500\n');
      // All sudoExec calls succeed
      mockSudoExec.mockReturnValue({ success: true, output: '' });

      const result = createSandboxUser();
      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user!.username).toBe('openclaw');
      expect(result.user!.uid).toBe(501); // Math.max(501, 500+1)
      expect(result.user!.gid).toBe(501);
      expect(result.user!.homeDir).toBe('/Users/openclaw');
      expect(result.user!.shell).toBe('/usr/local/bin/guarded-shell');
    });

    it('creates user with custom config', () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExecSync.mockReturnValue('600\n');
      mockSudoExec.mockReturnValue({ success: true, output: '' });

      const result = createSandboxUser({
        username: 'custom_user',
        homeDir: '/Users/custom',
        shell: '/bin/zsh',
        realName: 'Custom User',
      });

      expect(result.success).toBe(true);
      expect(result.user!.username).toBe('custom_user');
      expect(result.user!.homeDir).toBe('/Users/custom');
      expect(result.user!.shell).toBe('/bin/zsh');
      expect(result.user!.uid).toBe(601);
    });

    it('getNextUid falls back to 501 when execSync throws', () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      // getNextUid call throws
      mockExecSync.mockImplementation(() => { throw new Error('dscl fail'); });
      mockSudoExec.mockReturnValue({ success: true, output: '' });

      const result = createSandboxUser();
      expect(result.success).toBe(true);
      expect(result.user!.uid).toBe(501);
    });

    it('returns 501 when parsed uid is below 501', () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExecSync.mockReturnValue('100\n'); // low uid
      mockSudoExec.mockReturnValue({ success: true, output: '' });

      const result = createSandboxUser();
      expect(result.success).toBe(true);
      // Math.max(501, 100+1) = 501
      expect(result.user!.uid).toBe(501);
    });

    it('fails on create group step', () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExecSync.mockReturnValue('500\n');
      mockSudoExec.mockReturnValueOnce({ success: false, error: 'group fail' });

      const result = createSandboxUser();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to create group');
    });

    it('fails on set group ID step', () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExecSync.mockReturnValue('500\n');
      mockSudoExec
        .mockReturnValueOnce({ success: true, output: '' })   // create group
        .mockReturnValueOnce({ success: false, error: 'gid fail' }); // set group ID

      const result = createSandboxUser();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to set group ID');
    });

    it('fails on create user step', () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExecSync.mockReturnValue('500\n');
      mockSudoExec
        .mockReturnValueOnce({ success: true, output: '' })   // create group
        .mockReturnValueOnce({ success: true, output: '' })   // set group ID
        .mockReturnValueOnce({ success: false, error: 'user fail' }); // create user

      const result = createSandboxUser();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to create user');
    });

    it('fails on set shell step', () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExecSync.mockReturnValue('500\n');
      mockSudoExec
        .mockReturnValueOnce({ success: true, output: '' })   // create group
        .mockReturnValueOnce({ success: true, output: '' })   // set group ID
        .mockReturnValueOnce({ success: true, output: '' })   // create user
        .mockReturnValueOnce({ success: false, error: 'shell fail' }); // set shell

      const result = createSandboxUser();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to set shell');
    });

    it('fails on set real name step', () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExecSync.mockReturnValue('500\n');
      mockSudoExec
        .mockReturnValueOnce({ success: true, output: '' })   // create group
        .mockReturnValueOnce({ success: true, output: '' })   // set group ID
        .mockReturnValueOnce({ success: true, output: '' })   // create user
        .mockReturnValueOnce({ success: true, output: '' })   // set shell
        .mockReturnValueOnce({ success: false, error: 'name fail' }); // set real name

      const result = createSandboxUser();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to set real name');
    });

    it('fails on set UID step', () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExecSync.mockReturnValue('500\n');
      mockSudoExec
        .mockReturnValueOnce({ success: true, output: '' })   // create group
        .mockReturnValueOnce({ success: true, output: '' })   // set group ID
        .mockReturnValueOnce({ success: true, output: '' })   // create user
        .mockReturnValueOnce({ success: true, output: '' })   // set shell
        .mockReturnValueOnce({ success: true, output: '' })   // set real name
        .mockReturnValueOnce({ success: false, error: 'uid fail' }); // set UID

      const result = createSandboxUser();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to set UID');
    });

    it('fails on set GID step', () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExecSync.mockReturnValue('500\n');
      mockSudoExec
        .mockReturnValueOnce({ success: true, output: '' })   // create group
        .mockReturnValueOnce({ success: true, output: '' })   // set group ID
        .mockReturnValueOnce({ success: true, output: '' })   // create user
        .mockReturnValueOnce({ success: true, output: '' })   // set shell
        .mockReturnValueOnce({ success: true, output: '' })   // set real name
        .mockReturnValueOnce({ success: true, output: '' })   // set UID
        .mockReturnValueOnce({ success: false, error: 'gid fail' }); // set GID

      const result = createSandboxUser();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to set GID');
    });

    it('fails on set home dir step', () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExecSync.mockReturnValue('500\n');
      mockSudoExec
        .mockReturnValueOnce({ success: true, output: '' })   // create group
        .mockReturnValueOnce({ success: true, output: '' })   // set group ID
        .mockReturnValueOnce({ success: true, output: '' })   // create user
        .mockReturnValueOnce({ success: true, output: '' })   // set shell
        .mockReturnValueOnce({ success: true, output: '' })   // set real name
        .mockReturnValueOnce({ success: true, output: '' })   // set UID
        .mockReturnValueOnce({ success: true, output: '' })   // set GID
        .mockReturnValueOnce({ success: false, error: 'homedir fail' }); // set home dir

      const result = createSandboxUser();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to set home dir');
    });

    it('fails on mkdir home dir step', () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExecSync.mockReturnValue('500\n');
      mockSudoExec
        .mockReturnValueOnce({ success: true, output: '' })   // create group
        .mockReturnValueOnce({ success: true, output: '' })   // set group ID
        .mockReturnValueOnce({ success: true, output: '' })   // create user
        .mockReturnValueOnce({ success: true, output: '' })   // set shell
        .mockReturnValueOnce({ success: true, output: '' })   // set real name
        .mockReturnValueOnce({ success: true, output: '' })   // set UID
        .mockReturnValueOnce({ success: true, output: '' })   // set GID
        .mockReturnValueOnce({ success: true, output: '' })   // set home dir
        .mockReturnValueOnce({ success: false, error: 'mkdir fail' }); // mkdir

      const result = createSandboxUser();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to create home dir');
    });

    it('fails on chown step', () => {
      mockSpawnSync.mockReturnValue({ status: 1 });
      mockExecSync.mockReturnValue('500\n');
      mockSudoExec
        .mockReturnValueOnce({ success: true, output: '' })   // create group
        .mockReturnValueOnce({ success: true, output: '' })   // set group ID
        .mockReturnValueOnce({ success: true, output: '' })   // create user
        .mockReturnValueOnce({ success: true, output: '' })   // set shell
        .mockReturnValueOnce({ success: true, output: '' })   // set real name
        .mockReturnValueOnce({ success: true, output: '' })   // set UID
        .mockReturnValueOnce({ success: true, output: '' })   // set GID
        .mockReturnValueOnce({ success: true, output: '' })   // set home dir
        .mockReturnValueOnce({ success: true, output: '' })   // mkdir
        .mockReturnValueOnce({ success: false, error: 'chown fail' }); // chown

      const result = createSandboxUser();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to set ownership');
    });
  });

  // -----------------------------------------------------------------------
  // createGuardedShell
  // -----------------------------------------------------------------------

  describe('createGuardedShell', () => {
    it('succeeds when all steps pass', () => {
      mockSudoExec.mockReturnValue({ success: true, output: '' });

      const result = createGuardedShell();
      expect(result).toEqual({ success: true });
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/tmp/guarded-shell',
        expect.any(String),
        { mode: 0o755 },
      );
      // mv + chmod, chown, grep/echo
      expect(mockSudoExec).toHaveBeenCalledWith(
        expect.stringContaining(`mv /tmp/guarded-shell ${GUARDED_SHELL_PATH}`),
      );
    });

    it('returns failure when writeFileSync throws', () => {
      mockWriteFileSync.mockImplementation(() => { throw new Error('EACCES'); });

      const result = createGuardedShell();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to write temp file');
    });

    it('returns failure when sudoExec mv fails', () => {
      mockSudoExec.mockReturnValue({ success: false, error: 'mv failed' });

      const result = createGuardedShell();
      expect(result.success).toBe(false);
      expect(result.error).toBe('mv failed');
    });
  });

  // -----------------------------------------------------------------------
  // backupOriginalConfig
  // -----------------------------------------------------------------------

  describe('backupOriginalConfig', () => {
    it('returns success (no-op)', () => {
      const result = backupOriginalConfig('/some/path');
      expect(result).toEqual({ success: true });
    });
  });

  // -----------------------------------------------------------------------
  // generateBrokerPlistLegacy
  // -----------------------------------------------------------------------

  describe('generateBrokerPlistLegacy', () => {
    it('generates plist with default options', () => {
      process.env['HOME'] = '/Users/testuser';
      delete process.env['AGENSHIELD_USER_HOME'];
      mockExistsSync.mockReturnValue(false);

      const plist = generateBrokerPlistLegacy();

      expect(plist).toContain('<?xml version="1.0"');
      expect(plist).toContain('<string>com.agenshield.broker</string>');
      expect(plist).toContain('<string>/opt/agenshield/bin/agenshield-broker</string>');
      expect(plist).toContain('/opt/agenshield/config/shield.json');
      expect(plist).toContain('/Users/testuser/.agenshield/run/agenshield.sock');
      expect(plist).toContain('/Users/testuser/.agenshield/logs');
      expect(plist).not.toContain('AssociatedBundleIdentifiers');
    });

    it('generates plist with custom options', () => {
      process.env['HOME'] = '/Users/testuser';
      delete process.env['AGENSHIELD_USER_HOME'];
      mockExistsSync.mockReturnValue(false);

      const plist = generateBrokerPlistLegacy({
        brokerBinary: '/custom/bin/broker',
        configPath: '/custom/config.json',
        socketPath: '/custom/run/broker.sock',
      });

      expect(plist).toContain('<string>/custom/bin/broker</string>');
      expect(plist).toContain('/custom/config.json');
      expect(plist).toContain('/custom/run/broker.sock');
    });

    it('includes AssociatedBundleIdentifiers when AgenShield.app exists', () => {
      process.env['HOME'] = '/Users/testuser';
      delete process.env['AGENSHIELD_USER_HOME'];
      mockExistsSync.mockReturnValue(true);

      const plist = generateBrokerPlistLegacy();

      expect(plist).toContain('AssociatedBundleIdentifiers');
      expect(plist).toContain('com.frontegg.AgenShield');
    });

    it('does not include AssociatedBundleIdentifiers when AgenShield.app does not exist', () => {
      process.env['HOME'] = '/Users/testuser';
      delete process.env['AGENSHIELD_USER_HOME'];
      mockExistsSync.mockReturnValue(false);

      const plist = generateBrokerPlistLegacy();

      expect(plist).not.toContain('AssociatedBundleIdentifiers');
    });

    it('prefers AGENSHIELD_USER_HOME over HOME', () => {
      process.env['AGENSHIELD_USER_HOME'] = '/Users/agent_home';
      process.env['HOME'] = '/Users/testuser';
      mockExistsSync.mockReturnValue(false);

      const plist = generateBrokerPlistLegacy();

      expect(plist).toContain('/Users/agent_home/.agenshield/run/agenshield.sock');
      expect(plist).toContain('/Users/agent_home/.agenshield/logs');
    });

    it('handles missing HOME and AGENSHIELD_USER_HOME', () => {
      delete process.env['AGENSHIELD_USER_HOME'];
      delete process.env['HOME'];
      mockExistsSync.mockReturnValue(false);

      const plist = generateBrokerPlistLegacy();

      // Socket path falls back to empty prefix
      expect(plist).toContain('/.agenshield/run/agenshield.sock');
    });
  });
});
