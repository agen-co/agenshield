import * as fs from 'node:fs';
import { CommandAllowlist } from '../../policies/command-allowlist.js';

jest.mock('node:fs');

const mockedFs = fs as jest.Mocked<typeof fs>;

beforeEach(() => {
  jest.clearAllMocks();
});

function createAllowlist(configExists = false, configContent?: string): CommandAllowlist {
  mockedFs.existsSync.mockImplementation((p: any) => {
    if (String(p).endsWith('allowed-commands.json')) return configExists;
    // For resolve() checks — simulate no binaries exist by default
    return false;
  });
  if (configExists && configContent) {
    mockedFs.readFileSync.mockReturnValue(configContent);
  }

  return new CommandAllowlist('/tmp/config/allowed-commands.json');
}

describe('CommandAllowlist', () => {
  describe('constructor / load()', () => {
    it('should initialize empty when config file does not exist', () => {
      const allowlist = createAllowlist(false);
      const dynamic = allowlist.listDynamic();
      expect(dynamic).toEqual([]);
    });

    it('should load dynamic commands from valid JSON', () => {
      const config = {
        version: '1.0.0',
        commands: [{ name: 'mycmd', paths: ['/usr/local/bin/mycmd'], addedAt: '', addedBy: 'admin' }],
      };
      const allowlist = createAllowlist(true, JSON.stringify(config));
      const dynamic = allowlist.listDynamic();
      expect(dynamic).toHaveLength(1);
      expect(dynamic[0].name).toBe('mycmd');
    });

    it('should handle malformed JSON gracefully', () => {
      const allowlist = createAllowlist(true, 'not json');
      expect(allowlist.listDynamic()).toEqual([]);
    });
  });

  describe('resolve()', () => {
    it('should resolve builtin command when path exists', () => {
      const allowlist = createAllowlist(false);
      mockedFs.existsSync.mockImplementation((p: any) => {
        return String(p) === '/bin/ls';
      });
      expect(allowlist.resolve('ls')).toBe('/bin/ls');
    });

    it('should return null for unknown command', () => {
      const allowlist = createAllowlist(false);
      mockedFs.existsSync.mockReturnValue(false);
      expect(allowlist.resolve('nonexistent')).toBeNull();
    });

    it('should check dynamic commands after builtins', () => {
      const config = {
        version: '1.0.0',
        commands: [{ name: 'mycmd', paths: ['/opt/bin/mycmd'], addedAt: '', addedBy: 'admin' }],
      };
      mockedFs.existsSync.mockImplementation((p: any) => {
        if (String(p).endsWith('allowed-commands.json')) return true;
        return String(p) === '/opt/bin/mycmd';
      });
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(config));

      const allowlist = new CommandAllowlist('/tmp/config/allowed-commands.json');
      expect(allowlist.resolve('mycmd')).toBe('/opt/bin/mycmd');
    });

    it('should handle absolute path for builtin', () => {
      const allowlist = createAllowlist(false);
      mockedFs.existsSync.mockImplementation((p: any) => String(p) === '/usr/bin/git');
      expect(allowlist.resolve('/usr/bin/git')).toBe('/usr/bin/git');
    });

    it('should return null for absolute path not in any list', () => {
      const allowlist = createAllowlist(false);
      mockedFs.existsSync.mockReturnValue(true);
      expect(allowlist.resolve('/opt/evil/malware')).toBeNull();
    });

    it('should resolve absolute path from dynamic command list', () => {
      const config = {
        version: '1.0.0',
        commands: [{ name: 'mycmd', paths: ['/usr/local/bin/mycmd'], addedAt: '', addedBy: 'admin' }],
      };
      mockedFs.existsSync.mockImplementation((p: any) => {
        if (String(p).endsWith('allowed-commands.json')) return true;
        return String(p) === '/usr/local/bin/mycmd';
      });
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(config));

      const allowlist = new CommandAllowlist('/tmp/config/allowed-commands.json');
      expect(allowlist.resolve('/usr/local/bin/mycmd')).toBe('/usr/local/bin/mycmd');
    });
  });

  describe('add() / remove()', () => {
    it('should add and persist to disk', () => {
      const allowlist = createAllowlist(false);
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.writeFileSync.mockImplementation(() => {});

      allowlist.add({ name: 'newcmd', paths: ['/usr/local/bin/newcmd'], addedAt: '', addedBy: 'admin' });
      expect(mockedFs.writeFileSync).toHaveBeenCalled();
      expect(allowlist.get('newcmd')).toBeDefined();
    });

    it('should remove and persist for existing command', () => {
      const config = {
        version: '1.0.0',
        commands: [{ name: 'mycmd', paths: ['/opt/bin/mycmd'], addedAt: '', addedBy: 'admin' }],
      };
      const allowlist = createAllowlist(true, JSON.stringify(config));
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.writeFileSync.mockImplementation(() => {});

      expect(allowlist.remove('mycmd')).toBe(true);
      expect(allowlist.get('mycmd')).toBeUndefined();
    });

    it('should return false for non-existent command', () => {
      const allowlist = createAllowlist(false);
      expect(allowlist.remove('nope')).toBe(false);
    });

    it('should create config directory on save when it does not exist', () => {
      const allowlist = createAllowlist(false);
      mockedFs.existsSync.mockImplementation((p: any) => {
        // config dir does not exist
        if (String(p) === '/tmp/config') return false;
        return false;
      });
      mockedFs.mkdirSync.mockImplementation(() => undefined as any);
      mockedFs.writeFileSync.mockImplementation(() => {});

      allowlist.add({ name: 'newcmd', paths: ['/usr/local/bin/newcmd'], addedAt: '', addedBy: 'admin' });
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith('/tmp/config', { recursive: true });
    });
  });

  describe('list()', () => {
    it('should return combined builtin + dynamic commands', () => {
      const config = {
        version: '1.0.0',
        commands: [{ name: 'mycmd', paths: ['/opt/bin/mycmd'], addedAt: '', addedBy: 'admin' }],
      };
      const allowlist = createAllowlist(true, JSON.stringify(config));
      const all = allowlist.list();

      const builtins = all.filter((c) => c.builtin);
      const dynamics = all.filter((c) => !c.builtin);

      expect(builtins.length).toBeGreaterThan(0);
      expect(dynamics).toHaveLength(1);
      expect(dynamics[0].name).toBe('mycmd');
    });
  });

  describe('isBuiltin()', () => {
    it('should return true for builtin names', () => {
      const allowlist = createAllowlist(false);
      expect(allowlist.isBuiltin('git')).toBe(true);
      expect(allowlist.isBuiltin('node')).toBe(true);
    });

    it('should return false for non-builtin names', () => {
      const allowlist = createAllowlist(false);
      expect(allowlist.isBuiltin('mycustomtool')).toBe(false);
    });
  });

  describe('maybeReload()', () => {
    it('should not reload within 30s interval', () => {
      const allowlist = createAllowlist(false);
      mockedFs.existsSync.mockReturnValue(false);
      const loadSpy = jest.spyOn(allowlist, 'load');
      loadSpy.mockClear();

      allowlist.resolve('ls');
      expect(loadSpy).not.toHaveBeenCalled();
    });

    it('should reload after interval expires', () => {
      const allowlist = createAllowlist(false);
      mockedFs.existsSync.mockReturnValue(false);
      (allowlist as any).lastLoad = 0; // Force stale
      const loadSpy = jest.spyOn(allowlist, 'load');
      loadSpy.mockClear();

      allowlist.resolve('ls');
      expect(loadSpy).toHaveBeenCalled();
    });
  });
});
