/**
 * InstallService tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { InitialSchemaMigration } from '../../../storage/src/migrations/001-initial-schema';
import { SkillsManagerColumnsMigration } from '../../../storage/src/migrations/003-skills-manager-columns';
import { SkillsRepository } from '../../../storage/src/repositories/skills/skills.repository';
import { InstallService } from '../install/install.service';
import { SkillNotFoundError } from '../errors';
import { DeployService } from '../deploy/deploy.service';
import type { DeployAdapter, DeployResult } from '../deploy/types';
import type { SkillEvent } from '../events';

function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new InitialSchemaMigration().up(db);
  new SkillsManagerColumnsMigration().up(db);
  return { db, cleanup: () => { db.close(); try { fs.rmSync(dir, { recursive: true }); } catch { /* */ } } };
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

describe('InstallService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: SkillsRepository;
  let emitter: EventEmitter;
  let service: InstallService;
  let events: SkillEvent[];

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new SkillsRepository(db, () => null);
    emitter = new EventEmitter();
    events = [];
    emitter.on('skill-event', (e: SkillEvent) => events.push(e));
    service = new InstallService(repo, null, emitter);
  });

  afterEach(() => cleanup());

  it('install from local skill', async () => {
    const skill = repo.create(makeSkillInput());
    const v = repo.addVersion(makeVersionInput(skill.id));

    const installation = await service.install({ skillId: skill.id });

    expect(installation.skillVersionId).toBe(v.id);
    expect(installation.status).toBe('active');
    expect(installation.autoUpdate).toBe(true);
  });

  it('install emits events', async () => {
    const skill = repo.create(makeSkillInput());
    repo.addVersion(makeVersionInput(skill.id));

    await service.install({ skillId: skill.id });

    const types = events.map((e) => e.type);
    expect(types).toContain('install:started');
    expect(types).toContain('install:creating');
    expect(types).toContain('install:completed');
  });

  it('install with autoUpdate=false', async () => {
    const skill = repo.create(makeSkillInput());
    repo.addVersion(makeVersionInput(skill.id));

    const installation = await service.install({ skillId: skill.id, autoUpdate: false });
    expect(installation.autoUpdate).toBe(false);
  });

  it('install specific version', async () => {
    const skill = repo.create(makeSkillInput());
    repo.addVersion(makeVersionInput(skill.id, { version: '1.0.0' }));
    const v2 = repo.addVersion(makeVersionInput(skill.id, { version: '2.0.0' }));

    const installation = await service.install({ skillId: skill.id, version: '2.0.0' });
    expect(installation.skillVersionId).toBe(v2.id);
  });

  it('install throws for non-existent skill', async () => {
    await expect(service.install({ skillId: 'non-existent' })).rejects.toThrow(SkillNotFoundError);
    expect(events.some((e) => e.type === 'install:error')).toBe(true);
  });

  it('uninstall removes installation', async () => {
    const skill = repo.create(makeSkillInput());
    const v = repo.addVersion(makeVersionInput(skill.id));
    const inst = repo.install({ skillVersionId: v.id, status: 'active' });

    const result = await service.uninstall(inst.id);
    expect(result).toBe(true);
    expect(events.some((e) => e.type === 'uninstall:completed')).toBe(true);
  });

  it('setAutoUpdate toggles setting', async () => {
    const skill = repo.create(makeSkillInput());
    const v = repo.addVersion(makeVersionInput(skill.id));
    const inst = await service.install({ skillId: skill.id });

    service.setAutoUpdate(inst.id, false);
    const installations = repo.getInstallations();
    expect(installations.find((i) => i.id === inst.id)!.autoUpdate).toBe(false);
  });

  it('pinVersion / unpinVersion', async () => {
    const skill = repo.create(makeSkillInput());
    repo.addVersion(makeVersionInput(skill.id));
    const inst = await service.install({ skillId: skill.id });

    service.pinVersion(inst.id, '1.0.0');
    let installations = repo.getInstallations();
    expect(installations.find((i) => i.id === inst.id)!.pinnedVersion).toBe('1.0.0');

    service.unpinVersion(inst.id);
    installations = repo.getInstallations();
    expect(installations.find((i) => i.id === inst.id)!.pinnedVersion).toBeUndefined();
  });
});

describe('InstallService with DeployService', () => {
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

  function createMockDeployAdapter(result?: DeployResult, shouldThrow?: boolean): DeployAdapter {
    return {
      id: 'mock',
      displayName: 'Mock',
      canDeploy: () => true,
      deploy: async () => {
        if (shouldThrow) throw new Error('deploy failed');
        return result ?? { deployedPath: '/deployed', deployedHash: 'hash' };
      },
      undeploy: async () => {},
      checkIntegrity: async () => ({ intact: true, modifiedFiles: [], missingFiles: [], unexpectedFiles: [] }),
    };
  }

  it('install with deployer: status pending → active', async () => {
    const adapter = createMockDeployAdapter({ deployedPath: '/deployed', deployedHash: 'hash', wrapperPath: '/bin/test-skill' });
    const deployer = new DeployService(repo, [adapter], emitter);
    const service = new InstallService(repo, null, emitter, deployer);

    const skill = repo.create(makeSkillInput());
    repo.addVersion(makeVersionInput(skill.id));

    const inst = await service.install({ skillId: skill.id });
    expect(inst.status).toBe('active');
    expect(inst.wrapperPath).toBe('/bin/test-skill');
  });

  it('install with deploy failure: status → disabled', async () => {
    const adapter = createMockDeployAdapter(undefined, true);
    const deployer = new DeployService(repo, [adapter], emitter);
    const service = new InstallService(repo, null, emitter, deployer);

    const skill = repo.create(makeSkillInput());
    repo.addVersion(makeVersionInput(skill.id));

    await expect(service.install({ skillId: skill.id })).rejects.toThrow('deploy failed');

    // Verify DB has disabled status
    const installations = repo.getInstallations();
    expect(installations[0].status).toBe('disabled');
  });

  it('uninstall with deployer: undeploy called before DB deletion', async () => {
    let undeployCalled = false;
    const adapter: DeployAdapter = {
      id: 'mock',
      displayName: 'Mock',
      canDeploy: () => true,
      deploy: async () => ({ deployedPath: '/deployed', deployedHash: 'hash' }),
      undeploy: async () => { undeployCalled = true; },
      checkIntegrity: async () => ({ intact: true, modifiedFiles: [], missingFiles: [], unexpectedFiles: [] }),
    };

    const deployer = new DeployService(repo, [adapter], emitter);
    const service = new InstallService(repo, null, emitter, deployer);

    const skill = repo.create(makeSkillInput());
    const version = repo.addVersion(makeVersionInput(skill.id));
    const inst = repo.install({ skillVersionId: version.id, status: 'active' });

    await service.uninstall(inst.id);
    expect(undeployCalled).toBe(true);
    expect(repo.getInstallations()).toHaveLength(0);
  });
});
