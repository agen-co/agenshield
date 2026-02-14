import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SchemaMigration } from '../../../migrations/001-schema';
import { StateRepository } from '../state.repository';

function createTestDb(): { db: Database.Database; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new SchemaMigration().up(db);
  return {
    db,
    cleanup: () => {
      db.close();
      try { fs.rmSync(dir, { recursive: true }); } catch { /* */ }
    },
  };
}

describe('StateRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: StateRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new StateRepository(db, () => null);
  });

  afterEach(() => {
    cleanup();
  });

  // ---------------------------------------------------------------------------
  // Init & Get
  // ---------------------------------------------------------------------------
  describe('init and get', () => {
    it('get returns null before init', () => {
      expect(repo.get()).toBeNull();
    });

    it('init creates the singleton state row', () => {
      repo.init('1.0.0');
      const state = repo.get();
      expect(state).not.toBeNull();
      expect(state!.version).toBe('1.0.0');
    });

    it('init sets installedAt', () => {
      repo.init('1.0.0');
      const state = repo.get();
      expect(state!.installedAt).toBeDefined();
      expect(typeof state!.installedAt).toBe('string');
    });

    it('init with explicit installedAt', () => {
      const ts = '2025-01-01T00:00:00.000Z';
      repo.init('1.0.0', ts);
      const state = repo.get();
      expect(state!.installedAt).toBe(ts);
    });

    it('init defaults are correct', () => {
      repo.init('1.0.0');
      const state = repo.get()!;
      expect(state.daemon.running).toBe(false);
      expect(state.daemon.pid).toBeUndefined();
      expect(state.daemon.startedAt).toBeUndefined();
      expect(state.daemon.port).toBe(5200);
      expect(state.agenco.authenticated).toBe(false);
      expect(state.agenco.connectedIntegrations).toEqual([]);
      expect(state.installation.preset).toBe('unknown');
      expect(state.installation.baseName).toBe('default');
      expect(state.installation.wrappers).toEqual([]);
      expect(state.installation.seatbeltInstalled).toBe(false);
    });

    it('second init is ignored (INSERT OR IGNORE)', () => {
      repo.init('1.0.0');
      repo.init('2.0.0');
      expect(repo.get()!.version).toBe('1.0.0');
    });
  });

  // ---------------------------------------------------------------------------
  // updateDaemon
  // ---------------------------------------------------------------------------
  describe('updateDaemon', () => {
    beforeEach(() => {
      repo.init('1.0.0');
    });

    it('sets running to true', () => {
      repo.updateDaemon({ running: true });
      expect(repo.get()!.daemon.running).toBe(true);
    });

    it('sets pid', () => {
      repo.updateDaemon({ pid: 12345 });
      expect(repo.get()!.daemon.pid).toBe(12345);
    });

    it('sets startedAt', () => {
      const ts = new Date().toISOString();
      repo.updateDaemon({ startedAt: ts });
      expect(repo.get()!.daemon.startedAt).toBe(ts);
    });

    it('sets port', () => {
      repo.updateDaemon({ port: 6969 });
      expect(repo.get()!.daemon.port).toBe(6969);
    });

    it('updates multiple fields at once', () => {
      repo.updateDaemon({ running: true, pid: 9999, port: 8080 });
      const daemon = repo.get()!.daemon;
      expect(daemon.running).toBe(true);
      expect(daemon.pid).toBe(9999);
      expect(daemon.port).toBe(8080);
    });

    it('clears pid by setting null', () => {
      repo.updateDaemon({ pid: 12345 });
      repo.updateDaemon({ pid: null });
      expect(repo.get()!.daemon.pid).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // updateAgenCo
  // ---------------------------------------------------------------------------
  describe('updateAgenCo', () => {
    beforeEach(() => {
      repo.init('1.0.0');
    });

    it('sets authenticated', () => {
      repo.updateAgenCo({ authenticated: true });
      expect(repo.get()!.agenco.authenticated).toBe(true);
    });

    it('sets lastAuthAt', () => {
      const ts = new Date().toISOString();
      repo.updateAgenCo({ lastAuthAt: ts });
      expect(repo.get()!.agenco.lastAuthAt).toBe(ts);
    });

    it('sets connectedIntegrations', () => {
      repo.updateAgenCo({ connectedIntegrations: ['github', 'slack'] });
      expect(repo.get()!.agenco.connectedIntegrations).toEqual(['github', 'slack']);
    });

    it('clears lastAuthAt with null', () => {
      const ts = new Date().toISOString();
      repo.updateAgenCo({ lastAuthAt: ts });
      repo.updateAgenCo({ lastAuthAt: null });
      expect(repo.get()!.agenco.lastAuthAt).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // updateInstallation
  // ---------------------------------------------------------------------------
  describe('updateInstallation', () => {
    beforeEach(() => {
      repo.init('1.0.0');
    });

    it('sets preset', () => {
      repo.updateInstallation({ preset: 'claude' });
      expect(repo.get()!.installation.preset).toBe('claude');
    });

    it('sets baseName', () => {
      repo.updateInstallation({ baseName: 'my-project' });
      expect(repo.get()!.installation.baseName).toBe('my-project');
    });

    it('sets prefix', () => {
      repo.updateInstallation({ prefix: '/usr/local' });
      expect(repo.get()!.installation.prefix).toBe('/usr/local');
    });

    it('sets wrappers', () => {
      repo.updateInstallation({ wrappers: ['/bin/wrapper1', '/bin/wrapper2'] });
      expect(repo.get()!.installation.wrappers).toEqual(['/bin/wrapper1', '/bin/wrapper2']);
    });

    it('sets seatbeltInstalled', () => {
      repo.updateInstallation({ seatbeltInstalled: true });
      expect(repo.get()!.installation.seatbeltInstalled).toBe(true);
    });

    it('clears prefix with null', () => {
      repo.updateInstallation({ prefix: '/usr/local' });
      repo.updateInstallation({ prefix: null });
      expect(repo.get()!.installation.prefix).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // updatePasscode
  // ---------------------------------------------------------------------------
  describe('updatePasscode', () => {
    beforeEach(() => {
      repo.init('1.0.0');
    });

    it('sets enabled', () => {
      repo.updatePasscode({ enabled: true });
      const state = repo.get()!;
      expect(state.passcodeProtection).toBeDefined();
      expect(state.passcodeProtection!.enabled).toBe(true);
    });

    it('sets allowAnonymousReadOnly', () => {
      repo.updatePasscode({ enabled: true, allowAnonymousReadOnly: true });
      expect(repo.get()!.passcodeProtection!.allowAnonymousReadOnly).toBe(true);
    });

    it('sets failedAttempts', () => {
      repo.updatePasscode({ enabled: true, failedAttempts: 3 });
      expect(repo.get()!.passcodeProtection!.failedAttempts).toBe(3);
    });

    it('sets lockedUntil', () => {
      const ts = new Date().toISOString();
      repo.updatePasscode({ enabled: true, lockedUntil: ts });
      expect(repo.get()!.passcodeProtection!.lockedUntil).toBe(ts);
    });

    it('clears lockedUntil with null', () => {
      const ts = new Date().toISOString();
      repo.updatePasscode({ enabled: true, lockedUntil: ts });
      repo.updatePasscode({ lockedUntil: null });
      expect(repo.get()!.passcodeProtection!.lockedUntil).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // updateVersion
  // ---------------------------------------------------------------------------
  describe('updateVersion', () => {
    beforeEach(() => {
      repo.init('1.0.0');
    });

    it('updates the version', () => {
      repo.updateVersion('2.0.0');
      expect(repo.get()!.version).toBe('2.0.0');
    });

    it('preserves other state when only version changes', () => {
      repo.updateDaemon({ running: true, pid: 1234 });
      repo.updateVersion('3.0.0');
      const state = repo.get()!;
      expect(state.version).toBe('3.0.0');
      expect(state.daemon.running).toBe(true);
      expect(state.daemon.pid).toBe(1234);
    });
  });

  // ---------------------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------------------
  describe('Performance', () => {
    beforeEach(() => {
      repo.init('1.0.0');
    });

    it('1000 updateDaemon operations and measure ops/sec', () => {
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.updateDaemon({ running: i % 2 === 0, pid: i, port: 5200 + (i % 100) });
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[state] updateDaemon: ${count} updates in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });

    it('1000 updateAgenCo operations and measure ops/sec', () => {
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.updateAgenCo({
          authenticated: i % 2 === 0,
          connectedIntegrations: [`integration-${i % 10}`],
        });
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[state] updateAgenCo: ${count} updates in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });

    it('1000 updateInstallation operations and measure ops/sec', () => {
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.updateInstallation({
          preset: `preset-${i % 5}`,
          wrappers: [`/bin/w${i % 3}`],
          seatbeltInstalled: i % 2 === 0,
        });
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[state] updateInstallation: ${count} updates in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });

    it('1000 get operations and measure ops/sec', () => {
      repo.updateDaemon({ running: true, pid: 1234, port: 6969 });
      repo.updateAgenCo({ authenticated: true, connectedIntegrations: ['github'] });

      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.get();
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[state] Get: ${count} reads in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(1000);
    });

    it('1000 updateVersion operations and measure ops/sec', () => {
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.updateVersion(`1.0.${i}`);
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[state] updateVersion: ${count} updates in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });
  });
});
