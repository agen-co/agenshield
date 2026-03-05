import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SchemaMigration } from '../../../migrations/001-schema';
import { WorkspaceSkillsRepository } from '../workspace-skills.repository';

function createTestDb(): { db: Database.Database; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-skills-test-'));
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

/** Insert a profile directly for FK constraints */
function insertProfile(db: Database.Database, id?: string): string {
  const profileId = id ?? `profile-${++counter}`;
  db.prepare(
    "INSERT INTO profiles (id, name, type, created_at, updated_at) VALUES (?, ?, 'target', datetime('now'), datetime('now'))",
  ).run(profileId, `Profile ${profileId}`);
  return profileId;
}

function makeSkill(profileId: string, overrides: Record<string, unknown> = {}) {
  counter++;
  return {
    profileId,
    workspacePath: `/home/user/project-${counter}`,
    skillName: `skill-${counter}`,
    ...overrides,
  };
}

describe('WorkspaceSkillsRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: WorkspaceSkillsRepository;
  let profileId: string;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new WorkspaceSkillsRepository(db, () => null);
    profileId = insertProfile(db);
  });

  afterEach(() => {
    cleanup();
  });

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('creates with default status pending and aclApplied false', () => {
      const skill = repo.create(makeSkill(profileId));
      expect(skill.id).toBeDefined();
      expect(skill.status).toBe('pending');
      expect(skill.aclApplied).toBe(false);
      expect(skill.createdAt).toBeDefined();
      expect(skill.updatedAt).toBeDefined();
    });

    it('creates with explicit status', () => {
      const skill = repo.create(makeSkill(profileId, { status: 'approved' }));
      expect(skill.status).toBe('approved');
    });

    it('creates with optional fields', () => {
      const skill = repo.create(makeSkill(profileId, {
        contentHash: 'abc123',
        approvedBy: 'admin',
        approvedAt: '2025-01-01T00:00:00.000Z',
        cloudSkillId: 'cloud-1',
        aclApplied: true,
      }));
      expect(skill.contentHash).toBe('abc123');
      expect(skill.aclApplied).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getById
  // ---------------------------------------------------------------------------
  describe('getById', () => {
    it('returns skill by ID', () => {
      const created = repo.create(makeSkill(profileId));
      const found = repo.getById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('returns null for non-existent ID', () => {
      expect(repo.getById('nonexistent')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getByKey
  // ---------------------------------------------------------------------------
  describe('getByKey', () => {
    it('returns skill by workspace_path + skill_name', () => {
      const created = repo.create(makeSkill(profileId, {
        workspacePath: '/ws/path',
        skillName: 'my-skill',
      }));
      const found = repo.getByKey('/ws/path', 'my-skill');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('returns null for unknown key', () => {
      expect(repo.getByKey('/unknown', 'unknown')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getByWorkspace
  // ---------------------------------------------------------------------------
  describe('getByWorkspace', () => {
    it('returns skills for a workspace', () => {
      repo.create(makeSkill(profileId, { workspacePath: '/ws/a', skillName: 'skill-a' }));
      repo.create(makeSkill(profileId, { workspacePath: '/ws/a', skillName: 'skill-b' }));
      repo.create(makeSkill(profileId, { workspacePath: '/ws/b', skillName: 'skill-c' }));

      expect(repo.getByWorkspace('/ws/a').length).toBe(2);
      expect(repo.getByWorkspace('/ws/b').length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getByStatus
  // ---------------------------------------------------------------------------
  describe('getByStatus', () => {
    it('filters by status', () => {
      repo.create(makeSkill(profileId, { status: 'pending' }));
      repo.create(makeSkill(profileId, { status: 'approved' }));
      repo.create(makeSkill(profileId, { status: 'pending' }));

      expect(repo.getByStatus('pending').length).toBe(2);
      expect(repo.getByStatus('approved').length).toBe(1);
      expect(repo.getByStatus('denied')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getAllActive
  // ---------------------------------------------------------------------------
  describe('getAllActive', () => {
    it('excludes removed skills', () => {
      repo.create(makeSkill(profileId, { status: 'approved' }));
      repo.create(makeSkill(profileId, { status: 'pending' }));
      const removed = repo.create(makeSkill(profileId));
      repo.markRemoved(removed.id);

      expect(repo.getAllActive().length).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // getPending
  // ---------------------------------------------------------------------------
  describe('getPending', () => {
    it('returns only pending skills', () => {
      repo.create(makeSkill(profileId, { status: 'pending' }));
      repo.create(makeSkill(profileId, { status: 'approved' }));
      repo.create(makeSkill(profileId, { status: 'pending' }));

      expect(repo.getPending().length).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // getApprovedNames
  // ---------------------------------------------------------------------------
  describe('getApprovedNames', () => {
    it('returns names of approved and cloud_forced skills', () => {
      const ws = '/ws/test';
      repo.create(makeSkill(profileId, { workspacePath: ws, skillName: 'approved-1', status: 'approved' }));
      repo.create(makeSkill(profileId, { workspacePath: ws, skillName: 'forced-1', status: 'cloud_forced' }));
      repo.create(makeSkill(profileId, { workspacePath: ws, skillName: 'pending-1', status: 'pending' }));
      repo.create(makeSkill(profileId, { workspacePath: ws, skillName: 'denied-1', status: 'denied' }));

      const names = repo.getApprovedNames(ws);
      expect(names.sort()).toEqual(['approved-1', 'forced-1']);
    });
  });

  // ---------------------------------------------------------------------------
  // getByProfile
  // ---------------------------------------------------------------------------
  describe('getByProfile', () => {
    it('returns active skills for a profile', () => {
      const p2 = insertProfile(db);
      repo.create(makeSkill(profileId));
      repo.create(makeSkill(profileId));
      repo.create(makeSkill(p2));
      const removed = repo.create(makeSkill(profileId));
      repo.markRemoved(removed.id);

      expect(repo.getByProfile(profileId).length).toBe(2);
      expect(repo.getByProfile(p2).length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // countByStatus / countByStatusForProfile
  // ---------------------------------------------------------------------------
  describe('counting', () => {
    it('countByStatus counts across all profiles', () => {
      const p2 = insertProfile(db);
      repo.create(makeSkill(profileId, { status: 'pending' }));
      repo.create(makeSkill(p2, { status: 'pending' }));
      repo.create(makeSkill(profileId, { status: 'approved' }));

      expect(repo.countByStatus('pending')).toBe(2);
      expect(repo.countByStatus('approved')).toBe(1);
      expect(repo.countByStatus('denied')).toBe(0);
    });

    it('countByStatusForProfile scopes to profile', () => {
      const p2 = insertProfile(db);
      repo.create(makeSkill(profileId, { status: 'pending' }));
      repo.create(makeSkill(p2, { status: 'pending' }));

      expect(repo.countByStatusForProfile('pending', profileId)).toBe(1);
      expect(repo.countByStatusForProfile('pending', p2)).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('updates status', () => {
      const created = repo.create(makeSkill(profileId));
      const updated = repo.update(created.id, { status: 'approved' });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('approved');
    });

    it('updates contentHash and approvedBy', () => {
      const created = repo.create(makeSkill(profileId));
      const updated = repo.update(created.id, {
        contentHash: 'newhash',
        approvedBy: 'admin',
      });
      expect(updated!.contentHash).toBe('newhash');
      expect(updated!.approvedBy).toBe('admin');
    });

    it('updates aclApplied', () => {
      const created = repo.create(makeSkill(profileId));
      const updated = repo.update(created.id, { aclApplied: true });
      expect(updated!.aclApplied).toBe(true);
    });

    it('returns null for non-existent ID', () => {
      expect(repo.update('nonexistent', { status: 'approved' })).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // markRemoved (soft delete)
  // ---------------------------------------------------------------------------
  describe('markRemoved', () => {
    it('sets status to removed', () => {
      const created = repo.create(makeSkill(profileId));
      const removed = repo.markRemoved(created.id);
      expect(removed).not.toBeNull();
      expect(removed!.status).toBe('removed');
      expect(removed!.removedAt).toBeDefined();
    });

    it('returns null for non-existent ID', () => {
      expect(repo.markRemoved('nonexistent')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // delete (hard delete)
  // ---------------------------------------------------------------------------
  describe('delete', () => {
    it('hard deletes a skill', () => {
      const created = repo.create(makeSkill(profileId));
      expect(repo.delete(created.id)).toBe(true);
      expect(repo.getById(created.id)).toBeNull();
    });

    it('returns false for non-existent ID', () => {
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
        repo.create({
          profileId,
          workspacePath: `/ws/perf-${i}`,
          skillName: `skill-${i}`,
        });
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[workspace-skills] create: ${count} ops in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });

    it('1000 reads', () => {
      const created = repo.create(makeSkill(profileId));
      const count = 1000;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        repo.getById(created.id);
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((count / elapsed) * 1000);
      console.log(`[workspace-skills] getById: ${count} ops in ${elapsed.toFixed(1)}ms (${opsPerSec} ops/sec)`);
      expect(opsPerSec).toBeGreaterThan(100);
    });
  });
});
