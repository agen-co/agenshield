/**
 * CatalogService + SearchAdapter tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { InitialSchemaMigration } from '../../../storage/src/migrations/001-initial-schema';
import { SkillsManagerColumnsMigration } from '../../../storage/src/migrations/003-skills-manager-columns';
import { SkillsRepository } from '../../../storage/src/repositories/skills/skills.repository';
import { CatalogService } from '../catalog/catalog.service';
import { LocalSearchAdapter } from '../catalog/adapters/local.adapter';
import { RemoteSearchAdapter } from '../catalog/adapters/remote.adapter';
import type { SearchAdapter } from '../catalog/types';
import type { RemoteSkillClient } from '../remote/types';

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
    name: 'Test Skill',
    slug: 'test-skill',
    author: 'tester',
    description: 'A test skill',
    tags: ['test'],
    source: 'manual' as const,
    ...overrides,
  };
}

function makeVersionInput(skillId: string, overrides?: Record<string, unknown>) {
  return {
    skillId,
    version: '1.0.0',
    folderPath: '/tmp/skills/test-skill/1.0.0',
    contentHash: 'abc123',
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

function makeMockRemote(): RemoteSkillClient {
  return {
    search: async () => ({
      results: [{
        remoteId: 'r-1', name: 'Test Skill', slug: 'test-skill',
        tags: [], latestVersion: '1.0.0', downloadUrl: '', checksum: '',
      }],
      total: 1, page: 1, pageSize: 10,
    }),
    getSkill: async () => null,
    download: async () => ({ zipBuffer: Buffer.alloc(0), checksum: '', version: '1.0.0' }),
    upload: async () => ({ remoteId: '', name: '', slug: '', tags: [], latestVersion: '', downloadUrl: '', checksum: '' }),
    checkVersion: async () => null,
  };
}

describe('LocalSearchAdapter', () => {
  let cleanup: () => void;
  let repo: SkillsRepository;
  let adapter: LocalSearchAdapter;

  beforeEach(() => {
    const result = createTestDb();
    cleanup = result.cleanup;
    repo = new SkillsRepository(result.db, () => null);
    adapter = new LocalSearchAdapter(repo);
  });

  afterEach(() => cleanup());

  it('has correct id and displayName', () => {
    expect(adapter.id).toBe('local');
    expect(adapter.displayName).toBe('Local Database');
  });

  it('searches local skills', async () => {
    repo.create(makeSkillInput({ slug: 'alpha', name: 'Alpha Tool' }));
    repo.create(makeSkillInput({ slug: 'beta', name: 'Beta Widget' }));

    const results = await adapter.search('Tool');
    expect(results).toHaveLength(1);
    expect(results[0].skill.slug).toBe('alpha');
    expect(results[0].source).toBe('local');
  });

  it('includes latestVersion when available', async () => {
    const skill = repo.create(makeSkillInput());
    repo.addVersion(makeVersionInput(skill.id));

    const results = await adapter.search('Test');
    expect(results).toHaveLength(1);
    expect(results[0].latestVersion).toBeDefined();
  });
});

describe('RemoteSearchAdapter', () => {
  it('has correct id and displayName', () => {
    const adapter = new RemoteSearchAdapter(makeMockRemote());
    expect(adapter.id).toBe('remote');
    expect(adapter.displayName).toBe('Marketplace');
  });

  it('returns results from remote client', async () => {
    const adapter = new RemoteSearchAdapter(makeMockRemote());
    const results = await adapter.search('Test');
    expect(results).toHaveLength(1);
    expect(results[0].skill.slug).toBe('test-skill');
    expect(results[0].source).toBe('remote');
  });

  it('returns empty on remote error', async () => {
    const failingRemote = makeMockRemote();
    failingRemote.search = async () => { throw new Error('Network error'); };
    const adapter = new RemoteSearchAdapter(failingRemote);

    const results = await adapter.search('Test');
    expect(results).toEqual([]);
  });
});

describe('CatalogService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: SkillsRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new SkillsRepository(db, () => null);
  });

  afterEach(() => cleanup());

  it('search returns local results with local adapter only', async () => {
    const skill = repo.create(makeSkillInput());
    repo.addVersion(makeVersionInput(skill.id));

    const catalog = new CatalogService(repo, [new LocalSearchAdapter(repo)]);
    const results = await catalog.search('Test');
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('local');
    expect(results[0].skill.slug).toBe('test-skill');
    expect(results[0].latestVersion).toBeDefined();
  });

  it('search deduplicates by slug (first adapter wins)', async () => {
    repo.create(makeSkillInput());

    const catalog = new CatalogService(repo, [
      new LocalSearchAdapter(repo),
      new RemoteSearchAdapter(makeMockRemote()),
    ]);

    const results = await catalog.search('Test');
    // Should only have 1 result (local wins, remote deduped)
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('local');
  });

  it('search includes remote results when slug differs', async () => {
    repo.create(makeSkillInput({ slug: 'other-skill', name: 'Other' }));

    const remoteClient = makeMockRemote();
    remoteClient.search = async () => ({
      results: [{
        remoteId: 'r-2', name: 'Different Skill', slug: 'different-skill',
        tags: [], latestVersion: '1.0.0', downloadUrl: '', checksum: '',
      }],
      total: 1, page: 1, pageSize: 10,
    });

    const catalog = new CatalogService(repo, [
      new LocalSearchAdapter(repo),
      new RemoteSearchAdapter(remoteClient),
    ]);

    const results = await catalog.search('Skill');
    // no local match for 'Skill' in 'Other', but remote returns 'Different Skill'
    expect(results.some((r) => r.skill.slug === 'different-skill')).toBe(true);
  });

  it('getDetail returns skill with versions and installations', () => {
    const skill = repo.create(makeSkillInput());
    const v = repo.addVersion(makeVersionInput(skill.id));
    repo.install({ skillVersionId: v.id, status: 'active' });

    const catalog = new CatalogService(repo, [new LocalSearchAdapter(repo)]);
    const detail = catalog.getDetail(skill.id);
    expect(detail).not.toBeNull();
    expect(detail!.skill.id).toBe(skill.id);
    expect(detail!.versions).toHaveLength(1);
    expect(detail!.installations).toHaveLength(1);
  });

  it('getDetail returns null for non-existent', () => {
    const catalog = new CatalogService(repo, []);
    expect(catalog.getDetail('non-existent')).toBeNull();
  });

  it('listInstalled returns installed skills', () => {
    const skill = repo.create(makeSkillInput());
    const v = repo.addVersion(makeVersionInput(skill.id));
    repo.install({ skillVersionId: v.id, status: 'active' });

    const catalog = new CatalogService(repo, []);
    const installed = catalog.listInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].slug).toBe('test-skill');
  });
});
