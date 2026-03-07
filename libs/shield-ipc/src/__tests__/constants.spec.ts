import * as path from 'node:path';
import * as os from 'node:os';

import {
  resolveUserHome,
  configDirPath,
  mdmConfigPath,
  logDir,
  socketPath,
  socketDir,
  privilegeHelperSocket,
  seatbeltDirPath,
  zdotDirPath,
  pathRegistryPath,
  migrationStatePath,
  resolveCodesignIdentifier,
  CLI_CODESIGN_ID,
  DAEMON_CODESIGN_ID,
  BROKER_CODESIGN_ID,
  NATIVE_SQLITE_CODESIGN_ID,
} from '@agenshield/ipc';

describe('resolveUserHome', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns hostHome when provided', () => {
    expect(resolveUserHome('/custom/home')).toBe('/custom/home');
  });

  it('falls back to AGENSHIELD_USER_HOME', () => {
    process.env['AGENSHIELD_USER_HOME'] = '/env/home';
    delete process.env['HOME'];
    expect(resolveUserHome()).toBe('/env/home');
  });

  it('falls back to HOME', () => {
    delete process.env['AGENSHIELD_USER_HOME'];
    process.env['HOME'] = '/home/user';
    expect(resolveUserHome()).toBe('/home/user');
  });

  it('falls back to os.homedir()', () => {
    delete process.env['AGENSHIELD_USER_HOME'];
    delete process.env['HOME'];
    expect(resolveUserHome()).toBe(os.homedir());
  });
});

describe('path functions with explicit home', () => {
  const home = '/test/home';

  it('configDirPath', () => {
    expect(configDirPath(home)).toBe(path.join(home, '.agenshield'));
  });

  it('mdmConfigPath', () => {
    expect(mdmConfigPath(home)).toBe(path.join(home, '.agenshield', 'mdm.json'));
  });

  it('logDir', () => {
    expect(logDir(home)).toBe(path.join(home, '.agenshield', 'logs'));
  });

  it('socketPath', () => {
    expect(socketPath(home)).toBe(path.join(home, '.agenshield', 'run', 'agenshield.sock'));
  });

  it('socketDir', () => {
    expect(socketDir(home)).toBe(path.join(home, '.agenshield', 'run'));
  });

  it('privilegeHelperSocket', () => {
    expect(privilegeHelperSocket(home)).toBe(
      path.join(home, '.agenshield', 'run', 'privilege-helper.sock'),
    );
  });

  it('seatbeltDirPath', () => {
    expect(seatbeltDirPath(home)).toBe(path.join(home, '.agenshield', 'seatbelt'));
  });

  it('zdotDirPath', () => {
    expect(zdotDirPath(home)).toBe(path.join(home, '.agenshield', 'zdot'));
  });

  it('pathRegistryPath', () => {
    expect(pathRegistryPath(home)).toBe(path.join(home, '.agenshield', 'path-registry.json'));
  });

  it('migrationStatePath', () => {
    expect(migrationStatePath(home)).toBe(path.join(home, '.agenshield', 'migrations.json'));
  });
});

describe('path functions without explicit home', () => {
  it('configDirPath uses resolved home', () => {
    const result = configDirPath();
    expect(result).toContain('.agenshield');
  });

  it('logDir uses resolved home', () => {
    const result = logDir();
    expect(result).toContain(path.join('.agenshield', 'logs'));
  });
});

describe('resolveCodesignIdentifier', () => {
  it('resolves agenshield to CLI_CODESIGN_ID', () => {
    expect(resolveCodesignIdentifier('/usr/local/bin/agenshield')).toBe(CLI_CODESIGN_ID);
  });

  it('resolves agenshield-daemon to DAEMON_CODESIGN_ID', () => {
    expect(resolveCodesignIdentifier('/opt/bin/agenshield-daemon')).toBe(DAEMON_CODESIGN_ID);
  });

  it('resolves agenshield-broker to BROKER_CODESIGN_ID', () => {
    expect(resolveCodesignIdentifier('agenshield-broker')).toBe(BROKER_CODESIGN_ID);
  });

  it('resolves better_sqlite3.node to NATIVE_SQLITE_CODESIGN_ID', () => {
    expect(resolveCodesignIdentifier('/some/path/better_sqlite3.node')).toBe(
      NATIVE_SQLITE_CODESIGN_ID,
    );
  });

  it('returns undefined for unknown binary', () => {
    expect(resolveCodesignIdentifier('/usr/bin/unknown')).toBeUndefined();
  });
});
