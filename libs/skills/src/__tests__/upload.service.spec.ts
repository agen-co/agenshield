/**
 * UploadService tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { InitialSchemaMigration } from '../../../storage/src/migrations/001-initial-schema';
import { SkillsManagerColumnsMigration } from '../../../storage/src/migrations/003-skills-manager-columns';
import { SkillsRepository } from '../../../storage/src/repositories/skills/skills.repository';
import { UploadService } from '../upload/upload.service';
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

describe('UploadService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: SkillsRepository;
  let emitter: EventEmitter;
  let service: UploadService;
  let events: SkillEvent[];

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    repo = new SkillsRepository(db, () => null);
    emitter = new EventEmitter();
    events = [];
    emitter.on('skill-event', (e: SkillEvent) => events.push(e));
    service = new UploadService(repo, emitter);
  });

  afterEach(() => cleanup());

  it('uploadFromFiles creates skill + version + files', () => {
    const result = service.uploadFromFiles({
      name: 'Upload Test',
      slug: 'upload-test',
      version: '1.0.0',
      author: 'tester',
      files: [
        { relativePath: 'index.ts', content: Buffer.from('console.log("hello")') },
        { relativePath: 'lib/util.ts', content: Buffer.from('export const x = 1') },
      ],
    });

    expect(result.skill.name).toBe('Upload Test');
    expect(result.skill.slug).toBe('upload-test');
    expect(result.version.version).toBe('1.0.0');
    expect(result.version.contentHash).toBeDefined();
    expect(result.version.contentHash.length).toBe(64);

    // Files were registered
    const files = repo.getFiles(result.version.id);
    expect(files).toHaveLength(2);

    // Events
    expect(events.some((e) => e.type === 'upload:started')).toBe(true);
    expect(events.some((e) => e.type === 'upload:completed')).toBe(true);
    expect(events.some((e) => e.type === 'skill:created')).toBe(true);
    expect(events.some((e) => e.type === 'version:created')).toBe(true);
  });

  it('uploadFromFiles reuses existing skill by slug', () => {
    // Create first version
    service.uploadFromFiles({
      name: 'Reuse', slug: 'reuse-skill', version: '1.0.0',
      files: [{ relativePath: 'a.ts', content: Buffer.from('a') }],
    });

    // Upload second version — same slug
    const result = service.uploadFromFiles({
      name: 'Reuse', slug: 'reuse-skill', version: '2.0.0',
      files: [{ relativePath: 'a.ts', content: Buffer.from('a-v2') }],
    });

    expect(result.version.version).toBe('2.0.0');

    // Only one skill
    const all = repo.getAll();
    expect(all).toHaveLength(1);

    // Two versions
    const versions = repo.getVersions(result.skill.id);
    expect(versions).toHaveLength(2);
  });

  it('uploadFromFiles generates deterministic content hash', () => {
    const files = [
      { relativePath: 'b.ts', content: Buffer.from('b-content') },
      { relativePath: 'a.ts', content: Buffer.from('a-content') },
    ];

    const r1 = service.uploadFromFiles({ name: 'A', slug: 'hash-test-1', version: '1.0.0', files });

    // Create a new service with fresh DB to upload same content
    const { db: db2, cleanup: cleanup2 } = createTestDb();
    const repo2 = new SkillsRepository(db2, () => null);
    const service2 = new UploadService(repo2, new EventEmitter());

    const r2 = service2.uploadFromFiles({ name: 'A', slug: 'hash-test-1', version: '1.0.0', files });

    expect(r1.version.contentHash).toBe(r2.version.contentHash);

    cleanup2();
  });
});
