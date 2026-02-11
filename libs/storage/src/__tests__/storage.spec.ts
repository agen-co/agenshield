import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Storage, initStorage, getStorage, closeStorage } from '../storage';
import { StorageLockedError, StorageNotInitializedError, PasscodeError } from '../errors';

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  return path.join(dir, 'test.db');
}

describe('Storage', () => {
  let storage: Storage;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    storage = Storage.open(dbPath);
  });

  afterEach(() => {
    storage.close();
    try { fs.unlinkSync(dbPath); } catch { /* */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* */ }
    try { fs.rmdirSync(path.dirname(dbPath)); } catch { /* */ }
  });

  it('creates the database file', () => {
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('has all repository properties', () => {
    expect(storage.config).toBeDefined();
    expect(storage.state).toBeDefined();
    expect(storage.vault).toBeDefined();
    expect(storage.policies).toBeDefined();
    expect(storage.activities).toBeDefined();
    expect(storage.skills).toBeDefined();
    expect(storage.commands).toBeDefined();
    expect(storage.targets).toBeDefined();
    expect(storage.policyGraph).toBeDefined();
  });

  describe('passcode management', () => {
    it('hasPasscode returns false initially', () => {
      expect(storage.hasPasscode()).toBe(false);
    });

    it('setPasscode sets and auto-unlocks', () => {
      storage.setPasscode('test123');
      expect(storage.hasPasscode()).toBe(true);
      expect(storage.isUnlocked()).toBe(true);
    });

    it('setPasscode throws if already set', () => {
      storage.setPasscode('test123');
      expect(() => storage.setPasscode('another')).toThrow(PasscodeError);
    });

    it('lock clears encryption key', () => {
      storage.setPasscode('test123');
      expect(storage.isUnlocked()).toBe(true);
      storage.lock();
      expect(storage.isUnlocked()).toBe(false);
    });

    it('unlock with correct passcode succeeds', () => {
      storage.setPasscode('test123');
      storage.lock();
      expect(storage.unlock('test123')).toBe(true);
      expect(storage.isUnlocked()).toBe(true);
    });

    it('unlock with wrong passcode fails', () => {
      storage.setPasscode('test123');
      storage.lock();
      expect(storage.unlock('wrong')).toBe(false);
      expect(storage.isUnlocked()).toBe(false);
    });

    it('unlock throws if no passcode set', () => {
      expect(() => storage.unlock('anything')).toThrow(PasscodeError);
    });
  });

  describe('transaction', () => {
    it('commits on success', () => {
      storage.state.init('1.0.0');
      storage.transaction(() => {
        storage.state.updateVersion('2.0.0');
      });
      expect(storage.state.get()?.version).toBe('2.0.0');
    });

    it('rolls back on error', () => {
      storage.state.init('1.0.0');
      expect(() => {
        storage.transaction(() => {
          storage.state.updateVersion('2.0.0');
          throw new Error('rollback');
        });
      }).toThrow('rollback');
      expect(storage.state.get()?.version).toBe('1.0.0');
    });
  });
});

describe('Singleton management', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
  });

  afterEach(() => {
    closeStorage();
    try { fs.unlinkSync(dbPath); } catch { /* */ }
    try { fs.rmdirSync(path.dirname(dbPath)); } catch { /* */ }
  });

  it('getStorage throws before init', () => {
    expect(() => getStorage()).toThrow(StorageNotInitializedError);
  });

  it('initStorage + getStorage works', () => {
    initStorage(dbPath);
    const s = getStorage();
    expect(s).toBeInstanceOf(Storage);
  });

  it('closeStorage clears singleton', () => {
    initStorage(dbPath);
    closeStorage();
    expect(() => getStorage()).toThrow(StorageNotInitializedError);
  });
});
