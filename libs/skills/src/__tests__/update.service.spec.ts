/**
 * UpdateService tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { InitialSchemaMigration } from '../../../storage/src/migrations/001-initial-schema';
import { SkillsManagerColumnsMigration } from '../../../storage/src/migrations/003-skills-manager-columns';
import { SkillsRepository } from '../../../storage/src/repositories/skills/skills.repository';
import { UpdateService } from '../update/update.service';
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

describe('UpdateService', () => {
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

  it('checkForUpdates returns empty when no remote', async () => {
    const service = new UpdateService(repo, null, emitter);
    const results = await service.checkForUpdates();
    expect(results).toEqual([]);
  });

  it('propagateUpdate updates auto-updatable installations', () => {
    const service = new UpdateService(repo, null, emitter);

    const skill = repo.create({
      name: 'S', slug: 's-update', tags: [], source: 'manual', remoteId: 'r1',
    });
    const v1 = repo.addVersion({
      skillId: skill.id, version: '1.0.0', folderPath: '/tmp',
      contentHash: 'abc', hashUpdatedAt: new Date().toISOString(),
      approval: 'unknown', trusted: false, analysisStatus: 'pending',
      requiredBins: [], requiredEnv: [], extractedCommands: [],
    });
    const v2 = repo.addVersion({
      skillId: skill.id, version: '2.0.0', folderPath: '/tmp',
      contentHash: 'def', hashUpdatedAt: new Date().toISOString(),
      approval: 'unknown', trusted: false, analysisStatus: 'pending',
      requiredBins: [], requiredEnv: [], extractedCommands: [],
    });

    // Two installations: one auto-update, one pinned
    const inst1 = repo.install({ skillVersionId: v1.id, status: 'active', autoUpdate: true });
    const inst2 = repo.install({ skillVersionId: v1.id, status: 'active', autoUpdate: true });
    repo.pinVersion(inst2.id, '1.0.0');

    const result = service.propagateUpdate(skill.id, v2.id);

    expect(result.installationsUpdated).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Verify inst1 was updated
    const installations = repo.getInstallations();
    const updated = installations.find((i) => i.id === inst1.id)!;
    expect(updated.skillVersionId).toBe(v2.id);

    // inst2 should still be on v1
    const pinned = installations.find((i) => i.id === inst2.id)!;
    expect(pinned.skillVersionId).toBe(v1.id);
  });

  it('propagateUpdate throws for non-existent skill', () => {
    const service = new UpdateService(repo, null, emitter);
    expect(() => service.propagateUpdate('non-existent', 'v1')).toThrow('Skill not found');
  });

  it('checkForUpdates calls remote for skills with remoteId', async () => {
    const mockRemote = {
      search: async () => ({ results: [], total: 0, page: 1, pageSize: 10 }),
      getSkill: async () => null,
      download: async () => ({ zipBuffer: Buffer.alloc(0), checksum: '', version: '2.0.0' }),
      upload: async () => ({ remoteId: '', name: '', slug: '', tags: [], latestVersion: '', downloadUrl: '', checksum: '' }),
      checkVersion: jest.fn().mockResolvedValue({
        remoteId: 'r-1', currentVersion: '1.0.0', latestVersion: '2.0.0', downloadUrl: '', checksum: '',
      }),
    };

    const service = new UpdateService(repo, mockRemote, emitter);

    const skill = repo.create({
      name: 'Remote S', slug: 'remote-s', tags: [], source: 'marketplace', remoteId: 'r-1',
    });
    const v = repo.addVersion({
      skillId: skill.id, version: '1.0.0', folderPath: '/tmp',
      contentHash: 'abc', hashUpdatedAt: new Date().toISOString(),
      approval: 'unknown', trusted: false, analysisStatus: 'pending',
      requiredBins: [], requiredEnv: [], extractedCommands: [],
    });
    repo.install({ skillVersionId: v.id, status: 'active', autoUpdate: true });

    const results = await service.checkForUpdates();

    expect(mockRemote.checkVersion).toHaveBeenCalledWith('r-1', '1.0.0');
    expect(results).toHaveLength(1);
    expect(results[0].availableVersion).toBe('2.0.0');
    expect(results[0].installationsAffected).toBe(1);
  });
});
