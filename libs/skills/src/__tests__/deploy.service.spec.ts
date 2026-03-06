/**
 * DeployService tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { SchemaMigration } from '../../../storage/src/migrations/001-schema';
import { SkillsRepository } from '../../../storage/src/repositories/skills/skills.repository';
import { DeployService } from '../deploy/deploy.service';
import type { DeployAdapter, DeployContext, DeployResult, IntegrityCheckResult } from '../deploy/types';
import type { SkillEvent } from '../events';
import type { Skill, SkillVersion, SkillFile, SkillInstallation } from '@agenshield/ipc';

function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new SchemaMigration().up(db);
  return { db, dir, cleanup: () => { db.close(); try { fs.rmSync(dir, { recursive: true }); } catch { /* */ } } };
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
    contentHash: 'abc', hashUpdatedAt: new Date().toISOString(),
    approval: 'unknown' as const, trusted: false, analysisStatus: 'pending' as const,
    requiredBins: [] as string[], requiredEnv: [] as string[], extractedCommands: [] as unknown[],
    ...overrides,
  };
}

/** Mock adapter that records calls */
function createMockAdapter(id = 'mock', canDeploy = true): DeployAdapter & { calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    id,
    displayName: 'Mock',
    calls,
    canDeploy: (targetId) => { calls.push({ method: 'canDeploy', args: [targetId] }); return canDeploy; },
    deploy: async (ctx) => { calls.push({ method: 'deploy', args: [ctx] }); return { deployedPath: '/deployed', deployedHash: 'hash123' }; },
    undeploy: async (inst, ver, skill) => { calls.push({ method: 'undeploy', args: [inst, ver, skill] }); },
    checkIntegrity: async (inst, ver, files, skill) => { calls.push({ method: 'checkIntegrity', args: [inst, ver, files, skill] }); return { intact: true, modifiedFiles: [], missingFiles: [], unexpectedFiles: [] }; },
  };
}

describe('DeployService', () => {
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

  describe('findAdapter', () => {
    it('returns matching adapter', () => {
      const adapter = createMockAdapter('test-adapter');
      const service = new DeployService(repo, [adapter], emitter);
      expect(service.findAdapter(undefined)).toBe(adapter);
    });

    it('returns null for unknown target', () => {
      const adapter = createMockAdapter('test', false);
      const service = new DeployService(repo, [adapter], emitter);
      expect(service.findAdapter('unknown')).toBeNull();
    });

    it('returns null with no adapters', () => {
      const service = new DeployService(repo, [], emitter);
      expect(service.findAdapter(undefined)).toBeNull();
    });
  });

  describe('deploy', () => {
    it('calls adapter and emits events', async () => {
      const adapter = createMockAdapter();
      const service = new DeployService(repo, [adapter], emitter);

      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      const installation = repo.install({ skillVersionId: version.id, status: 'pending' });

      const result = await service.deploy(installation, version, skill);

      expect(result).toEqual({ deployedPath: '/deployed', deployedHash: 'hash123' });
      expect(adapter.calls.some((c) => c.method === 'deploy')).toBe(true);

      const types = events.map((e) => e.type);
      expect(types).toContain('deploy:started');
      expect(types).toContain('deploy:completed');
    });

    it('passes fileContents from backup to adapter', async () => {
      const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-backup-'));
      const { SkillBackupService } = require('../backup');
      const backup = new SkillBackupService(backupDir);

      const adapter = createMockAdapter();
      const service = new DeployService(repo, [adapter], emitter, backup);

      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      const installation = repo.install({ skillVersionId: version.id, status: 'pending' });

      // Save backup files
      backup.saveFiles(version.id, [
        { relativePath: 'index.ts', content: Buffer.from('export default {}') },
      ]);

      await service.deploy(installation, version, skill);

      // Find the deploy call and check fileContents
      const deployCall = adapter.calls.find((c) => c.method === 'deploy');
      expect(deployCall).toBeDefined();
      const ctx = deployCall!.args[0] as DeployContext;
      expect(ctx.fileContents).toBeDefined();
      expect(ctx.fileContents!.size).toBe(1);
      expect(ctx.fileContents!.get('index.ts')!.toString()).toBe('export default {}');

      try { fs.rmSync(backupDir, { recursive: true }); } catch { /* */ }
    });

    it('passes undefined fileContents when no backup', async () => {
      const adapter = createMockAdapter();
      const service = new DeployService(repo, [adapter], emitter);

      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      const installation = repo.install({ skillVersionId: version.id, status: 'pending' });

      await service.deploy(installation, version, skill);

      const deployCall = adapter.calls.find((c) => c.method === 'deploy');
      expect(deployCall).toBeDefined();
      const ctx = deployCall!.args[0] as DeployContext;
      expect(ctx.fileContents).toBeUndefined();
    });

    it('returns null when no adapter matches', async () => {
      const service = new DeployService(repo, [], emitter);
      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      const installation = repo.install({ skillVersionId: version.id, status: 'pending' });

      const result = await service.deploy(installation, version, skill);
      expect(result).toBeNull();
    });

    it('emits error event and re-throws on failure', async () => {
      const adapter: DeployAdapter = {
        id: 'failing',
        displayName: 'Failing',
        canDeploy: () => true,
        deploy: async () => { throw new Error('deploy failed'); },
        undeploy: async () => {},
        checkIntegrity: async () => ({ intact: true, modifiedFiles: [], missingFiles: [], unexpectedFiles: [] }),
      };

      const service = new DeployService(repo, [adapter], emitter);
      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      const installation = repo.install({ skillVersionId: version.id, status: 'pending' });

      await expect(service.deploy(installation, version, skill)).rejects.toThrow('deploy failed');
      expect(events.some((e) => e.type === 'deploy:error')).toBe(true);
    });
  });

  describe('addAdapter', () => {
    it('registers a new adapter after construction', () => {
      const service = new DeployService(repo, [], emitter);
      expect(service.findAdapter(undefined)).toBeNull();

      const adapter = createMockAdapter();
      service.addAdapter(adapter);
      expect(service.findAdapter(undefined)).toBe(adapter);
    });
  });

  describe('undeploy', () => {
    it('calls adapter and emits events', async () => {
      const adapter = createMockAdapter();
      const service = new DeployService(repo, [adapter], emitter);

      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      const installation = repo.install({ skillVersionId: version.id, status: 'active' });

      await service.undeploy(installation, version, skill);

      expect(adapter.calls.some((c) => c.method === 'undeploy')).toBe(true);
      const types = events.map((e) => e.type);
      expect(types).toContain('undeploy:started');
      expect(types).toContain('undeploy:completed');
    });

    it('emits undeploy:error and re-throws when adapter throws', async () => {
      const failingAdapter: DeployAdapter = {
        id: 'failing',
        displayName: 'Failing',
        canDeploy: () => true,
        deploy: async () => ({ deployedPath: '', deployedHash: '' }),
        undeploy: async () => { throw new Error('undeploy failed'); },
        checkIntegrity: async () => ({ intact: true, modifiedFiles: [], missingFiles: [], unexpectedFiles: [] }),
      };

      const service = new DeployService(repo, [failingAdapter], emitter);
      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      const installation = repo.install({ skillVersionId: version.id, status: 'active' });

      await expect(service.undeploy(installation, version, skill)).rejects.toThrow('undeploy failed');
      expect(events.some((e) => e.type === 'undeploy:error')).toBe(true);
    });
  });

  describe('checkAllIntegrity', () => {
    it('iterates active installations', async () => {
      const adapter = createMockAdapter();
      const service = new DeployService(repo, [adapter], emitter);

      // Insert profiles so installations get distinct profile_id values (UNIQUE constraint)
      db.prepare("INSERT INTO profiles (id, name, type) VALUES ('p1', 'P1', 'target')").run();
      db.prepare("INSERT INTO profiles (id, name, type) VALUES ('p2', 'P2', 'target')").run();

      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      repo.install({ skillVersionId: version.id, status: 'active', profileId: 'p1' });
      repo.install({ skillVersionId: version.id, status: 'active', profileId: 'p2' });

      const results = await service.checkAllIntegrity();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.result.intact)).toBe(true);
    });

    it('skips non-active installations', async () => {
      const adapter = createMockAdapter();
      const service = new DeployService(repo, [adapter], emitter);

      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      repo.install({ skillVersionId: version.id, status: 'disabled' });

      const results = await service.checkAllIntegrity();
      expect(results).toHaveLength(0);
    });
  });

  describe('deployPending', () => {
    it('deploys active installations with integrity failures', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-pending-'));
      const deployDir = path.join(tmpDir, 'deployed', 'test-skill');
      fs.mkdirSync(deployDir, { recursive: true });

      const adapter: DeployAdapter = {
        id: 'pending-test',
        displayName: 'Pending Test',
        canDeploy: () => true,
        deploy: async (ctx) => {
          for (const file of ctx.files) {
            const filePath = path.join(deployDir, file.relativePath);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, 'deployed');
          }
          return { deployedPath: deployDir, deployedHash: 'hash' };
        },
        undeploy: async () => {},
        checkIntegrity: async () => ({ intact: false, modifiedFiles: ['index.ts'], missingFiles: [], unexpectedFiles: [] }),
      };

      const service = new DeployService(repo, [adapter], emitter);
      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      repo.registerFiles({ versionId: version.id, files: [{ relativePath: 'index.ts', fileHash: 'abc', sizeBytes: 10 }] });
      repo.install({ skillVersionId: version.id, status: 'active' });

      const deployed = await service.deployPending();
      expect(deployed).toBe(1);

      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });

    it('skips already-intact installations', async () => {
      const adapter: DeployAdapter = {
        id: 'intact-test',
        displayName: 'Intact Test',
        canDeploy: () => true,
        deploy: async () => ({ deployedPath: '/deployed', deployedHash: 'hash' }),
        undeploy: async () => {},
        checkIntegrity: async () => ({ intact: true, modifiedFiles: [], missingFiles: [], unexpectedFiles: [] }),
      };

      const service = new DeployService(repo, [adapter], emitter);
      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      repo.install({ skillVersionId: version.id, status: 'active' });

      const deployed = await service.deployPending();
      expect(deployed).toBe(0);
    });

    it('swallows errors from individual deploy failures', async () => {
      const adapter: DeployAdapter = {
        id: 'fail-deploy',
        displayName: 'Fail Deploy',
        canDeploy: () => true,
        deploy: async () => { throw new Error('deploy boom'); },
        undeploy: async () => {},
        checkIntegrity: async () => ({ intact: false, modifiedFiles: ['a.ts'], missingFiles: [], unexpectedFiles: [] }),
      };

      const service = new DeployService(repo, [adapter], emitter);
      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      repo.registerFiles({ versionId: version.id, files: [{ relativePath: 'a.ts', fileHash: 'abc', sizeBytes: 10 }] });
      repo.install({ skillVersionId: version.id, status: 'active' });

      // Should not throw
      const deployed = await service.deployPending();
      expect(deployed).toBe(0);
    });
  });
});

describe('DeployService hash sync', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: SkillsRepository;
  let emitter: EventEmitter;
  let events: SkillEvent[];
  let tmpDir: string;
  let deployDir: string;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new SkillsRepository(db, () => null);
    emitter = new EventEmitter();
    events = [];
    emitter.on('skill-event', (e: SkillEvent) => events.push(e));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-sync-'));
    deployDir = path.join(tmpDir, 'deployed', 'test-skill');
    fs.mkdirSync(deployDir, { recursive: true });
  });

  afterEach(() => {
    cleanup();
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
  });

  it('updates DB file hashes after adapter modifies content during deploy', async () => {
    const originalContent = '# Skill\nENV_VAR=secret';
    const processedContent = '# Skill\n<!-- env stripped -->';

    // Create an adapter that writes processed (different) content
    const adapter: DeployAdapter = {
      id: 'processing',
      displayName: 'Processing',
      canDeploy: () => true,
      deploy: async (ctx) => {
        // Write processed content to deploy dir (simulating env stripping)
        for (const file of ctx.files) {
          const filePath = path.join(deployDir, file.relativePath);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, processedContent);
        }
        return { deployedPath: deployDir, deployedHash: 'hash123' };
      },
      undeploy: async () => {},
      checkIntegrity: async () => ({ intact: true, modifiedFiles: [], missingFiles: [], unexpectedFiles: [] }),
    };

    const service = new DeployService(repo, [adapter], emitter);

    const skill = repo.create(makeSkillInput());
    const version = repo.addVersion(makeVersionInput(skill.id));
    const originalHash = crypto.createHash('sha256').update(originalContent).digest('hex');
    repo.registerFiles({ versionId: version.id, files: [{ relativePath: 'SKILL.md', fileHash: originalHash, sizeBytes: Buffer.byteLength(originalContent) }] });
    const installation = repo.install({ skillVersionId: version.id, status: 'pending' });

    await service.deploy(installation, version, skill);

    // Assert: DB file hash now matches the processed content, not the original
    const files = repo.getFiles(version.id);
    const processedHash = crypto.createHash('sha256').update(processedContent).digest('hex');
    expect(files[0].fileHash).toBe(processedHash);
    expect(files[0].fileHash).not.toBe(originalHash);
  });

  it('does NOT update DB hashes when deployed content matches original', async () => {
    const content = '# Skill\nNo changes needed';
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    // Create an adapter that writes identical content
    const adapter: DeployAdapter = {
      id: 'identity',
      displayName: 'Identity',
      canDeploy: () => true,
      deploy: async (ctx) => {
        for (const file of ctx.files) {
          const filePath = path.join(deployDir, file.relativePath);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, content);
        }
        return { deployedPath: deployDir, deployedHash: 'hash123' };
      },
      undeploy: async () => {},
      checkIntegrity: async () => ({ intact: true, modifiedFiles: [], missingFiles: [], unexpectedFiles: [] }),
    };

    const service = new DeployService(repo, [adapter], emitter);

    const skill = repo.create(makeSkillInput());
    const version = repo.addVersion(makeVersionInput(skill.id));
    repo.registerFiles({ versionId: version.id, files: [{ relativePath: 'SKILL.md', fileHash: contentHash, sizeBytes: Buffer.byteLength(content) }] });
    const installation = repo.install({ skillVersionId: version.id, status: 'pending' });

    // Spy on updateFileHash to confirm it's never called
    const originalUpdateFileHash = repo.updateFileHash.bind(repo);
    let updateCalled = false;
    repo.updateFileHash = (params) => { updateCalled = true; originalUpdateFileHash(params); };

    await service.deploy(installation, version, skill);

    // Assert: updateFileHash was NOT called (hashes match)
    expect(updateCalled).toBe(false);

    // Assert: DB hash unchanged
    const files = repo.getFiles(version.id);
    expect(files[0].fileHash).toBe(contentHash);
  });
});

