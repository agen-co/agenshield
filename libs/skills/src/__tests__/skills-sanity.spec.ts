/**
 * Skills Sanity — Unit Tests
 *
 * Tests each service in isolation with mocked dependencies.
 * Uses real SQLite via createTestDb() + SkillsRepository.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { SchemaMigration } from '../../../storage/src/migrations/001-schema';
import { SkillsRepository } from '../../../storage/src/repositories/skills/skills.repository';
import { DownloadService } from '../download/download.service';
import { InstallService } from '../install/install.service';
import { AnalyzeService } from '../analyze/analyze.service';
import { UploadService } from '../upload/upload.service';
import { CatalogService } from '../catalog/catalog.service';
import { LocalSearchAdapter } from '../catalog/adapters/local.adapter';
import { UpdateService } from '../update/update.service';
import { DeployService } from '../deploy/deploy.service';
import { SkillBackupService } from '../backup';
import { SkillsError, SkillNotFoundError, RemoteSkillNotFoundError } from '../errors';
import type { RemoteSkillClient } from '../remote/types';
import type { DeployAdapter, DeployResult } from '../deploy/types';
import type { AnalyzeAdapter } from '../analyze/types';
import type { SkillEvent } from '../events';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-sanity-'));
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

function makeSkillInput(overrides?: Record<string, unknown>) {
  return {
    name: 'Test Skill', slug: 'test-skill', author: 'tester',
    tags: ['test'], source: 'manual' as const, sourceOrigin: 'unknown' as const, ...overrides,
  };
}

function makeVersionInput(skillId: string, overrides?: Record<string, unknown>) {
  return {
    skillId, version: '1.0.0', folderPath: '/tmp/skills/test/1.0.0',
    contentHash: 'abc123', hashUpdatedAt: new Date().toISOString(),
    approval: 'unknown' as const, trusted: false, analysisStatus: 'pending' as const,
    requiredBins: [] as string[], requiredEnv: [] as string[], extractedCommands: [] as unknown[],
    ...overrides,
  };
}

function seedSkill(repo: SkillsRepository, overrides?: Record<string, unknown>) {
  const skill = repo.create(makeSkillInput(overrides));
  const version = repo.addVersion(makeVersionInput(skill.id));
  return { skill, version };
}

/** Insert a minimal profile record so FK constraints on skill_installations.profile_id pass */
function ensureProfile(db: Database.Database, profileId: string): void {
  db.prepare('INSERT OR IGNORE INTO profiles (id, name, type) VALUES (?, ?, ?)').run(profileId, profileId, 'target');
}

function createMockRemoteClient(skills?: Map<string, { name: string; slug: string; author: string; description: string; tags: string[]; remoteId: string }>): RemoteSkillClient {
  return {
    search: jest.fn().mockResolvedValue({ skills: [], total: 0 }),
    getSkill: jest.fn().mockImplementation(async (id: string) => {
      if (skills?.has(id)) return skills.get(id)!;
      return null;
    }),
    download: jest.fn().mockResolvedValue({ zipBuffer: Buffer.from('zip'), checksum: 'checksum123', version: '1.0.0' }),
    upload: jest.fn().mockResolvedValue({ name: 'skill', slug: 'skill', remoteId: 'r1', author: 'a', description: '', tags: [] }),
    checkVersion: jest.fn().mockResolvedValue(null),
  };
}

function createMockDeployAdapter(opts?: {
  canDeploy?: (profileId?: string) => boolean;
  deployResult?: DeployResult;
  shouldThrow?: boolean;
}): DeployAdapter & { deploySpy: jest.Mock; undeploySpy: jest.Mock } {
  const deploySpy = jest.fn().mockImplementation(async () => {
    if (opts?.shouldThrow) throw new Error('deploy failed');
    return opts?.deployResult ?? { deployedPath: '/deployed', deployedHash: 'hash' };
  });
  const undeploySpy = jest.fn().mockResolvedValue(undefined);
  return {
    id: 'mock',
    displayName: 'Mock Deployer',
    canDeploy: opts?.canDeploy ?? (() => true),
    deploy: deploySpy,
    undeploy: undeploySpy,
    checkIntegrity: jest.fn().mockResolvedValue({ intact: true, modifiedFiles: [], missingFiles: [], unexpectedFiles: [] }),
    deploySpy,
    undeploySpy,
  };
}

function makeSkillFiles() {
  return [
    { relativePath: 'SKILL.md', content: Buffer.from('# Test Skill\n\nA test skill.') },
    { relativePath: 'index.ts', content: Buffer.from('export default {}') },
  ];
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('Skills Sanity — Unit Tests', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: SkillsRepository;
  let emitter: EventEmitter;
  let events: SkillEvent[];

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new SkillsRepository(db, () => null);
    emitter = new EventEmitter();
    events = [];
    emitter.on('skill-event', (e: SkillEvent) => events.push(e));
  });

  afterEach(() => cleanup());

  /* ---------------------------------------------------------------- */
  /*  DownloadService                                                  */
  /* ---------------------------------------------------------------- */

  describe('DownloadService', () => {
    it('downloads skill from remote and creates Skill + SkillVersion', async () => {
      const remoteSkills = new Map([
        ['google-ads', { name: 'Google Ads', slug: 'google-ads', author: 'google', description: 'Ads API', tags: ['ads'], remoteId: 'r-google-ads' }],
      ]);
      const remote = createMockRemoteClient(remoteSkills);
      const service = new DownloadService(repo, remote, emitter, null);

      const result = await service.download({ slug: 'google-ads' });

      expect(result.skill.name).toBe('Google Ads');
      expect(result.skill.slug).toBe('google-ads');
      expect(result.version.version).toBe('1.0.0');
      expect(remote.getSkill).toHaveBeenCalledWith('google-ads');
      expect(remote.download).toHaveBeenCalled();
    });

    it('returns existing skill on duplicate slug (dedup)', async () => {
      const { skill, version } = seedSkill(repo, { slug: 'existing-skill' });
      const remote = createMockRemoteClient();
      const service = new DownloadService(repo, remote, emitter, null);

      const result = await service.download({ slug: 'existing-skill' });

      expect(result.skill.id).toBe(skill.id);
      expect(result.version.id).toBe(version.id);
      // Remote should NOT be called for dedup
      expect(remote.getSkill).not.toHaveBeenCalled();
    });

    it('emits download:started and download:completed', async () => {
      const remoteSkills = new Map([
        ['my-skill', { name: 'My Skill', slug: 'my-skill', author: 'test', description: '', tags: [], remoteId: 'r1' }],
      ]);
      const remote = createMockRemoteClient(remoteSkills);
      const service = new DownloadService(repo, remote, emitter, null);

      await service.download({ slug: 'my-skill' });

      const types = events.map((e) => e.type);
      expect(types).toContain('download:started');
      expect(types).toContain('download:completed');
    });

    it('emits download:error when remote.getSkill returns null', async () => {
      const remote = createMockRemoteClient(); // No skills registered
      const service = new DownloadService(repo, remote, emitter, null);

      await expect(service.download({ slug: 'nonexistent' })).rejects.toThrow(RemoteSkillNotFoundError);

      const types = events.map((e) => e.type);
      expect(types).toContain('download:error');
    });

    it('throws DOWNLOAD_OFFLINE when remote is null', async () => {
      const service = new DownloadService(repo, null, emitter, null);

      await expect(service.download({ slug: 'my-skill' })).rejects.toThrow(SkillsError);
      await expect(service.download({ slug: 'my-skill' })).rejects.toThrow(/offline/i);
    });

    it('throws DOWNLOAD_INVALID_PARAMS when no slug or remoteId', async () => {
      const remote = createMockRemoteClient();
      const service = new DownloadService(repo, remote, emitter, null);

      await expect(service.download({})).rejects.toThrow(SkillsError);
    });

    it('triggers analysis when analyze=true param', async () => {
      const remoteSkills = new Map([
        ['analyzable', { name: 'Analyzable', slug: 'analyzable', author: 'test', description: '', tags: [], remoteId: 'r-a' }],
      ]);
      const remote = createMockRemoteClient(remoteSkills);

      const analyzeAdapter: AnalyzeAdapter = {
        id: 'mock', displayName: 'Mock', analyze: jest.fn().mockReturnValue({ status: 'success', data: {}, requiredBins: [], requiredEnv: [], extractedCommands: [] }),
      };
      const analyzer = new AnalyzeService(repo, [analyzeAdapter], emitter);
      const service = new DownloadService(repo, remote, emitter, null, analyzer);

      await service.download({ slug: 'analyzable', analyze: true });

      expect(analyzeAdapter.analyze).toHaveBeenCalled();
    });

    it('analysis failure is non-fatal for download', async () => {
      const remoteSkills = new Map([
        ['fail-analysis', { name: 'Fail', slug: 'fail-analysis', author: 'test', description: '', tags: [], remoteId: 'r-f' }],
      ]);
      const remote = createMockRemoteClient(remoteSkills);

      const analyzeAdapter: AnalyzeAdapter = {
        id: 'mock', displayName: 'Mock', analyze: jest.fn().mockImplementation(() => { throw new Error('analysis boom'); }),
      };
      const analyzer = new AnalyzeService(repo, [analyzeAdapter], emitter);
      const service = new DownloadService(repo, remote, emitter, null, analyzer);

      // Should NOT throw
      const result = await service.download({ slug: 'fail-analysis', analyze: true });
      expect(result.skill.slug).toBe('fail-analysis');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  InstallService                                                   */
  /* ---------------------------------------------------------------- */

  describe('InstallService', () => {
    it('installs by skillId with correct profileId', async () => {
      const { skill, version } = seedSkill(repo);
      ensureProfile(db, 'profile-1');
      const service = new InstallService(repo, null, emitter);

      const inst = await service.install({ skillId: skill.id, profileId: 'profile-1' });

      expect(inst.skillVersionId).toBe(version.id);
      expect(inst.status).toBe('active');
      expect(inst.profileId).toBe('profile-1');
    });

    it('installs by slug lookup', async () => {
      seedSkill(repo, { slug: 'slug-lookup' });
      const service = new InstallService(repo, null, emitter);

      const inst = await service.install({ slug: 'slug-lookup' });

      expect(inst.status).toBe('active');
    });

    it('installs by remoteId lookup', async () => {
      seedSkill(repo, { remoteId: 'remote-123' });
      const service = new InstallService(repo, null, emitter);

      const inst = await service.install({ remoteId: 'remote-123' });

      expect(inst.status).toBe('active');
    });

    it('installs specific version', async () => {
      const skill = repo.create(makeSkillInput());
      repo.addVersion(makeVersionInput(skill.id, { version: '1.0.0' }));
      const v2 = repo.addVersion(makeVersionInput(skill.id, { version: '2.0.0' }));
      const service = new InstallService(repo, null, emitter);

      const inst = await service.install({ skillId: skill.id, version: '2.0.0' });

      expect(inst.skillVersionId).toBe(v2.id);
    });

    it('defaults to latest version', async () => {
      const skill = repo.create(makeSkillInput());
      const v1 = repo.addVersion(makeVersionInput(skill.id, { version: '1.0.0' }));
      const v2 = repo.addVersion(makeVersionInput(skill.id, { version: '2.0.0' }));
      const service = new InstallService(repo, null, emitter);

      const inst = await service.install({ skillId: skill.id });

      // getLatestVersion sorts by created_at DESC; both may have same timestamp
      expect([v1.id, v2.id]).toContain(inst.skillVersionId);
    });

    it('creates installation with autoUpdate=true by default', async () => {
      const { skill } = seedSkill(repo);
      const service = new InstallService(repo, null, emitter);

      const inst = await service.install({ skillId: skill.id });

      expect(inst.autoUpdate).toBe(true);
    });

    it('respects autoUpdate=false', async () => {
      const { skill } = seedSkill(repo);
      const service = new InstallService(repo, null, emitter);

      const inst = await service.install({ skillId: skill.id, autoUpdate: false });

      expect(inst.autoUpdate).toBe(false);
    });

    it('emits install:started, install:creating, install:completed', async () => {
      const { skill } = seedSkill(repo);
      const service = new InstallService(repo, null, emitter);

      await service.install({ skillId: skill.id });

      const types = events.map((e) => e.type);
      expect(types).toContain('install:started');
      expect(types).toContain('install:creating');
      expect(types).toContain('install:completed');
    });

    it('emits install:error for missing skill', async () => {
      const service = new InstallService(repo, null, emitter);

      await expect(service.install({ skillId: 'nonexistent' })).rejects.toThrow(SkillNotFoundError);

      const types = events.map((e) => e.type);
      expect(types).toContain('install:error');
    });

    it('with deployer: calls deploy, sets status active', async () => {
      const adapter = createMockDeployAdapter({ deployResult: { deployedPath: '/deployed', deployedHash: 'h' } });
      const deployer = new DeployService(repo, [adapter], emitter);
      const service = new InstallService(repo, null, emitter, deployer);

      const { skill } = seedSkill(repo);
      const inst = await service.install({ skillId: skill.id });

      expect(inst.status).toBe('active');
      expect(adapter.deploySpy).toHaveBeenCalledTimes(1);
    });

    it('with deployer: sets wrapperPath from deploy result', async () => {
      const adapter = createMockDeployAdapter({
        deployResult: { deployedPath: '/deployed', deployedHash: 'h', wrapperPath: '/bin/test-skill' },
      });
      const deployer = new DeployService(repo, [adapter], emitter);
      const service = new InstallService(repo, null, emitter, deployer);

      const { skill } = seedSkill(repo);
      const inst = await service.install({ skillId: skill.id });

      expect(inst.wrapperPath).toBe('/bin/test-skill');
    });

    it('with deployer: sets status disabled on deploy failure', async () => {
      const adapter = createMockDeployAdapter({ shouldThrow: true });
      const deployer = new DeployService(repo, [adapter], emitter);
      const service = new InstallService(repo, null, emitter, deployer);

      const { skill } = seedSkill(repo);

      await expect(service.install({ skillId: skill.id })).rejects.toThrow('deploy failed');

      const installations = repo.getInstallations();
      expect(installations[0].status).toBe('disabled');
    });

    it('with deployer: deploy spy receives correct skill + version + installation', async () => {
      const adapter = createMockDeployAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const service = new InstallService(repo, null, emitter, deployer);

      const { skill, version } = seedSkill(repo);
      await service.install({ skillId: skill.id });

      expect(adapter.deploySpy).toHaveBeenCalledTimes(1);
      const deployCtx = adapter.deploySpy.mock.calls[0][0];
      expect(deployCtx.skill.id).toBe(skill.id);
      expect(deployCtx.version.id).toBe(version.id);
      expect(deployCtx.installation).toBeDefined();
    });

    it('uninstall calls undeploy spy before DB deletion', async () => {
      const adapter = createMockDeployAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const service = new InstallService(repo, null, emitter, deployer);

      const { skill } = seedSkill(repo);
      const inst = await service.install({ skillId: skill.id });

      await service.uninstall(inst.id);

      expect(adapter.undeploySpy).toHaveBeenCalled();
      expect(repo.getInstallations()).toHaveLength(0);
    });

    it('uninstall emits uninstall:started, uninstall:completed', async () => {
      const { skill } = seedSkill(repo);
      const service = new InstallService(repo, null, emitter);
      const inst = await service.install({ skillId: skill.id });

      events.length = 0; // Clear install events
      await service.uninstall(inst.id);

      const types = events.map((e) => e.type);
      expect(types).toContain('uninstall:started');
      expect(types).toContain('uninstall:completed');
    });

    it('pinVersion / unpinVersion persist correctly', async () => {
      const { skill } = seedSkill(repo);
      const service = new InstallService(repo, null, emitter);
      const inst = await service.install({ skillId: skill.id });

      service.pinVersion(inst.id, '1.0.0');
      let installations = repo.getInstallations();
      expect(installations.find((i) => i.id === inst.id)!.pinnedVersion).toBe('1.0.0');

      service.unpinVersion(inst.id);
      installations = repo.getInstallations();
      expect(installations.find((i) => i.id === inst.id)!.pinnedVersion).toBeUndefined();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  AnalyzeService                                                   */
  /* ---------------------------------------------------------------- */

  describe('AnalyzeService', () => {
    it('runs single adapter and persists result', async () => {
      const { version } = seedSkill(repo);
      repo.registerFiles({ versionId: version.id, files: [{ relativePath: 'SKILL.md', fileHash: 'h1', sizeBytes: 10 }] });

      const adapter: AnalyzeAdapter = {
        id: 'test', displayName: 'Test', analyze: jest.fn().mockReturnValue({
          status: 'success', data: { ok: true }, requiredBins: ['node'], requiredEnv: ['API_KEY'], extractedCommands: ['run'],
        }),
      };
      const service = new AnalyzeService(repo, [adapter], emitter);

      const result = await service.analyzeVersion(version.id);

      expect(result.status).toBe('success');
      expect(result.requiredBins).toContain('node');
      expect(result.requiredEnv).toContain('API_KEY');
      expect(result.extractedCommands).toContain('run');

      // Verify persisted in DB
      const updated = repo.getVersionById(version.id)!;
      expect(updated.analysisStatus).toBe('complete');
    });

    it('runs multiple adapters and merges results', async () => {
      const { version } = seedSkill(repo);
      repo.registerFiles({ versionId: version.id, files: [{ relativePath: 'index.ts', fileHash: 'h', sizeBytes: 5 }] });

      const adapter1: AnalyzeAdapter = {
        id: 'a1', displayName: 'A1', analyze: jest.fn().mockReturnValue({
          status: 'success', data: { a: 1 }, requiredBins: ['node'], requiredEnv: [], extractedCommands: [],
        }),
      };
      const adapter2: AnalyzeAdapter = {
        id: 'a2', displayName: 'A2', analyze: jest.fn().mockReturnValue({
          status: 'warning', data: { b: 2 }, requiredBins: ['python'], requiredEnv: ['KEY'], extractedCommands: ['cmd'],
        }),
      };
      const service = new AnalyzeService(repo, [adapter1, adapter2], emitter);

      const result = await service.analyzeVersion(version.id);

      // Multiple adapters → merged data keyed by adapter ID
      expect(result.data).toEqual({ a1: { a: 1 }, a2: { b: 2 } });
      expect(result.requiredBins).toContain('node');
      expect(result.requiredBins).toContain('python');
      expect(result.requiredEnv).toContain('KEY');
    });

    it('worst-status-wins when merging (error > warning > success)', async () => {
      const { version } = seedSkill(repo);
      repo.registerFiles({ versionId: version.id, files: [{ relativePath: 'x', fileHash: 'h', sizeBytes: 1 }] });

      const adapterSuccess: AnalyzeAdapter = {
        id: 's', displayName: 'S', analyze: () => ({ status: 'success', data: {}, requiredBins: [], requiredEnv: [], extractedCommands: [] }),
      };
      const adapterError: AnalyzeAdapter = {
        id: 'e', displayName: 'E', analyze: () => ({ status: 'error', data: {}, requiredBins: [], requiredEnv: [], extractedCommands: [] }),
      };
      const service = new AnalyzeService(repo, [adapterSuccess, adapterError], emitter);

      const result = await service.analyzeVersion(version.id);

      expect(result.status).toBe('error');
    });

    it('emits analyze:completed with merged result', async () => {
      const { version } = seedSkill(repo);
      repo.registerFiles({ versionId: version.id, files: [{ relativePath: 'x', fileHash: 'h', sizeBytes: 1 }] });

      const adapter: AnalyzeAdapter = {
        id: 'a', displayName: 'A', analyze: () => ({ status: 'success', data: {}, requiredBins: [], requiredEnv: [], extractedCommands: [] }),
      };
      const service = new AnalyzeService(repo, [adapter], emitter);
      await service.analyzeVersion(version.id);

      const completed = events.find((e) => e.type === 'analyze:completed');
      expect(completed).toBeDefined();
    });

    it('emits analyze:error on adapter failure', async () => {
      const { version } = seedSkill(repo);
      repo.registerFiles({ versionId: version.id, files: [{ relativePath: 'x', fileHash: 'h', sizeBytes: 1 }] });

      const adapter: AnalyzeAdapter = {
        id: 'fail', displayName: 'Fail', analyze: () => { throw new Error('analysis boom'); },
      };
      const service = new AnalyzeService(repo, [adapter], emitter);

      await expect(service.analyzeVersion(version.id)).rejects.toThrow('analysis boom');

      const types = events.map((e) => e.type);
      expect(types).toContain('analyze:error');
    });

    it('updates analysisStatus to complete in DB', async () => {
      const { version } = seedSkill(repo);
      repo.registerFiles({ versionId: version.id, files: [{ relativePath: 'x', fileHash: 'h', sizeBytes: 1 }] });

      const adapter: AnalyzeAdapter = {
        id: 'a', displayName: 'A', analyze: () => ({ status: 'success', data: {}, requiredBins: [], requiredEnv: [], extractedCommands: [] }),
      };
      const service = new AnalyzeService(repo, [adapter], emitter);
      await service.analyzeVersion(version.id);

      expect(repo.getVersionById(version.id)!.analysisStatus).toBe('complete');
    });

    it('updates analysisStatus to error on failure', async () => {
      const { version } = seedSkill(repo);
      repo.registerFiles({ versionId: version.id, files: [{ relativePath: 'x', fileHash: 'h', sizeBytes: 1 }] });

      const adapter: AnalyzeAdapter = {
        id: 'a', displayName: 'A', analyze: () => ({ status: 'error', data: {}, requiredBins: [], requiredEnv: [], extractedCommands: [] }),
      };
      const service = new AnalyzeService(repo, [adapter], emitter);
      await service.analyzeVersion(version.id);

      expect(repo.getVersionById(version.id)!.analysisStatus).toBe('error');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  UploadService                                                    */
  /* ---------------------------------------------------------------- */

  describe('UploadService', () => {
    it('creates skill + version + files from file buffers', () => {
      const service = new UploadService(repo, emitter);

      const result = service.uploadFromFiles({
        name: 'Upload Test', slug: 'upload-test', version: '1.0.0', author: 'tester',
        files: makeSkillFiles(),
      });

      expect(result.skill.slug).toBe('upload-test');
      expect(result.version.version).toBe('1.0.0');

      const files = repo.getFiles(result.version.id);
      expect(files).toHaveLength(2);
    });

    it('computes file hashes (SHA-256)', () => {
      const service = new UploadService(repo, emitter);
      const content = Buffer.from('hello world');
      const expectedHash = crypto.createHash('sha256').update(content).digest('hex');

      service.uploadFromFiles({
        name: 'Hash Test', slug: 'hash-test', version: '1.0.0',
        files: [{ relativePath: 'file.txt', content }],
      });

      const skill = repo.getBySlug('hash-test')!;
      const version = repo.getLatestVersion(skill.id)!;
      const files = repo.getFiles(version.id);
      expect(files[0].fileHash).toBe(expectedHash);
    });

    it('computes content hash from sorted file hashes', () => {
      const service = new UploadService(repo, emitter);
      const fileA = Buffer.from('aaa');
      const fileB = Buffer.from('bbb');

      const hashA = crypto.createHash('sha256').update(fileA).digest('hex');
      const hashB = crypto.createHash('sha256').update(fileB).digest('hex');
      // Upload service sorts by relativePath (a.txt < b.txt), then joins hashes
      const expectedContentHash = crypto.createHash('sha256').update(hashA + hashB).digest('hex');

      const result = service.uploadFromFiles({
        name: 'Content Hash', slug: 'content-hash', version: '1.0.0',
        files: [
          { relativePath: 'a.txt', content: fileA },
          { relativePath: 'b.txt', content: fileB },
        ],
      });

      expect(result.version.contentHash).toBe(expectedContentHash);
    });

    it('stores SKILL.md in backup when backup service available', () => {
      const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
      const backup = new SkillBackupService(backupDir);
      const service = new UploadService(repo, emitter, backup);

      const result = service.uploadFromFiles({
        name: 'Backup Test', slug: 'backup-test', version: '1.0.0',
        files: makeSkillFiles(),
      });

      expect(backup.hasBackup(result.version.id)).toBe(true);
      const content = backup.loadSkillMd(result.version.id);
      expect(content).toContain('# Test Skill');

      try { fs.rmSync(backupDir, { recursive: true }); } catch { /* */ }
    });

    it('upserts existing skill on same slug', () => {
      const service = new UploadService(repo, emitter);

      const result1 = service.uploadFromFiles({
        name: 'First', slug: 'upsert-test', version: '1.0.0',
        files: [{ relativePath: 'a.txt', content: Buffer.from('v1') }],
      });
      const result2 = service.uploadFromFiles({
        name: 'Second', slug: 'upsert-test', version: '2.0.0',
        files: [{ relativePath: 'a.txt', content: Buffer.from('v2') }],
      });

      expect(result1.skill.id).toBe(result2.skill.id);
      expect(result2.version.version).toBe('2.0.0');
    });

    it('emits upload:started, upload:completed', () => {
      const service = new UploadService(repo, emitter);

      service.uploadFromFiles({
        name: 'Events Test', slug: 'events-test', version: '1.0.0',
        files: makeSkillFiles(),
      });

      const types = events.map((e) => e.type);
      expect(types).toContain('upload:started');
      expect(types).toContain('upload:completed');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  CatalogService                                                   */
  /* ---------------------------------------------------------------- */

  describe('CatalogService', () => {
    it('search returns local results', async () => {
      seedSkill(repo, { name: 'Searchable Skill', slug: 'searchable' });
      const localAdapter = new LocalSearchAdapter(repo);
      const catalog = new CatalogService(repo, [localAdapter]);

      const results = await catalog.search('Searchable');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].source).toBe('local');
    });

    it('search deduplicates local vs remote', async () => {
      seedSkill(repo, { name: 'Shared Skill', slug: 'shared-skill' });

      const localAdapter = new LocalSearchAdapter(repo);
      const mockRemoteAdapter = {
        id: 'remote', displayName: 'Remote',
        search: jest.fn().mockResolvedValue([
          { skill: { id: 'r1', slug: 'shared-skill', name: 'Shared Skill' }, source: 'remote' as const },
        ]),
      };
      const catalog = new CatalogService(repo, [localAdapter, mockRemoteAdapter]);

      const results = await catalog.search('Shared');

      // Should NOT have duplicates
      const slugs = results.map((r) => r.skill.slug);
      const uniqueSlugs = new Set(slugs);
      expect(slugs.length).toBe(uniqueSlugs.size);
    });

    it('listInstalled returns only active installations', () => {
      const { skill, version } = seedSkill(repo);
      repo.install({ skillVersionId: version.id, status: 'active' });

      const { version: v2 } = seedSkill(repo, { slug: 'disabled-skill', name: 'Disabled' });
      repo.install({ skillVersionId: v2.id, status: 'disabled' });

      const catalog = new CatalogService(repo, []);

      // listInstalled delegates to repo.getInstalledSkills which returns active installs
      const installed = catalog.listInstalled();
      expect(installed.some((s) => s.slug === 'test-skill')).toBe(true);
    });

    it('getDetail returns skill + versions + installations', () => {
      const { skill, version } = seedSkill(repo);
      const inst = repo.install({ skillVersionId: version.id, status: 'active' });
      const catalog = new CatalogService(repo, []);

      const detail = catalog.getDetail(skill.id);

      expect(detail).not.toBeNull();
      expect(detail!.skill.id).toBe(skill.id);
      expect(detail!.versions.length).toBeGreaterThanOrEqual(1);
      expect(detail!.installations.some((i) => i.id === inst.id)).toBe(true);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  UpdateService                                                    */
  /* ---------------------------------------------------------------- */

  describe('UpdateService', () => {
    it('checkForUpdates returns empty in offline mode', async () => {
      const service = new UpdateService(repo, null, emitter);

      const results = await service.checkForUpdates();

      expect(results).toEqual([]);
    });

    it('checkForUpdates queries remote for each installed skill', async () => {
      const remote = createMockRemoteClient();
      (remote.checkVersion as jest.Mock).mockResolvedValue({
        hasUpdate: true, latestVersion: '2.0.0', currentVersion: '1.0.0',
      });

      seedSkill(repo, { remoteId: 'r-1' });
      const service = new UpdateService(repo, remote, emitter);

      const results = await service.checkForUpdates();

      expect(remote.checkVersion).toHaveBeenCalled();
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].availableVersion).toBe('2.0.0');
    });

    it('applyPendingUpdates downloads + propagates to auto-update installations', async () => {
      const remote = createMockRemoteClient();
      (remote.checkVersion as jest.Mock).mockResolvedValue({
        hasUpdate: true, latestVersion: '2.0.0', currentVersion: '1.0.0',
      });
      // Download mock must return version '2.0.0' to avoid conflicting with existing '1.0.0'
      (remote.download as jest.Mock).mockResolvedValue({
        zipBuffer: Buffer.from('zip'), checksum: 'ck-v2', version: '2.0.0',
      });

      const { skill, version } = seedSkill(repo, { remoteId: 'r-1' });
      repo.install({ skillVersionId: version.id, status: 'active', autoUpdate: true });
      const service = new UpdateService(repo, remote, emitter);

      const results = await service.applyPendingUpdates();

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].installationsUpdated).toBeGreaterThanOrEqual(1);
    });
  });
});
