/**
 * Performance test suite for the skills library.
 *
 * Measures throughput, speed, and event loop lag during key operations
 * at realistic scale (hundreds of skills, 30+ profiles, 100+ files).
 *
 * All tests use real SQLite + real filesystem — no mocks.
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
import { InstallService } from '../install/install.service';
import { UploadService } from '../upload/upload.service';
import { SkillBackupService } from '../backup/backup.service';
import { SkillWatcherService } from '../watcher/watcher.service';
import { CatalogService } from '../catalog/catalog.service';
import { LocalSearchAdapter } from '../catalog/adapters/local.adapter';
import { TestDeployAdapter } from './helpers/test-deploy-adapter';

jest.setTimeout(60_000);

// ---- Helpers ----

function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new SchemaMigration().up(db);
  return {
    db,
    dir,
    cleanup: () => {
      db.close();
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
    },
  };
}

function createTestDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-dirs-'));
  const skillsDir = path.join(base, 'skills');
  const quarantineDir = path.join(base, 'quarantine');
  const backupDir = path.join(base, 'backup');
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.mkdirSync(quarantineDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  return {
    base,
    skillsDir,
    quarantineDir,
    backupDir,
    cleanup: () => {
      try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* */ }
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
    contentHash: 'abc', hashUpdatedAt: new Date().toISOString(),
    approval: 'approved' as const, trusted: false, analysisStatus: 'pending' as const,
    requiredBins: [] as string[], requiredEnv: [] as string[], extractedCommands: [] as unknown[],
    ...overrides,
  };
}

function ensureProfiles(db: Database.Database, count: number): string[] {
  const stmt = db.prepare("INSERT OR IGNORE INTO profiles (id, name, type) VALUES (?, ?, 'target')");
  return Array.from({ length: count }, (_, i) => {
    const id = `perf-profile-${i}`;
    stmt.run(id, `perf-user-${i}`);
    return id;
  });
}

function generateFileContent(index: number, sizeBytes = 500): Buffer {
  return Buffer.from(`// generated-file-${index}\n` + 'x'.repeat(Math.max(0, sizeBytes - 25)));
}

function seedSkillOnDisk(dir: string, slug: string, fileCount: number): void {
  const skillDir = path.join(dir, slug);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, '_meta.json'), JSON.stringify({ name: slug, version: '1.0.0' }));
  for (let i = 0; i < fileCount; i++) {
    fs.writeFileSync(path.join(skillDir, `file-${i}.ts`), generateFileContent(i));
  }
}

function seedSkillInDb(repo: SkillsRepository, slug: string, fileCount: number) {
  const skill = repo.create(makeSkillInput({ slug, name: slug }));
  const v = repo.addVersion(makeVersionInput(skill.id, { version: '1.0.0' }));
  const files = Array.from({ length: fileCount }, (_, i) => ({
    relativePath: `file-${i}.ts`,
    fileHash: crypto.createHash('sha256').update(generateFileContent(i)).digest('hex'),
    sizeBytes: 500,
  }));
  repo.registerFiles({ versionId: v.id, files });
  return { skill, version: v };
}

async function measureEventLoopLag(fn: () => void | Promise<void>) {
  const { monitorEventLoopDelay } = await import('node:perf_hooks');
  const h = monitorEventLoopDelay({ resolution: 1 });
  h.enable();
  const start = performance.now();
  await fn();
  const elapsed = performance.now() - start;
  h.disable();
  return {
    elapsed,
    maxLagMs: h.max / 1e6,
    p99LagMs: h.percentile(99) / 1e6,
    meanLagMs: h.mean / 1e6,
  };
}

/**
 * For fully synchronous functions, monitorEventLoopDelay won't capture the block
 * because the callback never fires. Use a setTimeout(0) probe to measure actual delay.
 */
async function measureSyncBlockLag(fn: () => void): Promise<{ elapsed: number; probeDelayMs: number }> {
  return new Promise((resolve) => {
    let probeTime: number;
    const probeStart = performance.now();
    setTimeout(() => {
      probeTime = performance.now() - probeStart;
      // probeTime includes the sync block duration if fn ran after setTimeout was scheduled
    }, 0);

    // Run sync function on next microtask to let setTimeout register first
    queueMicrotask(() => {
      const start = performance.now();
      fn();
      const elapsed = performance.now() - start;

      // Let the setTimeout fire
      setTimeout(() => {
        resolve({ elapsed, probeDelayMs: probeTime });
      }, 5);
    });
  });
}

// ---- Tests ----

describe('Performance', () => {
  // All tests use real timers
  beforeAll(() => jest.useRealTimers());

  // ---- 1. DB Scale — bulk operations ----

  describe('DB Scale — bulk operations', () => {
    let db: Database.Database;
    let dbDir: string;
    let dbCleanup: () => void;
    let repo: SkillsRepository;

    beforeAll(() => {
      ({ db, dir: dbDir, cleanup: dbCleanup } = createTestDb());
      repo = new SkillsRepository(db, () => null);
    });

    afterAll(() => dbCleanup());

    it('creates 200 skills with versions and files', () => {
      const start = performance.now();

      for (let i = 0; i < 200; i++) {
        seedSkillInDb(repo, `perf-skill-${i}`, 10);
      }

      const elapsed = performance.now() - start;
      // eslint-disable-next-line no-console
      console.log(`  [perf] 200 skills + versions + 2000 files: ${elapsed.toFixed(0)}ms`);
      expect(elapsed).toBeLessThan(2_000);
    });

    it('getInstallations() with 50 installations', () => {
      // Setup: create profiles and install 50 skills
      const profiles = ensureProfiles(db, 10);
      for (let i = 0; i < 50; i++) {
        const skill = repo.getBySlug(`perf-skill-${i}`);
        if (!skill) continue;
        const version = repo.getLatestVersion(skill.id);
        if (!version) continue;
        repo.install({
          skillVersionId: version.id,
          profileId: profiles[i % profiles.length],
          status: 'active',
        });
      }

      // Measure
      const iterations = 100;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        repo.getInstallations();
      }
      const elapsed = performance.now() - start;
      const avg = elapsed / iterations;

      // eslint-disable-next-line no-console
      console.log(`  [perf] getInstallations() avg: ${avg.toFixed(2)}ms (${iterations} calls)`);
      expect(avg).toBeLessThan(2);
    });

    it('search("perf") across 200 skills', () => {
      const start = performance.now();
      const results = repo.search('perf');
      const elapsed = performance.now() - start;

      // eslint-disable-next-line no-console
      console.log(`  [perf] search('perf') across 200 skills: ${elapsed.toFixed(1)}ms, ${results.length} results`);
      expect(elapsed).toBeLessThan(50);
      expect(results.length).toBeGreaterThan(0);
    });

    it('listInstalled with 50 installed', () => {
      const catalog = new CatalogService(repo, [new LocalSearchAdapter(repo)]);

      const start = performance.now();
      const installed = catalog.listInstalled();
      const elapsed = performance.now() - start;

      // eslint-disable-next-line no-console
      console.log(`  [perf] listInstalled (50 installed): ${elapsed.toFixed(1)}ms, ${installed.length} results`);
      expect(elapsed).toBeLessThan(50);
    });

    it('recomputeContentHash with 50 files', () => {
      const skill = repo.create(makeSkillInput({ slug: 'perf-hash-skill', name: 'Hash Perf' }));
      const v = repo.addVersion(makeVersionInput(skill.id, { version: '1.0.0' }));
      const files = Array.from({ length: 50 }, (_, i) => ({
        relativePath: `hash-file-${i}.ts`,
        fileHash: crypto.createHash('sha256').update(generateFileContent(i)).digest('hex'),
        sizeBytes: 500,
      }));
      repo.registerFiles({ versionId: v.id, files });

      const start = performance.now();
      repo.recomputeContentHash(v.id);
      const elapsed = performance.now() - start;

      // eslint-disable-next-line no-console
      console.log(`  [perf] recomputeContentHash (50 files): ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(50);
    });
  });

  // ---- 2. Install at Scale — 30 profiles ----

  describe('Install at Scale — 30 profiles', () => {
    let db: Database.Database;
    let dbCleanup: () => void;
    let dirs: ReturnType<typeof createTestDirs>;
    let repo: SkillsRepository;
    let emitter: EventEmitter;
    let installService: InstallService;
    let deployService: DeployService;
    let backup: SkillBackupService;
    let profiles: string[];
    let skillId: string;
    let installationIds: string[];

    beforeAll(() => {
      ({ db, cleanup: dbCleanup } = createTestDb());
      dirs = createTestDirs();
      repo = new SkillsRepository(db, () => null);
      emitter = new EventEmitter();
      backup = new SkillBackupService(dirs.backupDir);

      const adapter = new TestDeployAdapter({ skillsDir: dirs.skillsDir });
      deployService = new DeployService(repo, [adapter], emitter, backup);
      installService = new InstallService(repo, null, emitter, deployService);

      // Create 30 profiles
      profiles = ensureProfiles(db, 30);

      // Create skill with version + files + backup
      const skill = repo.create(makeSkillInput({ slug: 'install-perf', name: 'Install Perf' }));
      skillId = skill.id;
      const files = Array.from({ length: 5 }, (_, i) => ({
        relativePath: `file-${i}.ts`,
        content: generateFileContent(i),
      }));
      const fileEntries = files.map((f) => ({
        relativePath: f.relativePath,
        fileHash: crypto.createHash('sha256').update(f.content).digest('hex'),
        sizeBytes: f.content.length,
      }));
      const v = repo.addVersion(makeVersionInput(skill.id, {
        version: '1.0.0',
        folderPath: path.join(dirs.skillsDir, 'install-perf'),
      }));
      repo.registerFiles({ versionId: v.id, files: fileEntries });
      backup.saveFiles(v.id, files);

      installationIds = [];
    });

    afterAll(() => {
      dbCleanup();
      dirs.cleanup();
    });

    it('installs same skill to 30 profiles', async () => {
      const start = performance.now();

      for (const profileId of profiles) {
        const inst = await installService.install({ skillId, profileId });
        installationIds.push(inst.id);
      }

      const elapsed = performance.now() - start;
      // eslint-disable-next-line no-console
      console.log(`  [perf] install to 30 profiles: ${elapsed.toFixed(0)}ms`);
      expect(elapsed).toBeLessThan(1_000);
      expect(installationIds).toHaveLength(30);
    });

    it('install to 30 profiles — event loop lag', async () => {
      // Uninstall existing ones first to re-install with lag measurement
      for (const id of installationIds) {
        await installService.uninstall(id);
      }
      installationIds = [];

      const lag = await measureEventLoopLag(async () => {
        for (const profileId of profiles) {
          const inst = await installService.install({ skillId, profileId });
          installationIds.push(inst.id);
        }
      });

      // eslint-disable-next-line no-console
      console.log(`  [perf] install 30 profiles — maxLag: ${lag.maxLagMs.toFixed(1)}ms, p99: ${lag.p99LagMs.toFixed(1)}ms, elapsed: ${lag.elapsed.toFixed(0)}ms`);
      expect(lag.maxLagMs).toBeLessThan(50);
    });

    it('uninstalls from 30 profiles', async () => {
      const start = performance.now();

      for (const id of installationIds) {
        await installService.uninstall(id);
      }

      const elapsed = performance.now() - start;
      // eslint-disable-next-line no-console
      console.log(`  [perf] uninstall 30 profiles: ${elapsed.toFixed(0)}ms`);
      expect(elapsed).toBeLessThan(500);
    });
  });

  // ---- 3. Watcher — scanForNewSkills at scale ----

  describe('Watcher — scanForNewSkills at scale', () => {
    let db: Database.Database;
    let dbCleanup: () => void;
    let dirs: ReturnType<typeof createTestDirs>;
    let repo: SkillsRepository;
    let emitter: EventEmitter;
    let watcher: SkillWatcherService;

    beforeAll(() => {
      ({ db, cleanup: dbCleanup } = createTestDb());
      dirs = createTestDirs();
      repo = new SkillsRepository(db, () => null);
      emitter = new EventEmitter();
      const backup = new SkillBackupService(dirs.backupDir);
      const adapter = new TestDeployAdapter({ skillsDir: dirs.skillsDir });
      const deployer = new DeployService(repo, [adapter], emitter, backup);
      watcher = new SkillWatcherService(repo, deployer, emitter, {
        skillsDir: dirs.skillsDir,
        quarantineDir: dirs.quarantineDir,
        pollIntervalMs: 999_999,
      }, backup);

      // Seed 20 skill directories on disk (5 files each)
      for (let i = 0; i < 20; i++) {
        seedSkillOnDisk(dirs.skillsDir, `scan-skill-${i}`, 5);
      }
    });

    afterAll(() => {
      dbCleanup();
      dirs.cleanup();
    });

    it('scans 20 skill directories (5 files each)', () => {
      const start = performance.now();
      watcher.scanForNewSkills();
      const elapsed = performance.now() - start;

      // eslint-disable-next-line no-console
      console.log(`  [perf] scanForNewSkills (20 dirs, 5 files each): ${elapsed.toFixed(0)}ms`);
      expect(elapsed).toBeLessThan(1_000);

      // Verify all 20 skills were detected and quarantined
      for (let i = 0; i < 20; i++) {
        const skill = repo.getBySlug(`scan-skill-${i}`);
        expect(skill).not.toBeNull();
      }
    });

    it('scanForNewSkills event loop lag', async () => {
      // Re-seed dirs (previous scan removed them)
      for (let i = 0; i < 20; i++) {
        seedSkillOnDisk(dirs.skillsDir, `scan-lag-skill-${i}`, 5);
      }

      const result = await measureSyncBlockLag(() => {
        watcher.scanForNewSkills();
      });

      // eslint-disable-next-line no-console
      console.log(`  [perf] scanForNewSkills sync block: elapsed=${result.elapsed.toFixed(0)}ms, probeDelay=${result.probeDelayMs.toFixed(0)}ms`);
      expect(result.elapsed).toBeLessThan(1_000);
    });
  });

  // ---- 4. Watcher — checkAllIntegrity at scale ----

  describe('Watcher — checkAllIntegrity at scale', () => {
    let db: Database.Database;
    let dbCleanup: () => void;
    let dirs: ReturnType<typeof createTestDirs>;
    let repo: SkillsRepository;
    let emitter: EventEmitter;
    let deployer: DeployService;
    let backup: SkillBackupService;

    beforeAll(async () => {
      ({ db, cleanup: dbCleanup } = createTestDb());
      dirs = createTestDirs();
      repo = new SkillsRepository(db, () => null);
      emitter = new EventEmitter();
      backup = new SkillBackupService(dirs.backupDir);
      const adapter = new TestDeployAdapter({ skillsDir: dirs.skillsDir });
      deployer = new DeployService(repo, [adapter], emitter, backup);

      const profiles = ensureProfiles(db, 50);

      // Create 50 skills, each with 5 files, deployed to disk
      for (let i = 0; i < 50; i++) {
        const skill = repo.create(makeSkillInput({ slug: `integrity-skill-${i}`, name: `Integrity ${i}` }));
        const files = Array.from({ length: 5 }, (_, j) => ({
          relativePath: `file-${j}.ts`,
          content: generateFileContent(j),
        }));
        const fileEntries = files.map((f) => ({
          relativePath: f.relativePath,
          fileHash: crypto.createHash('sha256').update(f.content).digest('hex'),
          sizeBytes: f.content.length,
        }));
        const v = repo.addVersion(makeVersionInput(skill.id, {
          version: '1.0.0',
          folderPath: path.join(dirs.skillsDir, `integrity-skill-${i}`),
        }));
        repo.registerFiles({ versionId: v.id, files: fileEntries });
        backup.saveFiles(v.id, files);

        const inst = repo.install({
          skillVersionId: v.id,
          profileId: profiles[i],
          status: 'pending',
        });

        // Deploy to disk via adapter
        await deployer.deploy(inst, v, skill);
        repo.updateInstallationStatus(inst.id, { status: 'active' });
      }
    });

    afterAll(() => {
      dbCleanup();
      dirs.cleanup();
    });

    it('checkAllIntegrity with 50 installations (5 files each)', async () => {
      const start = performance.now();
      const results = await deployer.checkAllIntegrity();
      const elapsed = performance.now() - start;

      // eslint-disable-next-line no-console
      console.log(`  [perf] checkAllIntegrity (50 installations, 5 files each): ${elapsed.toFixed(0)}ms, ${results.length} checks`);
      expect(elapsed).toBeLessThan(2_000);
      expect(results).toHaveLength(50);
      // All should be intact since files haven't been tampered with
      for (const r of results) {
        expect(r.result.intact).toBe(true);
      }
    });

    it('checkAllIntegrity event loop lag', async () => {
      const lag = await measureEventLoopLag(async () => {
        await deployer.checkAllIntegrity();
      });

      // eslint-disable-next-line no-console
      console.log(`  [perf] checkAllIntegrity lag — max: ${lag.maxLagMs.toFixed(1)}ms, p99: ${lag.p99LagMs.toFixed(1)}ms, elapsed: ${lag.elapsed.toFixed(0)}ms`);
      expect(lag.maxLagMs).toBeLessThan(100);
    });
  });

  // ---- 5. Upload and Hash at scale ----

  describe('Upload and Hash at scale', () => {
    let db: Database.Database;
    let dbCleanup: () => void;
    let dirs: ReturnType<typeof createTestDirs>;
    let repo: SkillsRepository;
    let emitter: EventEmitter;
    let uploader: UploadService;

    beforeAll(() => {
      ({ db, cleanup: dbCleanup } = createTestDb());
      dirs = createTestDirs();
      repo = new SkillsRepository(db, () => null);
      emitter = new EventEmitter();
      const backup = new SkillBackupService(dirs.backupDir);
      uploader = new UploadService(repo, emitter, backup);
    });

    afterAll(() => {
      dbCleanup();
      dirs.cleanup();
    });

    it('uploadFromFiles with 50 files', () => {
      const files = Array.from({ length: 50 }, (_, i) => ({
        relativePath: `upload-file-${i}.ts`,
        content: generateFileContent(i),
      }));

      const start = performance.now();
      uploader.uploadFromFiles({
        name: 'Upload Perf',
        slug: 'upload-perf',
        version: '1.0.0',
        files,
      });
      const elapsed = performance.now() - start;

      // eslint-disable-next-line no-console
      console.log(`  [perf] uploadFromFiles (50 files): ${elapsed.toFixed(0)}ms`);
      expect(elapsed).toBeLessThan(500);
    });

    it('upload event loop lag', async () => {
      const files = Array.from({ length: 50 }, (_, i) => ({
        relativePath: `upload-lag-file-${i}.ts`,
        content: generateFileContent(i),
      }));

      const result = await measureSyncBlockLag(() => {
        uploader.uploadFromFiles({
          name: 'Upload Lag Perf',
          slug: 'upload-lag-perf',
          version: '1.0.0',
          files,
        });
      });

      // eslint-disable-next-line no-console
      console.log(`  [perf] uploadFromFiles sync block: elapsed=${result.elapsed.toFixed(0)}ms, probeDelay=${result.probeDelayMs.toFixed(0)}ms`);
      expect(result.elapsed).toBeLessThan(500);
    });
  });

  // ---- 6. Backup at scale ----

  describe('Backup at scale', () => {
    let dirs: ReturnType<typeof createTestDirs>;
    let backup: SkillBackupService;
    let savedHash: string;
    const versionId = 'perf-backup-version-id';

    beforeAll(() => {
      dirs = createTestDirs();
      backup = new SkillBackupService(dirs.backupDir);
    });

    afterAll(() => dirs.cleanup());

    it('saveFiles + verifyIntegrity (50 files)', () => {
      const files = Array.from({ length: 50 }, (_, i) => ({
        relativePath: `backup-file-${i}.ts`,
        content: generateFileContent(i),
      }));

      const start = performance.now();
      savedHash = backup.saveFiles(versionId, files);
      const verified = backup.verifyIntegrity(versionId, savedHash);
      const elapsed = performance.now() - start;

      // eslint-disable-next-line no-console
      console.log(`  [perf] saveFiles + verifyIntegrity (50 files): ${elapsed.toFixed(0)}ms`);
      expect(elapsed).toBeLessThan(500);
      expect(verified).toBe(true);
    });

    it('loadFiles (50 files)', () => {
      const start = performance.now();
      const loaded = backup.loadFiles(versionId);
      const elapsed = performance.now() - start;

      // eslint-disable-next-line no-console
      console.log(`  [perf] loadFiles (50 files): ${elapsed.toFixed(0)}ms, ${loaded.size} files`);
      expect(elapsed).toBeLessThan(200);
      expect(loaded.size).toBe(50);
    });
  });

  // ---- 7. Catalog search at scale ----

  describe('Catalog search at scale', () => {
    let db: Database.Database;
    let dbCleanup: () => void;
    let repo: SkillsRepository;
    let catalog: CatalogService;

    beforeAll(() => {
      ({ db, cleanup: dbCleanup } = createTestDb());
      repo = new SkillsRepository(db, () => null);
      catalog = new CatalogService(repo, [new LocalSearchAdapter(repo)]);

      const profiles = ensureProfiles(db, 10);

      // Create 200 skills
      for (let i = 0; i < 200; i++) {
        const skill = repo.create(makeSkillInput({ slug: `catalog-skill-${i}`, name: `Catalog Skill ${i}` }));
        const v = repo.addVersion(makeVersionInput(skill.id, { version: '1.0.0' }));

        // Install first 100
        if (i < 100) {
          repo.install({
            skillVersionId: v.id,
            profileId: profiles[i % profiles.length],
            status: 'active',
          });
        }
      }
    });

    afterAll(() => dbCleanup());

    it('local search across 200 skills', async () => {
      const start = performance.now();
      const results = await catalog.search('catalog');
      const elapsed = performance.now() - start;

      // eslint-disable-next-line no-console
      console.log(`  [perf] catalog.search('catalog') across 200 skills: ${elapsed.toFixed(1)}ms, ${results.length} results`);
      expect(elapsed).toBeLessThan(100);
      expect(results.length).toBeGreaterThan(0);
    });

    it('listInstalled with 100 installed', () => {
      const start = performance.now();
      const installed = catalog.listInstalled();
      const elapsed = performance.now() - start;

      // eslint-disable-next-line no-console
      console.log(`  [perf] listInstalled (100 installed): ${elapsed.toFixed(1)}ms, ${installed.length} results`);
      expect(elapsed).toBeLessThan(50);
    });
  });

  // ---- 8. Event loop blocking audit ----

  describe('Event loop blocking audit', () => {
    let db: Database.Database;
    let dbCleanup: () => void;
    let dirs: ReturnType<typeof createTestDirs>;
    let repo: SkillsRepository;
    let emitter: EventEmitter;
    let deployer: DeployService;
    let watcher: SkillWatcherService;
    let backup: SkillBackupService;
    let uploader: UploadService;

    beforeAll(async () => {
      ({ db, cleanup: dbCleanup } = createTestDb());
      dirs = createTestDirs();
      repo = new SkillsRepository(db, () => null);
      emitter = new EventEmitter();
      backup = new SkillBackupService(dirs.backupDir);
      const adapter = new TestDeployAdapter({ skillsDir: dirs.skillsDir });
      deployer = new DeployService(repo, [adapter], emitter, backup);
      watcher = new SkillWatcherService(repo, deployer, emitter, {
        skillsDir: dirs.skillsDir,
        quarantineDir: dirs.quarantineDir,
        pollIntervalMs: 999_999,
      }, backup);
      uploader = new UploadService(repo, emitter, backup);

      const profiles = ensureProfiles(db, 10);

      // Create 10 skills with 3 files each, deployed to disk
      for (let i = 0; i < 10; i++) {
        const skill = repo.create(makeSkillInput({ slug: `audit-skill-${i}`, name: `Audit ${i}` }));
        const files = Array.from({ length: 3 }, (_, j) => ({
          relativePath: `file-${j}.ts`,
          content: generateFileContent(j),
        }));
        const fileEntries = files.map((f) => ({
          relativePath: f.relativePath,
          fileHash: crypto.createHash('sha256').update(f.content).digest('hex'),
          sizeBytes: f.content.length,
        }));
        const v = repo.addVersion(makeVersionInput(skill.id, {
          version: '1.0.0',
          folderPath: path.join(dirs.skillsDir, `audit-skill-${i}`),
        }));
        repo.registerFiles({ versionId: v.id, files: fileEntries });
        backup.saveFiles(v.id, files);

        const inst = repo.install({
          skillVersionId: v.id,
          profileId: profiles[i],
          status: 'pending',
        });
        await deployer.deploy(inst, v, skill);
        repo.updateInstallationStatus(inst.id, { status: 'active' });
      }
    });

    afterAll(() => {
      dbCleanup();
      dirs.cleanup();
    });

    it('event loop block during full poll() cycle', async () => {
      const lag = await measureEventLoopLag(async () => {
        await watcher.poll();
      });

      // eslint-disable-next-line no-console
      console.log(`  [perf] poll() — maxLag: ${lag.maxLagMs.toFixed(1)}ms, p99: ${lag.p99LagMs.toFixed(1)}ms, elapsed: ${lag.elapsed.toFixed(0)}ms`);
      expect(lag.maxLagMs).toBeLessThan(200);
    });

    it('event loop block during scanForNewSkills()', async () => {
      // Seed 10 new skill dirs for scanning
      for (let i = 0; i < 10; i++) {
        seedSkillOnDisk(dirs.skillsDir, `audit-scan-${i}`, 3);
      }

      const result = await measureSyncBlockLag(() => {
        watcher.scanForNewSkills();
      });

      // eslint-disable-next-line no-console
      console.log(`  [perf] scanForNewSkills() sync block: elapsed=${result.elapsed.toFixed(0)}ms, probeDelay=${result.probeDelayMs.toFixed(0)}ms`);
      expect(result.elapsed).toBeLessThan(1_000);
    });

    it('event loop block during uploadFromFiles()', async () => {
      const files = Array.from({ length: 30 }, (_, i) => ({
        relativePath: `audit-upload-${i}.ts`,
        content: generateFileContent(i, 1024),
      }));

      const result = await measureSyncBlockLag(() => {
        uploader.uploadFromFiles({
          name: 'Audit Upload',
          slug: 'audit-upload',
          version: '1.0.0',
          files,
        });
      });

      // eslint-disable-next-line no-console
      console.log(`  [perf] uploadFromFiles() sync block: elapsed=${result.elapsed.toFixed(0)}ms, probeDelay=${result.probeDelayMs.toFixed(0)}ms`);
      expect(result.elapsed).toBeLessThan(500);
    });
  });
});
