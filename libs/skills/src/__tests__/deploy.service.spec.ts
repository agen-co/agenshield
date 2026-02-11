/**
 * DeployService + OpenClawDeployAdapter tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { InitialSchemaMigration } from '../../../storage/src/migrations/001-initial-schema';
import { SkillsManagerColumnsMigration } from '../../../storage/src/migrations/003-skills-manager-columns';
import { SkillsRepository } from '../../../storage/src/repositories/skills/skills.repository';
import { DeployService } from '../deploy/deploy.service';
import { OpenClawDeployAdapter } from '../deploy/adapters/openclaw.adapter';
import type { DeployAdapter, DeployContext, DeployResult, IntegrityCheckResult } from '../deploy/types';
import type { SkillEvent } from '../events';
import type { Skill, SkillVersion, SkillFile, SkillInstallation } from '@agenshield/ipc';

function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new InitialSchemaMigration().up(db);
  new SkillsManagerColumnsMigration().up(db);
  return { db, dir, cleanup: () => { db.close(); try { fs.rmSync(dir, { recursive: true }); } catch { /* */ } } };
}

function makeSkillInput(overrides?: Record<string, unknown>) {
  return {
    name: 'Test Skill', slug: 'test-skill', author: 'tester',
    tags: ['test'], source: 'manual' as const, ...overrides,
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
    checkIntegrity: async (inst, ver, files) => { calls.push({ method: 'checkIntegrity', args: [inst, ver, files] }); return { intact: true, modifiedFiles: [], missingFiles: [], unexpectedFiles: [] }; },
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
  });

  describe('checkAllIntegrity', () => {
    it('iterates active installations', async () => {
      const adapter = createMockAdapter();
      const service = new DeployService(repo, [adapter], emitter);

      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      repo.install({ skillVersionId: version.id, status: 'active' });
      repo.install({ skillVersionId: version.id, status: 'active' });

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
});

describe('OpenClawDeployAdapter', () => {
  let tmpDir: string;
  let skillsDir: string;
  let binDir: string;
  let sourceDir: string;
  let adapter: OpenClawDeployAdapter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-test-'));
    skillsDir = path.join(tmpDir, 'skills');
    binDir = path.join(tmpDir, 'bin');
    sourceDir = path.join(tmpDir, 'source');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });
    adapter = new OpenClawDeployAdapter({ skillsDir, binDir, createWrappers: true });
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
  });

  describe('canDeploy', () => {
    it('returns true for undefined', () => {
      expect(adapter.canDeploy(undefined)).toBe(true);
    });

    it('returns true for openclaw', () => {
      expect(adapter.canDeploy('openclaw')).toBe(true);
    });

    it('returns false for other targets', () => {
      expect(adapter.canDeploy('cloudcode')).toBe(false);
    });
  });

  describe('deploy', () => {
    it('creates files on disk and returns paths + hash', async () => {
      // Write source files
      fs.writeFileSync(path.join(sourceDir, 'index.ts'), 'export default {}');
      fs.writeFileSync(path.join(sourceDir, 'config.json'), '{"key":"val"}');

      const fileHash1 = crypto.createHash('sha256').update('export default {}').digest('hex');
      const fileHash2 = crypto.createHash('sha256').update('{"key":"val"}').digest('hex');

      const context: DeployContext = {
        skill: { id: '1', name: 'Test', slug: 'test-skill', tags: [], source: 'manual', isPublic: true, createdAt: '', updatedAt: '' },
        version: { id: '1', skillId: '1', version: '1.0.0', folderPath: sourceDir, contentHash: '', hashUpdatedAt: '', approval: 'unknown', trusted: false, analysisStatus: 'pending', requiredBins: [], requiredEnv: [], extractedCommands: [], createdAt: '', updatedAt: '' },
        files: [
          { id: '1', skillVersionId: '1', relativePath: 'index.ts', fileHash: fileHash1, sizeBytes: 19, createdAt: '', updatedAt: '' },
          { id: '2', skillVersionId: '1', relativePath: 'config.json', fileHash: fileHash2, sizeBytes: 14, createdAt: '', updatedAt: '' },
        ],
        installation: { id: '1', skillVersionId: '1', status: 'pending', autoUpdate: true, installedAt: '', updatedAt: '' },
      };

      const result = await adapter.deploy(context);

      expect(result.deployedPath).toBe(path.join(skillsDir, 'test-skill'));
      expect(result.deployedHash).toBeTruthy();
      expect(fs.existsSync(path.join(skillsDir, 'test-skill', 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(skillsDir, 'test-skill', 'config.json'))).toBe(true);
    });

    it('creates executable bash wrapper', async () => {
      fs.writeFileSync(path.join(sourceDir, 'main.sh'), '#!/bin/bash\necho hi');

      const context: DeployContext = {
        skill: { id: '1', name: 'Test', slug: 'test-skill', tags: [], source: 'manual', isPublic: true, createdAt: '', updatedAt: '' },
        version: { id: '1', skillId: '1', version: '1.0.0', folderPath: sourceDir, contentHash: '', hashUpdatedAt: '', approval: 'unknown', trusted: false, analysisStatus: 'pending', requiredBins: [], requiredEnv: [], extractedCommands: [], createdAt: '', updatedAt: '' },
        files: [
          { id: '1', skillVersionId: '1', relativePath: 'main.sh', fileHash: 'abc', sizeBytes: 24, createdAt: '', updatedAt: '' },
        ],
        installation: { id: '1', skillVersionId: '1', status: 'pending', autoUpdate: true, installedAt: '', updatedAt: '' },
      };

      const result = await adapter.deploy(context);

      expect(result.wrapperPath).toBe(path.join(binDir, 'test-skill'));
      expect(fs.existsSync(result.wrapperPath!)).toBe(true);

      const wrapperContent = fs.readFileSync(result.wrapperPath!, 'utf-8');
      expect(wrapperContent).toContain('#!/bin/bash');
      expect(wrapperContent).toContain('test-skill');
    });

    it('handles subdirectories in files', async () => {
      fs.mkdirSync(path.join(sourceDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(sourceDir, 'src', 'lib.ts'), 'export const x = 1');

      const context: DeployContext = {
        skill: { id: '1', name: 'Test', slug: 'test-skill', tags: [], source: 'manual', isPublic: true, createdAt: '', updatedAt: '' },
        version: { id: '1', skillId: '1', version: '1.0.0', folderPath: sourceDir, contentHash: '', hashUpdatedAt: '', approval: 'unknown', trusted: false, analysisStatus: 'pending', requiredBins: [], requiredEnv: [], extractedCommands: [], createdAt: '', updatedAt: '' },
        files: [
          { id: '1', skillVersionId: '1', relativePath: 'src/lib.ts', fileHash: 'abc', sizeBytes: 19, createdAt: '', updatedAt: '' },
        ],
        installation: { id: '1', skillVersionId: '1', status: 'pending', autoUpdate: true, installedAt: '', updatedAt: '' },
      };

      await adapter.deploy(context);
      expect(fs.existsSync(path.join(skillsDir, 'test-skill', 'src', 'lib.ts'))).toBe(true);
    });
  });

  describe('undeploy', () => {
    it('removes deployed files and wrapper', async () => {
      // Pre-create deployed files
      const deployDir = path.join(skillsDir, 'test-skill');
      fs.mkdirSync(deployDir, { recursive: true });
      fs.writeFileSync(path.join(deployDir, 'index.ts'), 'export default {}');
      fs.writeFileSync(path.join(binDir, 'test-skill'), '#!/bin/bash');

      const skill = { id: '1', name: 'Test', slug: 'test-skill', tags: [], source: 'manual' as const, isPublic: true, createdAt: '', updatedAt: '' };
      const version = { id: '1', skillId: '1', version: '1.0.0', folderPath: sourceDir, contentHash: '', hashUpdatedAt: '', approval: 'unknown' as const, trusted: false, analysisStatus: 'pending' as const, requiredBins: [] as string[], requiredEnv: [] as string[], extractedCommands: [] as unknown[], createdAt: '', updatedAt: '' };
      const installation = { id: '1', skillVersionId: '1', status: 'active' as const, autoUpdate: true, installedAt: '', updatedAt: '' };

      await adapter.undeploy(installation, version, skill);

      expect(fs.existsSync(deployDir)).toBe(false);
      expect(fs.existsSync(path.join(binDir, 'test-skill'))).toBe(false);
    });
  });

  describe('checkIntegrity', () => {
    it('reports intact when all files match', async () => {
      const deployDir = path.join(skillsDir, 'test-skill');
      fs.mkdirSync(deployDir, { recursive: true });
      const content = 'export default {}';
      fs.writeFileSync(path.join(deployDir, 'index.ts'), content);
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      const version = { id: '1', skillId: '1', version: '1.0.0', folderPath: '/skills/test-skill/1.0.0', contentHash: '', hashUpdatedAt: '', approval: 'unknown' as const, trusted: false, analysisStatus: 'pending' as const, requiredBins: [] as string[], requiredEnv: [] as string[], extractedCommands: [] as unknown[], createdAt: '', updatedAt: '' };
      const installation = { id: '1', skillVersionId: '1', status: 'active' as const, autoUpdate: true, installedAt: '', updatedAt: '' };
      const files: SkillFile[] = [
        { id: '1', skillVersionId: '1', relativePath: 'index.ts', fileHash: hash, sizeBytes: content.length, createdAt: '', updatedAt: '' },
      ];

      const result = await adapter.checkIntegrity(installation, version, files);
      expect(result.intact).toBe(true);
      expect(result.modifiedFiles).toHaveLength(0);
      expect(result.missingFiles).toHaveLength(0);
      expect(result.unexpectedFiles).toHaveLength(0);
    });

    it('detects modified files', async () => {
      const deployDir = path.join(skillsDir, 'test-skill');
      fs.mkdirSync(deployDir, { recursive: true });
      fs.writeFileSync(path.join(deployDir, 'index.ts'), 'tampered content');

      const version = { id: '1', skillId: '1', version: '1.0.0', folderPath: '/skills/test-skill/1.0.0', contentHash: '', hashUpdatedAt: '', approval: 'unknown' as const, trusted: false, analysisStatus: 'pending' as const, requiredBins: [] as string[], requiredEnv: [] as string[], extractedCommands: [] as unknown[], createdAt: '', updatedAt: '' };
      const installation = { id: '1', skillVersionId: '1', status: 'active' as const, autoUpdate: true, installedAt: '', updatedAt: '' };
      const files: SkillFile[] = [
        { id: '1', skillVersionId: '1', relativePath: 'index.ts', fileHash: 'original-hash', sizeBytes: 10, createdAt: '', updatedAt: '' },
      ];

      const result = await adapter.checkIntegrity(installation, version, files);
      expect(result.intact).toBe(false);
      expect(result.modifiedFiles).toContain('index.ts');
    });

    it('detects missing files', async () => {
      const deployDir = path.join(skillsDir, 'test-skill');
      fs.mkdirSync(deployDir, { recursive: true });

      const version = { id: '1', skillId: '1', version: '1.0.0', folderPath: '/skills/test-skill/1.0.0', contentHash: '', hashUpdatedAt: '', approval: 'unknown' as const, trusted: false, analysisStatus: 'pending' as const, requiredBins: [] as string[], requiredEnv: [] as string[], extractedCommands: [] as unknown[], createdAt: '', updatedAt: '' };
      const installation = { id: '1', skillVersionId: '1', status: 'active' as const, autoUpdate: true, installedAt: '', updatedAt: '' };
      const files: SkillFile[] = [
        { id: '1', skillVersionId: '1', relativePath: 'missing.ts', fileHash: 'abc', sizeBytes: 10, createdAt: '', updatedAt: '' },
      ];

      const result = await adapter.checkIntegrity(installation, version, files);
      expect(result.intact).toBe(false);
      expect(result.missingFiles).toContain('missing.ts');
    });

    it('detects unexpected files', async () => {
      const deployDir = path.join(skillsDir, 'test-skill');
      fs.mkdirSync(deployDir, { recursive: true });
      const content = 'export default {}';
      fs.writeFileSync(path.join(deployDir, 'index.ts'), content);
      fs.writeFileSync(path.join(deployDir, 'extra.ts'), 'unexpected');
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      const version = { id: '1', skillId: '1', version: '1.0.0', folderPath: '/skills/test-skill/1.0.0', contentHash: '', hashUpdatedAt: '', approval: 'unknown' as const, trusted: false, analysisStatus: 'pending' as const, requiredBins: [] as string[], requiredEnv: [] as string[], extractedCommands: [] as unknown[], createdAt: '', updatedAt: '' };
      const installation = { id: '1', skillVersionId: '1', status: 'active' as const, autoUpdate: true, installedAt: '', updatedAt: '' };
      const files: SkillFile[] = [
        { id: '1', skillVersionId: '1', relativePath: 'index.ts', fileHash: hash, sizeBytes: content.length, createdAt: '', updatedAt: '' },
      ];

      const result = await adapter.checkIntegrity(installation, version, files);
      expect(result.intact).toBe(false);
      expect(result.unexpectedFiles).toContain('extra.ts');
    });
  });
});
