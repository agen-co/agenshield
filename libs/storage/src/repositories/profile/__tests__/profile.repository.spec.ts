import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SchemaMigration } from '../../../migrations/001-schema';
import { ProfileRepository } from '../profile.repository';

function createTestDb(): { db: Database.Database; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-test-'));
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

let counter = 0;

function makeProfile(overrides: Record<string, unknown> = {}) {
  counter++;
  return {
    id: `profile-${counter}-${Date.now()}`,
    name: `Profile ${counter}`,
    ...overrides,
  };
}

describe('ProfileRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: ProfileRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new ProfileRepository(db, () => null);
  });

  afterEach(() => {
    cleanup();
  });

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('creates a target profile with auto-generated broker token', () => {
      const profile = repo.create(makeProfile({ type: 'target' }));
      expect(profile.id).toBeDefined();
      expect(profile.type).toBe('target');
      expect(profile.brokerToken).toBeDefined();
      expect(profile.brokerToken!.length).toBe(64);
    });

    it('creates a target profile by default (no type)', () => {
      const profile = repo.create(makeProfile());
      expect(profile.type).toBe('target');
      expect(profile.brokerToken).toBeDefined();
    });

    it('creates a global profile without broker token', () => {
      const profile = repo.create(makeProfile({ type: 'global' }));
      expect(profile.type).toBe('global');
      expect(profile.brokerToken).toBeUndefined();
    });

    it('sets createdAt and updatedAt', () => {
      const profile = repo.create(makeProfile());
      expect(profile.createdAt).toBeDefined();
      expect(profile.updatedAt).toBeDefined();
    });

    it('creates profile with optional fields', () => {
      const profile = repo.create(makeProfile({
        targetName: 'my-target',
        description: 'A test profile',
        agentUsername: 'agent1',
        agentUid: 1001,
        agentHomeDir: '/home/agent1',
        brokerUsername: 'broker1',
        brokerUid: 1002,
        brokerHomeDir: '/home/broker1',
        enforcementMode: 'proxy',
      }));
      expect(profile.targetName).toBe('my-target');
      expect(profile.description).toBe('A test profile');
      expect(profile.agentUsername).toBe('agent1');
      expect(profile.enforcementMode).toBe('proxy');
    });
  });

  // ---------------------------------------------------------------------------
  // getById
  // ---------------------------------------------------------------------------
  describe('getById', () => {
    it('returns profile by ID', () => {
      const created = repo.create(makeProfile());
      const found = repo.getById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe(created.name);
    });

    it('returns null for non-existent ID', () => {
      expect(repo.getById('nonexistent')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getAll
  // ---------------------------------------------------------------------------
  describe('getAll', () => {
    it('returns all profiles', () => {
      repo.create(makeProfile());
      repo.create(makeProfile());
      expect(repo.getAll().length).toBe(2);
    });

    it('returns empty array when none exist', () => {
      expect(repo.getAll()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getByType
  // ---------------------------------------------------------------------------
  describe('getByType', () => {
    it('filters by type', () => {
      repo.create(makeProfile({ type: 'target' }));
      repo.create(makeProfile({ type: 'global' }));
      repo.create(makeProfile({ type: 'target' }));

      expect(repo.getByType('target').length).toBe(2);
      expect(repo.getByType('global').length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getGlobal
  // ---------------------------------------------------------------------------
  describe('getGlobal', () => {
    it('returns the global profile', () => {
      repo.create(makeProfile({ type: 'global' }));
      const global = repo.getGlobal();
      expect(global).not.toBeNull();
      expect(global!.type).toBe('global');
    });

    it('returns null when no global profile', () => {
      repo.create(makeProfile({ type: 'target' }));
      expect(repo.getGlobal()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getByToken
  // ---------------------------------------------------------------------------
  describe('getByToken', () => {
    it('finds profile by broker token', () => {
      const created = repo.create(makeProfile({ type: 'target' }));
      const found = repo.getByToken(created.brokerToken!);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('returns null for unknown token', () => {
      expect(repo.getByToken('nonexistent-token')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getByPresetId
  // ---------------------------------------------------------------------------
  describe('getByPresetId', () => {
    it('returns profiles by presetId', () => {
      repo.create(makeProfile({ presetId: 'preset-a' }));
      repo.create(makeProfile({ presetId: 'preset-a' }));
      repo.create(makeProfile({ presetId: 'preset-b' }));

      expect(repo.getByPresetId('preset-a').length).toBe(2);
      expect(repo.getByPresetId('preset-b').length).toBe(1);
      expect(repo.getByPresetId('preset-c')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // rotateToken
  // ---------------------------------------------------------------------------
  describe('rotateToken', () => {
    it('generates a new broker token', () => {
      const created = repo.create(makeProfile({ type: 'target' }));
      const oldToken = created.brokerToken;
      const updated = repo.rotateToken(created.id);
      expect(updated).not.toBeNull();
      expect(updated!.brokerToken).not.toBe(oldToken);
      expect(updated!.brokerToken!.length).toBe(64);
    });

    it('returns null for non-existent profile', () => {
      expect(repo.rotateToken('nonexistent')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('updates partial fields', () => {
      const created = repo.create(makeProfile());
      const updated = repo.update(created.id, { name: 'New Name' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New Name');
    });

    it('returns null for non-existent profile', () => {
      expect(repo.update('nonexistent', { name: 'X' })).toBeNull();
    });

    it('updates enforcementMode', () => {
      const created = repo.create(makeProfile());
      const updated = repo.update(created.id, { enforcementMode: 'both' });
      expect(updated!.enforcementMode).toBe('both');
    });
  });

  // ---------------------------------------------------------------------------
  // updateManifest
  // ---------------------------------------------------------------------------
  describe('updateManifest', () => {
    it('persists and round-trips install manifest JSON', () => {
      const created = repo.create(makeProfile());
      const manifest = { version: '1.0', targets: [{ name: 'test' }] };
      const updated = repo.updateManifest(created.id, manifest as any);
      expect(updated).not.toBeNull();
      expect(updated!.installManifest).toEqual(manifest);
    });

    it('returns null for non-existent profile', () => {
      expect(repo.updateManifest('nonexistent', {} as any)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // addWorkspacePath / removeWorkspacePath
  // ---------------------------------------------------------------------------
  describe('workspace paths', () => {
    it('adds a workspace path', () => {
      const created = repo.create(makeProfile());
      const updated = repo.addWorkspacePath(created.id, '/home/user/project');
      expect(updated).not.toBeNull();
      expect(updated!.workspacePaths).toEqual(['/home/user/project']);
    });

    it('adding duplicate path is idempotent', () => {
      const created = repo.create(makeProfile());
      repo.addWorkspacePath(created.id, '/path/a');
      const updated = repo.addWorkspacePath(created.id, '/path/a');
      expect(updated!.workspacePaths).toEqual(['/path/a']);
    });

    it('adds multiple workspace paths', () => {
      const created = repo.create(makeProfile());
      repo.addWorkspacePath(created.id, '/path/a');
      const updated = repo.addWorkspacePath(created.id, '/path/b');
      expect(updated!.workspacePaths).toEqual(['/path/a', '/path/b']);
    });

    it('removes a workspace path', () => {
      const created = repo.create(makeProfile());
      repo.addWorkspacePath(created.id, '/path/a');
      repo.addWorkspacePath(created.id, '/path/b');
      const updated = repo.removeWorkspacePath(created.id, '/path/a');
      expect(updated!.workspacePaths).toEqual(['/path/b']);
    });

    it('returns null for non-existent profile', () => {
      expect(repo.addWorkspacePath('nonexistent', '/path')).toBeNull();
      expect(repo.removeWorkspacePath('nonexistent', '/path')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // delete
  // ---------------------------------------------------------------------------
  describe('delete', () => {
    it('deletes profile and returns true', () => {
      const created = repo.create(makeProfile());
      expect(repo.delete(created.id)).toBe(true);
      expect(repo.getById(created.id)).toBeNull();
    });

    it('returns false for non-existent profile', () => {
      expect(repo.delete('nonexistent')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------------------
  describe('Performance', () => {
    it('1000 creates', () => {
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.create({ id: `perf-${i}`, name: `Profile ${i}` });
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[profile] create: ${count} ops in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });

    it('1000 reads', () => {
      const created = repo.create(makeProfile());
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.getById(created.id);
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[profile] getById: ${count} ops in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });
  });
});
