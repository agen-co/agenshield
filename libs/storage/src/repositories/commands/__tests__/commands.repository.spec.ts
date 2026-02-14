/**
 * CommandsRepository — comprehensive tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SchemaMigration } from '../../../migrations/001-schema';
import { CommandsRepository } from '../commands.repository';

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

function makeCommandInput(overrides?: Record<string, unknown>) {
  return {
    name: 'git',
    paths: ['/usr/bin/git', '/usr/local/bin/git'],
    addedBy: 'policy',
    category: 'vcs',
    ...overrides,
  };
}

describe('CommandsRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: CommandsRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new CommandsRepository(db, () => null);
  });

  afterEach(() => {
    cleanup();
  });

  // ─── CRUD ──────────────────────────────────────────────────

  describe('CRUD', () => {
    it('create returns a command with addedAt timestamp', () => {
      const cmd = repo.create(makeCommandInput());

      expect(cmd.name).toBe('git');
      expect(cmd.paths).toEqual(['/usr/bin/git', '/usr/local/bin/git']);
      expect(cmd.addedBy).toBe('policy');
      expect(cmd.category).toBe('vcs');
      expect(cmd.addedAt).toBeDefined();
    });

    it('create with minimal required fields', () => {
      const cmd = repo.create({ name: 'ls' });

      expect(cmd.name).toBe('ls');
      expect(cmd.paths).toEqual([]);
      expect(cmd.addedBy).toBe('policy');
      expect(cmd.category).toBeUndefined();
    });

    it('create upserts on duplicate name', () => {
      repo.create(makeCommandInput());
      const updated = repo.create(makeCommandInput({ paths: ['/new/path'] }));

      expect(updated.paths).toEqual(['/new/path']);

      const found = repo.getByName('git');
      expect(found).not.toBeNull();
      expect(found!.paths).toEqual(['/new/path']);
    });

    it('create rejects invalid input — empty name', () => {
      expect(() => repo.create({ name: '' })).toThrow();
    });

    it('create rejects missing name', () => {
      expect(() => repo.create({})).toThrow();
    });

    it('getByName returns the correct command', () => {
      repo.create(makeCommandInput());
      const found = repo.getByName('git');

      expect(found).not.toBeNull();
      expect(found!.name).toBe('git');
      expect(found!.paths).toEqual(['/usr/bin/git', '/usr/local/bin/git']);
      expect(found!.addedBy).toBe('policy');
      expect(found!.category).toBe('vcs');
    });

    it('getByName returns null for non-existent command', () => {
      expect(repo.getByName('non-existent')).toBeNull();
    });

    it('getAll returns all commands sorted by name', () => {
      repo.create(makeCommandInput({ name: 'zsh' }));
      repo.create(makeCommandInput({ name: 'bash' }));
      repo.create(makeCommandInput({ name: 'git' }));

      const all = repo.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].name).toBe('bash');
      expect(all[1].name).toBe('git');
      expect(all[2].name).toBe('zsh');
    });

    it('getAll returns empty array when no commands', () => {
      expect(repo.getAll()).toEqual([]);
    });

    it('delete removes a command', () => {
      repo.create(makeCommandInput());
      expect(repo.delete('git')).toBe(true);
      expect(repo.getByName('git')).toBeNull();
    });

    it('delete returns false for non-existent command', () => {
      expect(repo.delete('non-existent')).toBe(false);
    });

    it('delete only removes the targeted command', () => {
      repo.create(makeCommandInput({ name: 'git' }));
      repo.create(makeCommandInput({ name: 'npm' }));
      repo.create(makeCommandInput({ name: 'node' }));

      repo.delete('git');

      const all = repo.getAll();
      expect(all).toHaveLength(2);
      expect(all.find((c) => c.name === 'git')).toBeUndefined();
    });
  });

  // ─── isAllowed ─────────────────────────────────────────────

  describe('isAllowed', () => {
    it('returns true for an existing command', () => {
      repo.create(makeCommandInput());
      expect(repo.isAllowed('git')).toBe(true);
    });

    it('returns false for a non-existent command', () => {
      expect(repo.isAllowed('rm')).toBe(false);
    });

    it('returns false after command is deleted', () => {
      repo.create(makeCommandInput());
      repo.delete('git');
      expect(repo.isAllowed('git')).toBe(false);
    });

    it('returns true after command is recreated', () => {
      repo.create(makeCommandInput());
      repo.delete('git');
      repo.create(makeCommandInput());
      expect(repo.isAllowed('git')).toBe(true);
    });
  });

  // ─── Category filtering ────────────────────────────────────

  describe('Category filtering', () => {
    beforeEach(() => {
      repo.create(makeCommandInput({ name: 'git', category: 'vcs' }));
      repo.create(makeCommandInput({ name: 'svn', category: 'vcs' }));
      repo.create(makeCommandInput({ name: 'npm', category: 'package-manager' }));
      repo.create(makeCommandInput({ name: 'yarn', category: 'package-manager' }));
      repo.create(makeCommandInput({ name: 'ls', category: 'filesystem' }));
    });

    it('getAll with category returns only matching commands', () => {
      const vcs = repo.getAll('vcs');
      expect(vcs).toHaveLength(2);
      vcs.forEach((c) => expect(c.category).toBe('vcs'));
    });

    it('getAll with package-manager category', () => {
      const pm = repo.getAll('package-manager');
      expect(pm).toHaveLength(2);
      expect(pm.map((c) => c.name).sort()).toEqual(['npm', 'yarn']);
    });

    it('getAll with non-existent category returns empty', () => {
      expect(repo.getAll('non-existent')).toEqual([]);
    });

    it('getAll without category returns all', () => {
      const all = repo.getAll();
      expect(all).toHaveLength(5);
    });

    it('category filtering after delete', () => {
      repo.delete('git');
      const vcs = repo.getAll('vcs');
      expect(vcs).toHaveLength(1);
      expect(vcs[0].name).toBe('svn');
    });
  });

  // ─── Performance ───────────────────────────────────────────

  describe('Performance', () => {
    it('handles 1000 command creates efficiently', () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        repo.create({
          name: `cmd-${i.toString().padStart(4, '0')}`,
          paths: [`/usr/bin/cmd-${i}`],
          addedBy: 'policy',
          category: i % 5 === 0 ? 'cat-a' : i % 3 === 0 ? 'cat-b' : 'cat-c',
        });
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(10_000); // 10s ceiling

      const all = repo.getAll();
      expect(all).toHaveLength(1000);
    });

    it('lookups are fast after bulk insert', () => {
      for (let i = 0; i < 1000; i++) {
        repo.create({
          name: `cmd-${i.toString().padStart(4, '0')}`,
          paths: [`/usr/bin/cmd-${i}`],
          addedBy: 'policy',
        });
      }

      const start = performance.now();

      // 1000 lookups
      for (let i = 0; i < 1000; i++) {
        const name = `cmd-${i.toString().padStart(4, '0')}`;
        expect(repo.isAllowed(name)).toBe(true);
        expect(repo.getByName(name)).not.toBeNull();
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(5_000);
    });

    it('category filtering is fast at scale', () => {
      for (let i = 0; i < 1000; i++) {
        repo.create({
          name: `cmd-${i}`,
          paths: [],
          addedBy: 'policy',
          category: `cat-${i % 10}`,
        });
      }

      const start = performance.now();

      for (let cat = 0; cat < 10; cat++) {
        const cmds = repo.getAll(`cat-${cat}`);
        expect(cmds).toHaveLength(100);
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(2_000);
    });
  });
});
