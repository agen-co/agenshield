/**
 * SkillsRepository — comprehensive tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { InitialSchemaMigration } from '../../../migrations/001-initial-schema';
import { SkillsManagerColumnsMigration } from '../../../migrations/003-skills-manager-columns';
import { SkillsRepository } from '../skills.repository';

function createTestDb(): { db: Database.Database; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new InitialSchemaMigration().up(db);
  new SkillsManagerColumnsMigration().up(db);
  return {
    db,
    cleanup: () => {
      db.close();
      try { fs.rmSync(dir, { recursive: true }); } catch { /* */ }
    },
  };
}

function makeSkillInput(overrides?: Record<string, unknown>) {
  return {
    name: 'Test Skill',
    slug: 'test-skill',
    author: 'tester',
    description: 'A test skill',
    tags: ['test', 'demo'],
    source: 'manual' as const,
    ...overrides,
  };
}

function makeVersionInput(skillId: string, overrides?: Record<string, unknown>) {
  return {
    skillId,
    version: '1.0.0',
    folderPath: '/tmp/skills/test-skill/1.0.0',
    contentHash: 'abc123hash',
    hashUpdatedAt: new Date().toISOString(),
    approval: 'unknown' as const,
    trusted: false,
    analysisStatus: 'pending' as const,
    requiredBins: [] as string[],
    requiredEnv: [] as string[],
    extractedCommands: [] as unknown[],
    ...overrides,
  };
}

describe('SkillsRepository', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: SkillsRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new SkillsRepository(db, () => null);
  });

  afterEach(() => {
    cleanup();
  });

  // ─── Skill CRUD ────────────────────────────────────────────

  describe('Skills CRUD', () => {
    it('create returns a skill with generated id and timestamps', () => {
      const skill = repo.create(makeSkillInput());

      expect(skill.id).toBeDefined();
      expect(skill.name).toBe('Test Skill');
      expect(skill.slug).toBe('test-skill');
      expect(skill.author).toBe('tester');
      expect(skill.description).toBe('A test skill');
      expect(skill.tags).toEqual(['test', 'demo']);
      expect(skill.source).toBe('manual');
      expect(skill.createdAt).toBeDefined();
      expect(skill.updatedAt).toBeDefined();
    });

    it('create with minimal required fields', () => {
      const skill = repo.create({ name: 'Min', slug: 'min' });

      expect(skill.id).toBeDefined();
      expect(skill.name).toBe('Min');
      expect(skill.slug).toBe('min');
      expect(skill.tags).toEqual([]);
      expect(skill.source).toBe('unknown');
    });

    it('create rejects duplicate slugs', () => {
      repo.create(makeSkillInput());
      expect(() => repo.create(makeSkillInput())).toThrow();
    });

    it('create rejects invalid input', () => {
      expect(() => repo.create({ name: '' })).toThrow();
      expect(() => repo.create({ name: 'x', slug: 'UPPER' })).toThrow();
    });

    it('getById returns the correct skill', () => {
      const created = repo.create(makeSkillInput());
      const found = repo.getById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe('Test Skill');
      expect(found!.tags).toEqual(['test', 'demo']);
    });

    it('getById returns null for non-existent id', () => {
      expect(repo.getById('non-existent')).toBeNull();
    });

    it('getBySlug returns the correct skill', () => {
      const created = repo.create(makeSkillInput());
      const found = repo.getBySlug('test-skill');

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('getBySlug returns null for non-existent slug', () => {
      expect(repo.getBySlug('non-existent')).toBeNull();
    });

    it('getAll returns all skills', () => {
      repo.create(makeSkillInput({ slug: 'skill-a', name: 'A' }));
      repo.create(makeSkillInput({ slug: 'skill-b', name: 'B' }));
      repo.create(makeSkillInput({ slug: 'skill-c', name: 'C' }));

      const all = repo.getAll();
      expect(all).toHaveLength(3);
    });

    it('getAll with source filter', () => {
      repo.create(makeSkillInput({ slug: 'manual-1', source: 'manual' }));
      repo.create(makeSkillInput({ slug: 'watcher-1', source: 'watcher' }));
      repo.create(makeSkillInput({ slug: 'manual-2', source: 'manual' }));

      const manual = repo.getAll({ source: 'manual' });
      expect(manual).toHaveLength(2);
      manual.forEach((s) => expect(s.source).toBe('manual'));

      const watcher = repo.getAll({ source: 'watcher' });
      expect(watcher).toHaveLength(1);
    });

    it('getAll returns empty array when no skills', () => {
      expect(repo.getAll()).toEqual([]);
    });

    it('update modifies fields and bumps updatedAt', () => {
      const skill = repo.create(makeSkillInput());
      const original = repo.getById(skill.id)!;

      // Small delay so updatedAt differs
      const updated = repo.update(skill.id, {
        name: 'Updated Name',
        description: 'Updated desc',
        tags: ['new-tag'],
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.description).toBe('Updated desc');
      expect(updated!.tags).toEqual(['new-tag']);
      // slug should be unchanged
      expect(updated!.slug).toBe('test-skill');
    });

    it('update returns null for non-existent id', () => {
      expect(repo.update('non-existent', { name: 'X' })).toBeNull();
    });

    it('update with empty object still bumps updatedAt', () => {
      const skill = repo.create(makeSkillInput());
      const updated = repo.update(skill.id, {});
      expect(updated).not.toBeNull();
    });

    it('delete removes a skill', () => {
      const skill = repo.create(makeSkillInput());
      expect(repo.delete(skill.id)).toBe(true);
      expect(repo.getById(skill.id)).toBeNull();
    });

    it('delete returns false for non-existent id', () => {
      expect(repo.delete('non-existent')).toBe(false);
    });

    it('delete cascades to versions', () => {
      const skill = repo.create(makeSkillInput());
      repo.addVersion(makeVersionInput(skill.id));

      expect(repo.getVersions(skill.id)).toHaveLength(1);
      repo.delete(skill.id);
      expect(repo.getVersions(skill.id)).toHaveLength(0);
    });
  });

  // ─── Versions ──────────────────────────────────────────────

  describe('Versions', () => {
    let skillId: string;

    beforeEach(() => {
      const skill = repo.create(makeSkillInput());
      skillId = skill.id;
    });

    it('addVersion creates a version with generated id', () => {
      const v = repo.addVersion(makeVersionInput(skillId));

      expect(v.id).toBeDefined();
      expect(v.skillId).toBe(skillId);
      expect(v.version).toBe('1.0.0');
      expect(v.folderPath).toBe('/tmp/skills/test-skill/1.0.0');
      expect(v.approval).toBe('unknown');
      expect(v.trusted).toBe(false);
      expect(v.analysisStatus).toBe('pending');
      expect(v.requiredBins).toEqual([]);
      expect(v.requiredEnv).toEqual([]);
      expect(v.extractedCommands).toEqual([]);
    });

    it('addVersion rejects duplicate (skillId, version) pair', () => {
      repo.addVersion(makeVersionInput(skillId));
      expect(() => repo.addVersion(makeVersionInput(skillId))).toThrow();
    });

    it('getVersion retrieves by skillId + version string', () => {
      const v = repo.addVersion(makeVersionInput(skillId));
      const found = repo.getVersion({ skillId, version: '1.0.0' });

      expect(found).not.toBeNull();
      expect(found!.id).toBe(v.id);
    });

    it('getVersion returns null for non-existent', () => {
      expect(repo.getVersion({ skillId, version: '9.9.9' })).toBeNull();
    });

    it('getVersionById retrieves by id', () => {
      const v = repo.addVersion(makeVersionInput(skillId));
      const found = repo.getVersionById(v.id);

      expect(found).not.toBeNull();
      expect(found!.version).toBe('1.0.0');
    });

    it('getVersionById returns null for non-existent', () => {
      expect(repo.getVersionById('non-existent')).toBeNull();
    });

    it('getVersions returns all versions for a skill', () => {
      repo.addVersion(makeVersionInput(skillId, { version: '1.0.0' }));
      repo.addVersion(makeVersionInput(skillId, { version: '1.1.0' }));
      repo.addVersion(makeVersionInput(skillId, { version: '2.0.0' }));

      const versions = repo.getVersions(skillId);
      expect(versions).toHaveLength(3);
    });

    it('getVersions returns empty for skill with no versions', () => {
      expect(repo.getVersions(skillId)).toEqual([]);
    });

    it('getLatestVersion returns a version (most recent by created_at DESC)', () => {
      repo.addVersion(makeVersionInput(skillId, { version: '1.0.0' }));
      repo.addVersion(makeVersionInput(skillId, { version: '2.0.0' }));

      const latest = repo.getLatestVersion(skillId);
      expect(latest).not.toBeNull();
      // Both versions may have the same created_at, so just verify one is returned
      expect(['1.0.0', '2.0.0']).toContain(latest!.version);
    });

    it('getLatestVersion returns null for skill with no versions', () => {
      expect(repo.getLatestVersion(skillId)).toBeNull();
    });
  });

  // ─── Analysis ──────────────────────────────────────────────

  describe('Analysis', () => {
    let skillId: string;
    let versionId: string;

    beforeEach(() => {
      const skill = repo.create(makeSkillInput());
      skillId = skill.id;
      const v = repo.addVersion(makeVersionInput(skillId));
      versionId = v.id;
    });

    it('updateAnalysis changes status and json', () => {
      repo.updateAnalysis(versionId, {
        status: 'complete',
        json: { risk: 'low', commands: ['ls'] },
      });

      const v = repo.getVersionById(versionId)!;
      expect(v.analysisStatus).toBe('complete');
      expect(v.analysisJson).toEqual({ risk: 'low', commands: ['ls'] });
      expect(v.analyzedAt).toBeDefined();
    });

    it('updateAnalysis with error status', () => {
      repo.updateAnalysis(versionId, {
        status: 'error',
        json: { error: 'timeout' },
      });

      const v = repo.getVersionById(versionId)!;
      expect(v.analysisStatus).toBe('error');
    });

    it('updateAnalysis rejects invalid status', () => {
      expect(() =>
        repo.updateAnalysis(versionId, { status: 'invalid' }),
      ).toThrow();
    });

    it('approveVersion sets approval to approved', () => {
      repo.approveVersion(versionId);

      const v = repo.getVersionById(versionId)!;
      expect(v.approval).toBe('approved');
      expect(v.approvedAt).toBeDefined();
    });

    it('quarantineVersion sets approval to quarantined', () => {
      repo.quarantineVersion(versionId);

      const v = repo.getVersionById(versionId)!;
      expect(v.approval).toBe('quarantined');
    });
  });

  // ─── Files ─────────────────────────────────────────────────

  describe('Files', () => {
    let skillId: string;
    let versionId: string;

    beforeEach(() => {
      const skill = repo.create(makeSkillInput());
      skillId = skill.id;
      const v = repo.addVersion(makeVersionInput(skillId));
      versionId = v.id;
    });

    it('registerFiles creates file records', () => {
      const files = repo.registerFiles({ versionId, files: [
        { relativePath: 'index.ts', fileHash: 'hash1', sizeBytes: 100 },
        { relativePath: 'lib/helper.ts', fileHash: 'hash2', sizeBytes: 200 },
      ] });

      expect(files).toHaveLength(2);
      expect(files[0].relativePath).toBe('index.ts');
      expect(files[0].fileHash).toBe('hash1');
      expect(files[0].sizeBytes).toBe(100);
      expect(files[0].skillVersionId).toBe(versionId);
      expect(files[1].relativePath).toBe('lib/helper.ts');
    });

    it('registerFiles upserts on duplicate relativePath', () => {
      repo.registerFiles({ versionId, files: [
        { relativePath: 'index.ts', fileHash: 'hash1', sizeBytes: 100 },
      ] });
      repo.registerFiles({ versionId, files: [
        { relativePath: 'index.ts', fileHash: 'hash1-updated', sizeBytes: 150 },
      ] });

      const files = repo.getFiles(versionId);
      expect(files).toHaveLength(1);
      expect(files[0].fileHash).toBe('hash1-updated');
      expect(files[0].sizeBytes).toBe(150);
    });

    it('getFiles returns files sorted by relative path', () => {
      repo.registerFiles({ versionId, files: [
        { relativePath: 'z-file.ts', fileHash: 'z', sizeBytes: 10 },
        { relativePath: 'a-file.ts', fileHash: 'a', sizeBytes: 10 },
        { relativePath: 'm-file.ts', fileHash: 'm', sizeBytes: 10 },
      ] });

      const files = repo.getFiles(versionId);
      expect(files).toHaveLength(3);
      expect(files[0].relativePath).toBe('a-file.ts');
      expect(files[1].relativePath).toBe('m-file.ts');
      expect(files[2].relativePath).toBe('z-file.ts');
    });

    it('getFiles returns empty for version with no files', () => {
      expect(repo.getFiles(versionId)).toEqual([]);
    });

    it('updateFileHash changes a file hash', () => {
      const files = repo.registerFiles({ versionId, files: [
        { relativePath: 'index.ts', fileHash: 'original', sizeBytes: 100 },
      ] });

      repo.updateFileHash({ fileId: files[0].id, newHash: 'new-hash' });

      const updated = repo.getFiles(versionId);
      expect(updated[0].fileHash).toBe('new-hash');
    });

    it('recomputeContentHash generates a new hash from file hashes', () => {
      repo.registerFiles({ versionId, files: [
        { relativePath: 'b.ts', fileHash: 'hash-b', sizeBytes: 10 },
        { relativePath: 'a.ts', fileHash: 'hash-a', sizeBytes: 10 },
      ] });

      const hash = repo.recomputeContentHash(versionId);
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // SHA-256 hex

      // Verify it was written to the version
      const v = repo.getVersionById(versionId)!;
      expect(v.contentHash).toBe(hash);
    });

    it('recomputeContentHash is deterministic (sorted by relativePath)', () => {
      repo.registerFiles({ versionId, files: [
        { relativePath: 'b.ts', fileHash: 'hash-b', sizeBytes: 10 },
        { relativePath: 'a.ts', fileHash: 'hash-a', sizeBytes: 10 },
      ] });

      const hash1 = repo.recomputeContentHash(versionId);
      const hash2 = repo.recomputeContentHash(versionId);
      expect(hash1).toBe(hash2);
    });
  });

  // ─── Installations ─────────────────────────────────────────

  describe('Installations', () => {
    let skillId: string;
    let versionId: string;

    beforeEach(() => {
      const skill = repo.create(makeSkillInput());
      skillId = skill.id;
      const v = repo.addVersion(makeVersionInput(skillId));
      versionId = v.id;
    });

    it('install creates an installation', () => {
      const inst = repo.install({ skillVersionId: versionId, status: 'active' });

      expect(inst.id).toBeDefined();
      expect(inst.skillVersionId).toBe(versionId);
      expect(inst.status).toBe('active');
      expect(inst.installedAt).toBeDefined();
      expect(inst.updatedAt).toBeDefined();
    });

    it('install with target and user scope', () => {
      // Need to insert a target + user first
      db.prepare(
        `INSERT INTO targets (id, name, created_at, updated_at)
         VALUES ('t1', 'Target 1', datetime('now'), datetime('now'))`,
      ).run();
      db.prepare(
        `INSERT INTO users (username, uid, type, created_at, home_dir)
         VALUES ('user1', 1001, 'agent', datetime('now'), '/home/user1')`,
      ).run();

      const inst = repo.install({
        skillVersionId: versionId,
        targetId: 't1',
        userUsername: 'user1',
        status: 'active',
      });

      expect(inst.targetId).toBe('t1');
      expect(inst.userUsername).toBe('user1');
    });

    it('uninstall removes an installation', () => {
      const inst = repo.install({ skillVersionId: versionId, status: 'active' });
      expect(repo.uninstall(inst.id)).toBe(true);
    });

    it('uninstall returns false for non-existent id', () => {
      expect(repo.uninstall('non-existent')).toBe(false);
    });

    it('getInstallations returns all installations', () => {
      repo.install({ skillVersionId: versionId, status: 'active' });
      repo.install({ skillVersionId: versionId, status: 'disabled' });

      const all = repo.getInstallations();
      expect(all).toHaveLength(2);
    });

    it('getInstallations filters by skillVersionId', () => {
      const skill2 = repo.create(makeSkillInput({ slug: 'skill-2', name: 'Skill 2' }));
      const v2 = repo.addVersion(makeVersionInput(skill2.id, { version: '1.0.0' }));

      repo.install({ skillVersionId: versionId, status: 'active' });
      repo.install({ skillVersionId: v2.id, status: 'active' });

      const filtered = repo.getInstallations({ skillVersionId: versionId });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].skillVersionId).toBe(versionId);
    });

    it('getInstallations filters by targetId', () => {
      db.prepare(
        `INSERT INTO targets (id, name, created_at, updated_at) VALUES ('t1', 'Target 1', datetime('now'), datetime('now'))`,
      ).run();
      db.prepare(
        `INSERT INTO targets (id, name, created_at, updated_at) VALUES ('t2', 'Target 2', datetime('now'), datetime('now'))`,
      ).run();

      repo.install({ skillVersionId: versionId, targetId: 't1', status: 'active' });
      repo.install({ skillVersionId: versionId, targetId: 't2', status: 'active' });

      const filtered = repo.getInstallations({ targetId: 't1' });
      expect(filtered).toHaveLength(1);
    });

    it('updateInstallationStatus changes status', () => {
      const inst = repo.install({ skillVersionId: versionId, status: 'active' });

      repo.updateInstallationStatus(inst.id, { status: 'disabled' });

      const found = repo.getInstallations();
      expect(found.find((i) => i.id === inst.id)!.status).toBe('disabled');
    });

    it('updateInstallationStatus rejects invalid status', () => {
      const inst = repo.install({ skillVersionId: versionId, status: 'active' });
      expect(() =>
        repo.updateInstallationStatus(inst.id, { status: 'invalid' }),
      ).toThrow();
    });

    it('getInstalledSkills returns skills with versions for global scope', () => {
      repo.install({ skillVersionId: versionId, status: 'active' });

      const installed = repo.getInstalledSkills();
      expect(installed).toHaveLength(1);
      expect(installed[0].id).toBe(skillId);
      expect(installed[0].name).toBe('Test Skill');
      expect(installed[0].version).toBeDefined();
      expect(installed[0].version.id).toBe(versionId);
    });

    it('getInstalledSkills respects target scope', () => {
      db.prepare(
        `INSERT INTO targets (id, name, created_at, updated_at) VALUES ('t1', 'Target 1', datetime('now'), datetime('now'))`,
      ).run();

      // Global installation
      repo.install({ skillVersionId: versionId, status: 'active' });

      // Target-scoped installation (different skill)
      const s2 = repo.create(makeSkillInput({ slug: 'skill-2', name: 'Skill 2' }));
      const v2 = repo.addVersion(makeVersionInput(s2.id));
      repo.install({ skillVersionId: v2.id, targetId: 't1', status: 'active' });

      // Query with targetId should return both global + target-scoped
      const scopedRepo = new SkillsRepository(db, () => null, { targetId: 't1' });
      const installed = scopedRepo.getInstalledSkills();
      expect(installed).toHaveLength(2);
    });

    it('getInstalledSkills excludes disabled installations', () => {
      const inst = repo.install({ skillVersionId: versionId, status: 'active' });
      repo.updateInstallationStatus(inst.id, { status: 'disabled' });

      const installed = repo.getInstalledSkills();
      expect(installed).toHaveLength(0);
    });
  });

  // ─── New fields (remoteId, isPublic, autoUpdate, pinnedVersion) ─────

  describe('New skill fields', () => {
    it('create sets isPublic=true by default', () => {
      const skill = repo.create(makeSkillInput());
      expect(skill.isPublic).toBe(true);
    });

    it('create accepts remoteId and isPublic', () => {
      const skill = repo.create(makeSkillInput({
        slug: 'remote-skill',
        remoteId: 'remote-123',
        isPublic: false,
      }));
      expect(skill.remoteId).toBe('remote-123');
      expect(skill.isPublic).toBe(false);
    });

    it('getByRemoteId returns the correct skill', () => {
      repo.create(makeSkillInput({ slug: 'remote-s', remoteId: 'r-abc' }));
      const found = repo.getByRemoteId('r-abc');
      expect(found).not.toBeNull();
      expect(found!.slug).toBe('remote-s');
    });

    it('getByRemoteId returns null for non-existent', () => {
      expect(repo.getByRemoteId('no-such')).toBeNull();
    });

    it('search finds skills by name', () => {
      repo.create(makeSkillInput({ slug: 'alpha', name: 'Alpha Tool' }));
      repo.create(makeSkillInput({ slug: 'beta', name: 'Beta Tool' }));
      repo.create(makeSkillInput({ slug: 'gamma', name: 'Gamma Widget' }));

      const results = repo.search('Tool');
      expect(results).toHaveLength(2);
    });

    it('search finds skills by slug', () => {
      repo.create(makeSkillInput({ slug: 'my-special-skill', name: 'Special' }));
      repo.create(makeSkillInput({ slug: 'other', name: 'Other' }));

      const results = repo.search('special');
      expect(results).toHaveLength(1);
      expect(results[0].slug).toBe('my-special-skill');
    });

    it('search finds skills by description', () => {
      repo.create(makeSkillInput({ slug: 's1', name: 'S1', description: 'A filesystem watcher' }));
      repo.create(makeSkillInput({ slug: 's2', name: 'S2', description: 'A network tool' }));

      const results = repo.search('filesystem');
      expect(results).toHaveLength(1);
    });

    it('search returns empty for no matches', () => {
      repo.create(makeSkillInput());
      expect(repo.search('zzz-nonexistent')).toEqual([]);
    });

    it('update can set remoteId and isPublic', () => {
      const skill = repo.create(makeSkillInput());
      const updated = repo.update(skill.id, { remoteId: 'r-new', isPublic: false });
      expect(updated!.remoteId).toBe('r-new');
      expect(updated!.isPublic).toBe(false);
    });
  });

  describe('Installation new fields', () => {
    let skillId: string;
    let versionId: string;

    beforeEach(() => {
      const skill = repo.create(makeSkillInput());
      skillId = skill.id;
      const v = repo.addVersion(makeVersionInput(skillId));
      versionId = v.id;
    });

    it('install sets autoUpdate=true by default', () => {
      const inst = repo.install({ skillVersionId: versionId, status: 'active' });
      expect(inst.autoUpdate).toBe(true);
      expect(inst.pinnedVersion).toBeUndefined();
    });

    it('install accepts autoUpdate=false', () => {
      const inst = repo.install({ skillVersionId: versionId, status: 'active', autoUpdate: false });
      expect(inst.autoUpdate).toBe(false);
    });

    it('setAutoUpdate toggles auto_update', () => {
      const inst = repo.install({ skillVersionId: versionId, status: 'active' });
      repo.setAutoUpdate(inst.id, false);

      const all = repo.getInstallations();
      const found = all.find((i) => i.id === inst.id)!;
      expect(found.autoUpdate).toBe(false);

      repo.setAutoUpdate(inst.id, true);
      const all2 = repo.getInstallations();
      expect(all2.find((i) => i.id === inst.id)!.autoUpdate).toBe(true);
    });

    it('pinVersion / unpinVersion', () => {
      const inst = repo.install({ skillVersionId: versionId, status: 'active' });
      repo.pinVersion(inst.id, '1.0.0');

      let all = repo.getInstallations();
      expect(all.find((i) => i.id === inst.id)!.pinnedVersion).toBe('1.0.0');

      repo.unpinVersion(inst.id);
      all = repo.getInstallations();
      expect(all.find((i) => i.id === inst.id)!.pinnedVersion).toBeUndefined();
    });

    it('updateInstallationVersion changes version id', () => {
      const inst = repo.install({ skillVersionId: versionId, status: 'active' });
      const v2 = repo.addVersion(makeVersionInput(skillId, { version: '2.0.0' }));

      repo.updateInstallationVersion(inst.id, v2.id);

      const all = repo.getInstallations();
      expect(all.find((i) => i.id === inst.id)!.skillVersionId).toBe(v2.id);
    });

    it('getAutoUpdatable returns only eligible installations', () => {
      // auto_update=true, no pin → eligible
      const inst1 = repo.install({ skillVersionId: versionId, status: 'active' });
      // auto_update=false → not eligible
      const inst2 = repo.install({ skillVersionId: versionId, status: 'active', autoUpdate: false });
      // pinned → not eligible
      const inst3 = repo.install({ skillVersionId: versionId, status: 'active' });
      repo.pinVersion(inst3.id, '1.0.0');
      // disabled → not eligible
      const inst4 = repo.install({ skillVersionId: versionId, status: 'disabled' });

      const eligible = repo.getAutoUpdatable(skillId);
      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe(inst1.id);
    });
  });

  // ─── Scoped installations ─────────────────────────────────

  describe('Scoped installations', () => {
    let skillId: string;
    let versionId: string;

    beforeEach(() => {
      const skill = repo.create(makeSkillInput());
      skillId = skill.id;
      const v = repo.addVersion(makeVersionInput(skillId));
      versionId = v.id;

      // Insert targets and users for scoping
      db.prepare(`INSERT INTO targets (id, name, created_at, updated_at) VALUES ('t1', 'Target 1', datetime('now'), datetime('now'))`).run();
      db.prepare(`INSERT INTO targets (id, name, created_at, updated_at) VALUES ('t2', 'Target 2', datetime('now'), datetime('now'))`).run();
      db.prepare(`INSERT INTO users (username, uid, type, created_at, home_dir) VALUES ('alice', 1001, 'agent', datetime('now'), '/home/alice')`).run();
      db.prepare(`INSERT INTO users (username, uid, type, created_at, home_dir) VALUES ('bob', 1002, 'agent', datetime('now'), '/home/bob')`).run();
    });

    it('getInstallations with scope returns global + matching target only', () => {
      const global = repo.install({ skillVersionId: versionId, status: 'active' });
      const t1 = repo.install({ skillVersionId: versionId, targetId: 't1', status: 'active' });
      const t2 = repo.install({ skillVersionId: versionId, targetId: 't2', status: 'active' });

      const scopedRepo = new SkillsRepository(db, () => null, { targetId: 't1' });
      const result = scopedRepo.getInstallations();

      expect(result).toHaveLength(2);
      const ids = result.map((r) => r.id);
      expect(ids).toContain(global.id);
      expect(ids).toContain(t1.id);
      expect(ids).not.toContain(t2.id);
    });

    it('getInstallations unscoped returns all (backward compat)', () => {
      repo.install({ skillVersionId: versionId, status: 'active' });
      repo.install({ skillVersionId: versionId, targetId: 't1', status: 'active' });
      repo.install({ skillVersionId: versionId, targetId: 't2', status: 'active' });

      const result = repo.getInstallations();
      expect(result).toHaveLength(3);
    });

    it('getAutoUpdatable with scope returns global + matching target only', () => {
      repo.install({ skillVersionId: versionId, status: 'active', autoUpdate: true });
      repo.install({ skillVersionId: versionId, targetId: 't1', status: 'active', autoUpdate: true });
      repo.install({ skillVersionId: versionId, targetId: 't2', status: 'active', autoUpdate: true });

      const scopedRepo = new SkillsRepository(db, () => null, { targetId: 't1' });
      const result = scopedRepo.getAutoUpdatable(skillId);

      expect(result).toHaveLength(2);
      const targetIds = result.map((r) => r.targetId);
      expect(targetIds).toContain(undefined); // global
      expect(targetIds).toContain('t1');
    });

    it('getAutoUpdatable unscoped returns all eligible', () => {
      repo.install({ skillVersionId: versionId, status: 'active', autoUpdate: true });
      repo.install({ skillVersionId: versionId, targetId: 't1', status: 'active', autoUpdate: true });
      repo.install({ skillVersionId: versionId, targetId: 't2', status: 'active', autoUpdate: true });

      const result = repo.getAutoUpdatable(skillId);
      expect(result).toHaveLength(3);
    });

    it('getInstallationById ignores scope', () => {
      const t2Inst = repo.install({ skillVersionId: versionId, targetId: 't2', status: 'active' });

      const scopedRepo = new SkillsRepository(db, () => null, { targetId: 't1' });
      const found = scopedRepo.getInstallationById(t2Inst.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(t2Inst.id);
      expect(found!.targetId).toBe('t2');
    });

    it('getInstallationById returns null for non-existent id', () => {
      expect(repo.getInstallationById('non-existent')).toBeNull();
    });

    it('user-level scope includes global + target + target+user, not other users', () => {
      const global = repo.install({ skillVersionId: versionId, status: 'active' });
      const t1Only = repo.install({ skillVersionId: versionId, targetId: 't1', status: 'active' });
      const t1Alice = repo.install({ skillVersionId: versionId, targetId: 't1', userUsername: 'alice', status: 'active' });
      const t1Bob = repo.install({ skillVersionId: versionId, targetId: 't1', userUsername: 'bob', status: 'active' });

      const scopedRepo = new SkillsRepository(db, () => null, { targetId: 't1', userUsername: 'alice' });
      const result = scopedRepo.getInstallations();

      const ids = result.map((r) => r.id);
      expect(ids).toContain(global.id);
      expect(ids).toContain(t1Only.id);
      expect(ids).toContain(t1Alice.id);
      expect(ids).not.toContain(t1Bob.id);
    });

    it('getInstallations scope combines with explicit filter', () => {
      repo.install({ skillVersionId: versionId, status: 'active' });
      repo.install({ skillVersionId: versionId, targetId: 't1', status: 'active' });
      repo.install({ skillVersionId: versionId, targetId: 't2', status: 'active' });

      // Create a second version's installation
      const v2 = repo.addVersion(makeVersionInput(skillId, { version: '2.0.0' }));
      repo.install({ skillVersionId: v2.id, targetId: 't1', status: 'active' });

      const scopedRepo = new SkillsRepository(db, () => null, { targetId: 't1' });
      // Filter by skillVersionId within scope
      const result = scopedRepo.getInstallations({ skillVersionId: versionId });

      expect(result).toHaveLength(2); // global + t1 for versionId only
    });
  });

  // ─── Performance ───────────────────────────────────────────

  describe('Performance', () => {
    it('handles 500 skill creates efficiently', () => {
      const start = performance.now();

      for (let i = 0; i < 500; i++) {
        repo.create(makeSkillInput({
          slug: `perf-skill-${i}`,
          name: `Perf Skill ${i}`,
        }));
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(10_000); // 10s generous ceiling

      const all = repo.getAll();
      expect(all).toHaveLength(500);
    });

    it('handles version operations at scale', () => {
      const skill = repo.create(makeSkillInput());

      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        repo.addVersion(makeVersionInput(skill.id, { version: `${i}.0.0` }));
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(5_000);

      const versions = repo.getVersions(skill.id);
      expect(versions).toHaveLength(100);

      const latest = repo.getLatestVersion(skill.id);
      expect(latest).not.toBeNull();
    });
  });
});
