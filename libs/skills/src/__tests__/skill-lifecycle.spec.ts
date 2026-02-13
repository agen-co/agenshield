/**
 * Skill lifecycle integration tests — real filesystem + real SQLite
 *
 * Tests the full install/uninstall/watcher cycle using OpenClawDeployAdapter
 * with real file I/O and real SQLite, verifying that:
 *   - SkillManager.install() suppresses watcher events
 *   - SkillManager.uninstall() suppresses watcher events
 *   - External filesystem changes trigger watcher events
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
import { SkillManager } from '../manager';
import { DeployService } from '../deploy/deploy.service';
import { SkillWatcherService } from '../watcher/watcher.service';
import { OpenClawDeployAdapter } from '../deploy/adapters/openclaw.adapter';
import type { SkillEvent } from '../events';
import type { Storage } from '@agenshield/storage';

// ---- Helpers ----

const DEBOUNCE_MS = 100;
const SETTLE_MS = DEBOUNCE_MS * 5;

function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new InitialSchemaMigration().up(db);
  new SkillsManagerColumnsMigration().up(db);
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
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-dirs-'));
  const skillsDir = path.join(base, 'skills');
  const quarantineDir = path.join(base, 'quarantine');
  const sourceDir = path.join(base, 'source');
  const backupDir = path.join(base, 'backup');
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.mkdirSync(quarantineDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  return {
    base,
    skillsDir,
    quarantineDir,
    sourceDir,
    backupDir,
    cleanup: () => {
      try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* */ }
    },
  };
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Seed skill files on disk and return the version folder path */
function seedSkillFiles(
  sourceDir: string,
  slug: string,
  version: string,
  files: Record<string, string>,
): string {
  const versionDir = path.join(sourceDir, slug, version);
  fs.mkdirSync(versionDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(versionDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return versionDir;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function waitForEvent(emitter: EventEmitter, type: string, timeoutMs = 5000): Promise<SkillEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.removeListener('skill-event', handler);
      reject(new Error(`Timed out waiting for event: ${type}`));
    }, timeoutMs);
    function handler(event: SkillEvent) {
      if (event.type === type) {
        clearTimeout(timer);
        emitter.removeListener('skill-event', handler);
        resolve(event);
      }
    }
    emitter.on('skill-event', handler);
  });
}

/** Create a SkillManager with real OpenClaw adapter and watcher */
function createManager(
  repo: SkillsRepository,
  skillsDir: string,
  quarantineDir: string,
  opts?: {
    defaultPolicy?: { onModified?: 'reinstall' | 'quarantine'; onDeleted?: 'reinstall' | 'quarantine' };
    backupDir?: string;
  },
) {
  const fakeStorage = { skills: repo } as unknown as Storage;
  return new SkillManager(fakeStorage, {
    offlineMode: true,
    deployers: [new OpenClawDeployAdapter({ skillsDir, createWrappers: false })],
    watcher: {
      skillsDir,
      quarantineDir,
      pollIntervalMs: 60_000, // long — we don't want auto-polling in tests
      fsScanDebounceMs: DEBOUNCE_MS,
      defaultPolicy: opts?.defaultPolicy,
    },
    backupDir: opts?.backupDir,
  });
}

const SKILL_SLUG = 'test-skill';
const SKILL_VERSION = '1.0.0';
const SKILL_FILES: Record<string, string> = {
  'SKILL.md': '# Test Skill\nA skill for testing.',
  'index.ts': 'export default function run() { return true; }',
  'config.json': '{"name":"test-skill"}',
};

/** Register a skill with version and files in the DB, seed files on disk */
function setupSkillInDb(
  repo: SkillsRepository,
  sourceDir: string,
  slug = SKILL_SLUG,
  version = SKILL_VERSION,
  files = SKILL_FILES,
) {
  const versionDir = seedSkillFiles(sourceDir, slug, version, files);

  const skill = repo.create({
    name: slug,
    slug,
    author: 'tester',
    tags: ['test'],
    source: 'manual',
  });

  const ver = repo.addVersion({
    skillId: skill.id,
    version,
    folderPath: versionDir,
    contentHash: 'placeholder',
    hashUpdatedAt: new Date().toISOString(),
    approval: 'approved',
    trusted: false,
    analysisStatus: 'pending',
    requiredBins: [],
    requiredEnv: [],
    extractedCommands: [],
  });

  const fileEntries = Object.entries(files).map(([name, content]) => ({
    relativePath: name,
    fileHash: hashContent(content),
    sizeBytes: Buffer.byteLength(content),
  }));

  repo.registerFiles({ versionId: ver.id, files: fileEntries });

  // Recompute content hash from file hashes
  repo.recomputeContentHash(ver.id);

  return { skill, version: ver, versionDir };
}

// ---- Tests ----

describe('Skill Lifecycle Integration', () => {
  let db: Database.Database;
  let dbCleanup: () => void;
  let dirs: ReturnType<typeof createTestDirs>;
  let repo: SkillsRepository;
  let events: SkillEvent[];
  let manager: SkillManager;

  beforeEach(() => {
    ({ db, cleanup: dbCleanup } = createTestDb());
    dirs = createTestDirs();
    repo = new SkillsRepository(db, () => null);
    events = [];
  });

  afterEach(() => {
    manager?.stopWatcher();
    manager?.removeAllListeners();
    dbCleanup();
    dirs.cleanup();
  });

  // ---- 3a: Install skill ----

  describe('install skill', () => {
    it('deploys files to disk and does not trigger watcher events', async () => {
      const { skill } = setupSkillInDb(repo, dirs.sourceDir);

      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir);
      manager.on('skill-event', (e: SkillEvent) => events.push(e));
      manager.startWatcher();

      // Small delay to let fs.watch initialise
      await sleep(50);

      // Install
      const installation = await manager.install({ skillId: skill.id });

      // Assert: files exist on disk
      const deployDir = path.join(dirs.skillsDir, SKILL_SLUG);
      expect(fs.existsSync(path.join(deployDir, 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(deployDir, 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(deployDir, 'config.json'))).toBe(true);

      // Assert: DB installation status
      expect(installation.status).toBe('active');
      const dbInst = repo.getInstallationById(installation.id);
      expect(dbInst?.status).toBe('active');

      // Assert: expected events were emitted (in order)
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('install:started');
      expect(eventTypes).toContain('deploy:started');
      expect(eventTypes).toContain('deploy:completed');
      expect(eventTypes).toContain('install:completed');

      // Wait for any fs.watch debounce to settle
      await sleep(SETTLE_MS);

      // Assert: NO watcher events
      const watcherEvents = events.filter(
        (e) => e.type === 'watcher:skill-detected' || e.type === 'watcher:integrity-violation',
      );
      expect(watcherEvents).toHaveLength(0);
    });
  });

  // ---- 3b: Uninstall skill ----

  describe('uninstall skill', () => {
    it('removes files from disk and does not trigger watcher events', async () => {
      const { skill } = setupSkillInDb(repo, dirs.sourceDir);

      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir);
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Install first (without watcher to avoid timing issues during setup)
      const installation = await manager.install({ skillId: skill.id });
      const deployDir = path.join(dirs.skillsDir, SKILL_SLUG);
      expect(fs.existsSync(deployDir)).toBe(true);

      // Clear events from install phase
      events.length = 0;

      // Now start watcher
      manager.startWatcher();
      await sleep(50);

      // Uninstall
      const result = await manager.uninstall(installation.id);
      expect(result).toBe(true);

      // Assert: files removed from disk
      expect(fs.existsSync(deployDir)).toBe(false);

      // Assert: DB installation deleted
      expect(repo.getInstallationById(installation.id)).toBeNull();

      // Assert: expected events
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('uninstall:started');
      expect(eventTypes).toContain('undeploy:started');
      expect(eventTypes).toContain('undeploy:completed');
      expect(eventTypes).toContain('uninstall:completed');

      // Assert: exactly ONE uninstall:completed (not doubled by watcher)
      expect(events.filter((e) => e.type === 'uninstall:completed')).toHaveLength(1);

      // Wait for any fs.watch debounce to settle
      await sleep(SETTLE_MS);

      // Assert: NO watcher events
      const watcherEvents = events.filter(
        (e) => e.type === 'watcher:skill-detected' || e.type === 'watcher:integrity-violation',
      );
      expect(watcherEvents).toHaveLength(0);
    });
  });

  // ---- 3c: Copy/paste untrusted skill ----

  describe('copy/paste untrusted skill', () => {
    it('deletes unknown skill directories dropped into skillsDir and registers in DB', async () => {
      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir);
      manager.on('skill-event', (e: SkillEvent) => events.push(e));
      manager.startWatcher();
      await sleep(50);

      // Manually drop a "rogue" skill directory
      const rogueDir = path.join(dirs.skillsDir, 'rogue-skill');
      fs.mkdirSync(rogueDir, { recursive: true });
      fs.writeFileSync(path.join(rogueDir, 'SKILL.md'), '# Rogue Skill');
      fs.writeFileSync(path.join(rogueDir, 'payload.sh'), 'echo pwned');

      // Wait for watcher:skill-detected
      const detected = await waitForEvent(manager, 'watcher:skill-detected', 5000);

      // Assert: event details
      const det = detected as Extract<SkillEvent, { type: 'watcher:skill-detected' }>;
      expect(det.slug).toBe('rogue-skill');
      expect(det.reason).toBe('Skill not in approved list');

      // Assert: rogue-skill removed from skillsDir (deleted directly, no quarantine copy)
      expect(fs.existsSync(rogueDir)).toBe(false);

      // Assert: rogue-skill NOT moved to quarantineDir (new behavior: delete, not quarantine)
      const quarantinedDir = path.join(dirs.quarantineDir, 'rogue-skill');
      expect(fs.existsSync(quarantinedDir)).toBe(false);

      // Assert: DB has skill record with source 'watcher'
      const skill = repo.getBySlug('rogue-skill');
      expect(skill).not.toBeNull();
      expect(skill!.source).toBe('watcher');

      // Assert: version with approval 'quarantined' (DB audit record)
      const versions = repo.getVersions(skill!.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].approval).toBe('quarantined');
    });
  });

  // ---- 3d: Modify installed skill (integrity violation) ----

  describe('modify installed skill', () => {
    it('detects integrity violation and reinstalls (default policy)', async () => {
      const { skill } = setupSkillInDb(repo, dirs.sourceDir);

      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir);
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Install without watcher
      const installation = await manager.install({ skillId: skill.id });
      events.length = 0;

      // Wait for install's unsuppressSlug timeout to clear (DEBOUNCE_MS * 2)
      await sleep(DEBOUNCE_MS * 3);

      // Start watcher
      manager.startWatcher();
      await sleep(100);

      // Tamper with a file
      const deployedSkillMd = path.join(dirs.skillsDir, SKILL_SLUG, 'SKILL.md');
      expect(fs.existsSync(deployedSkillMd)).toBe(true);
      fs.writeFileSync(deployedSkillMd, '# TAMPERED CONTENT');

      // Wait for reinstalled event (default policy is now reinstall)
      await waitForEvent(manager, 'watcher:reinstalled', 5000);

      // Assert: integrity-violation was also emitted
      const viol = events.find((e) => e.type === 'watcher:integrity-violation') as
        Extract<SkillEvent, { type: 'watcher:integrity-violation' }> | undefined;
      expect(viol).toBeDefined();
      expect(viol!.installationId).toBe(installation.id);
      expect(viol!.modifiedFiles).toContain('SKILL.md');
      expect(viol!.action).toBe('reinstall');

      // Assert: DB installation status remains active (reinstalled, not quarantined)
      const dbInst = repo.getInstallationById(installation.id);
      expect(dbInst?.status).toBe('active');
    }, 15_000);

    it('detects integrity violation and reinstalls (reinstall policy)', async () => {
      const { skill } = setupSkillInDb(repo, dirs.sourceDir);

      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir, {
        defaultPolicy: { onModified: 'reinstall', onDeleted: 'reinstall' },
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Install without watcher
      await manager.install({ skillId: skill.id });
      events.length = 0;

      // Wait for install's unsuppressSlug timeout to clear
      await sleep(DEBOUNCE_MS * 3);

      // Start watcher
      manager.startWatcher();
      await sleep(100);

      // Tamper with a file
      const deployedSkillMd = path.join(dirs.skillsDir, SKILL_SLUG, 'SKILL.md');
      fs.writeFileSync(deployedSkillMd, '# TAMPERED CONTENT');

      // Wait for integrity-violation event
      const violation = await waitForEvent(manager, 'watcher:integrity-violation', 5000);
      const viol = violation as Extract<SkillEvent, { type: 'watcher:integrity-violation' }>;
      expect(viol.action).toBe('reinstall');

      // Wait for reinstalled event
      await waitForEvent(manager, 'watcher:reinstalled', 3000);

      // Wait for fs to settle after reinstall
      await sleep(SETTLE_MS);

      // Assert: file restored to original content
      const content = fs.readFileSync(deployedSkillMd, 'utf-8');
      expect(content).toBe(SKILL_FILES['SKILL.md']);
    }, 15_000);
  });

  // ---- 3e: Delete file from installed skill ----

  describe('delete file from installed skill', () => {
    it('detects integrity violation and reinstalls deleted file', async () => {
      const { skill } = setupSkillInDb(repo, dirs.sourceDir);

      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir, {
        defaultPolicy: { onModified: 'quarantine', onDeleted: 'reinstall' },
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Install without watcher
      await manager.install({ skillId: skill.id });
      events.length = 0;

      // Wait for install's unsuppressSlug timeout to clear
      await sleep(DEBOUNCE_MS * 3);

      // Start watcher
      manager.startWatcher();
      await sleep(100);

      // Delete a file
      const deployedConfig = path.join(dirs.skillsDir, SKILL_SLUG, 'config.json');
      expect(fs.existsSync(deployedConfig)).toBe(true);
      fs.unlinkSync(deployedConfig);

      // Wait for integrity-violation event
      const violation = await waitForEvent(manager, 'watcher:integrity-violation', 5000);
      const viol = violation as Extract<SkillEvent, { type: 'watcher:integrity-violation' }>;
      expect(viol.missingFiles).toContain('config.json');

      // With onDeleted: 'reinstall', the watcher should reinstall
      await waitForEvent(manager, 'watcher:reinstalled', 3000);

      // Wait for fs to settle
      await sleep(SETTLE_MS);

      // Assert: file restored on disk with correct content
      expect(fs.existsSync(deployedConfig)).toBe(true);
      const content = fs.readFileSync(deployedConfig, 'utf-8');
      expect(content).toBe(SKILL_FILES['config.json']);
    }, 15_000);
  });

  // ---- 3d-relative: fs.watch with relative skillsDir ----

  describe('fs.watch with relative paths', () => {
    let relBase: string;
    let relSkillsDir: string;
    let relQuarantineDir: string;
    let relSourceDir: string;
    let relCleanup: () => void;

    beforeEach(() => {
      // Create dirs under CWD so we can use a relative path
      relBase = fs.mkdtempSync(path.join(process.cwd(), 'tmp-rel-test-'));
      relSkillsDir = path.join(relBase, 'skills');
      relQuarantineDir = path.join(relBase, 'quarantine');
      relSourceDir = path.join(relBase, 'source');
      fs.mkdirSync(relSkillsDir, { recursive: true });
      fs.mkdirSync(relQuarantineDir, { recursive: true });
      fs.mkdirSync(relSourceDir, { recursive: true });
      relCleanup = () => {
        try { fs.rmSync(relBase, { recursive: true, force: true }); } catch { /* */ }
      };
    });

    afterEach(() => {
      relCleanup();
    });

    it('fs.watch detects file modification via relative skillsDir', async () => {
      // Compute RELATIVE path from CWD
      const relativeSkillsDir = path.relative(process.cwd(), relSkillsDir);
      const relativeQuarantineDir = path.relative(process.cwd(), relQuarantineDir);

      // Set up skill in DB using relative sourceDir
      const versionDir = seedSkillFiles(relSourceDir, SKILL_SLUG, SKILL_VERSION, SKILL_FILES);
      const skill = repo.create({ name: SKILL_SLUG, slug: SKILL_SLUG, author: 'tester', tags: ['test'], source: 'manual' });
      const ver = repo.addVersion({
        skillId: skill.id, version: SKILL_VERSION, folderPath: versionDir,
        contentHash: 'placeholder', hashUpdatedAt: new Date().toISOString(),
        approval: 'approved', trusted: false, analysisStatus: 'pending',
        requiredBins: [], requiredEnv: [], extractedCommands: [],
      });
      const fileEntries = Object.entries(SKILL_FILES).map(([name, content]) => ({
        relativePath: name, fileHash: hashContent(content), sizeBytes: Buffer.byteLength(content),
      }));
      repo.registerFiles({ versionId: ver.id, files: fileEntries });
      repo.recomputeContentHash(ver.id);

      // Create manager with RELATIVE skillsDir
      const fakeStorage = { skills: repo } as unknown as Storage;
      manager = new SkillManager(fakeStorage, {
        offlineMode: true,
        deployers: [new OpenClawDeployAdapter({ skillsDir: relativeSkillsDir, createWrappers: false })],
        watcher: {
          skillsDir: relativeSkillsDir,
          quarantineDir: relativeQuarantineDir,
          pollIntervalMs: 60_000,
          fsScanDebounceMs: DEBOUNCE_MS,
        },
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Install skill
      await manager.install({ skillId: skill.id });
      events.length = 0;

      await sleep(DEBOUNCE_MS * 3);

      // Start watcher (fs.watch should resolve relative path)
      manager.startWatcher();
      await sleep(100);

      // Tamper with a file — use RESOLVED path since the file is on disk
      const deployedSkillMd = path.resolve(relativeSkillsDir, SKILL_SLUG, 'SKILL.md');
      expect(fs.existsSync(deployedSkillMd)).toBe(true);
      fs.writeFileSync(deployedSkillMd, '# TAMPERED CONTENT');

      // Wait for reinstalled event (fs.watch should detect via resolved path)
      await waitForEvent(manager, 'watcher:reinstalled', 5000);

      // Assert: file restored to original content
      const content = fs.readFileSync(deployedSkillMd, 'utf-8');
      expect(content).toBe(SKILL_FILES['SKILL.md']);
    }, 15_000);

    it('fs.watch detects file deletion via relative skillsDir', async () => {
      const relativeSkillsDir = path.relative(process.cwd(), relSkillsDir);
      const relativeQuarantineDir = path.relative(process.cwd(), relQuarantineDir);

      const versionDir = seedSkillFiles(relSourceDir, SKILL_SLUG, SKILL_VERSION, SKILL_FILES);
      const skill = repo.create({ name: SKILL_SLUG, slug: SKILL_SLUG, author: 'tester', tags: ['test'], source: 'manual' });
      const ver = repo.addVersion({
        skillId: skill.id, version: SKILL_VERSION, folderPath: versionDir,
        contentHash: 'placeholder', hashUpdatedAt: new Date().toISOString(),
        approval: 'approved', trusted: false, analysisStatus: 'pending',
        requiredBins: [], requiredEnv: [], extractedCommands: [],
      });
      const fileEntries = Object.entries(SKILL_FILES).map(([name, content]) => ({
        relativePath: name, fileHash: hashContent(content), sizeBytes: Buffer.byteLength(content),
      }));
      repo.registerFiles({ versionId: ver.id, files: fileEntries });
      repo.recomputeContentHash(ver.id);

      const fakeStorage = { skills: repo } as unknown as Storage;
      manager = new SkillManager(fakeStorage, {
        offlineMode: true,
        deployers: [new OpenClawDeployAdapter({ skillsDir: relativeSkillsDir, createWrappers: false })],
        watcher: {
          skillsDir: relativeSkillsDir,
          quarantineDir: relativeQuarantineDir,
          pollIntervalMs: 60_000,
          fsScanDebounceMs: DEBOUNCE_MS,
          defaultPolicy: { onModified: 'reinstall', onDeleted: 'reinstall' },
        },
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      await manager.install({ skillId: skill.id });
      events.length = 0;

      await sleep(DEBOUNCE_MS * 3);

      manager.startWatcher();
      await sleep(100);

      // Delete a file
      const deployedConfig = path.resolve(relativeSkillsDir, SKILL_SLUG, 'config.json');
      expect(fs.existsSync(deployedConfig)).toBe(true);
      fs.unlinkSync(deployedConfig);

      await waitForEvent(manager, 'watcher:reinstalled', 5000);

      // Assert: file restored
      expect(fs.existsSync(deployedConfig)).toBe(true);
      const content = fs.readFileSync(deployedConfig, 'utf-8');
      expect(content).toBe(SKILL_FILES['config.json']);
    }, 15_000);

    it('watcher emits watcher:fs-change diagnostic event on file edit', async () => {
      const relativeSkillsDir = path.relative(process.cwd(), relSkillsDir);
      const relativeQuarantineDir = path.relative(process.cwd(), relQuarantineDir);

      const versionDir = seedSkillFiles(relSourceDir, SKILL_SLUG, SKILL_VERSION, SKILL_FILES);
      const skill = repo.create({ name: SKILL_SLUG, slug: SKILL_SLUG, author: 'tester', tags: ['test'], source: 'manual' });
      const ver = repo.addVersion({
        skillId: skill.id, version: SKILL_VERSION, folderPath: versionDir,
        contentHash: 'placeholder', hashUpdatedAt: new Date().toISOString(),
        approval: 'approved', trusted: false, analysisStatus: 'pending',
        requiredBins: [], requiredEnv: [], extractedCommands: [],
      });
      const fileEntries = Object.entries(SKILL_FILES).map(([name, content]) => ({
        relativePath: name, fileHash: hashContent(content), sizeBytes: Buffer.byteLength(content),
      }));
      repo.registerFiles({ versionId: ver.id, files: fileEntries });
      repo.recomputeContentHash(ver.id);

      const fakeStorage = { skills: repo } as unknown as Storage;
      manager = new SkillManager(fakeStorage, {
        offlineMode: true,
        deployers: [new OpenClawDeployAdapter({ skillsDir: relativeSkillsDir, createWrappers: false })],
        watcher: {
          skillsDir: relativeSkillsDir,
          quarantineDir: relativeQuarantineDir,
          pollIntervalMs: 60_000,
          fsScanDebounceMs: DEBOUNCE_MS,
        },
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      await manager.install({ skillId: skill.id });
      events.length = 0;

      await sleep(DEBOUNCE_MS * 3);

      manager.startWatcher();
      await sleep(100);

      // Tamper with a file
      const deployedSkillMd = path.resolve(relativeSkillsDir, SKILL_SLUG, 'SKILL.md');
      fs.writeFileSync(deployedSkillMd, '# TAMPERED CONTENT');

      // Wait for the diagnostic event
      const fsChangeEvent = await waitForEvent(manager, 'watcher:fs-change', 5000);
      const evt = fsChangeEvent as Extract<SkillEvent, { type: 'watcher:fs-change' }>;
      expect(evt.slug).toBe(SKILL_SLUG);

      // Also wait for reinstall to finish to avoid dangling operations
      await waitForEvent(manager, 'watcher:reinstalled', 5000);
    }, 15_000);
  });

  // ---- 3e-poll: Poll-based detection (no fs.watch timing) ----

  describe('poll-based detection', () => {
    it('poll() detects modified file and reinstalls', async () => {
      const { skill } = setupSkillInDb(repo, dirs.sourceDir);

      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir);
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Install without watcher
      const installation = await manager.install({ skillId: skill.id });
      events.length = 0;

      // Tamper with a file
      const deployedSkillMd = path.join(dirs.skillsDir, SKILL_SLUG, 'SKILL.md');
      fs.writeFileSync(deployedSkillMd, '# TAMPERED CONTENT');

      // Call poll() directly
      await manager.watcher.poll();

      // Assert: integrity-violation was emitted
      const viol = events.find((e) => e.type === 'watcher:integrity-violation') as
        Extract<SkillEvent, { type: 'watcher:integrity-violation' }> | undefined;
      expect(viol).toBeDefined();
      expect(viol!.installationId).toBe(installation.id);
      expect(viol!.modifiedFiles).toContain('SKILL.md');

      // Assert: reinstalled event
      expect(events.some((e) => e.type === 'watcher:reinstalled')).toBe(true);

      // Assert: file restored to original content
      const content = fs.readFileSync(deployedSkillMd, 'utf-8');
      expect(content).toBe(SKILL_FILES['SKILL.md']);
    });

    it('poll() detects deleted file and reinstalls', async () => {
      const { skill } = setupSkillInDb(repo, dirs.sourceDir);

      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir, {
        defaultPolicy: { onModified: 'reinstall', onDeleted: 'reinstall' },
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Install without watcher
      await manager.install({ skillId: skill.id });
      events.length = 0;

      // Delete a file
      const deployedConfig = path.join(dirs.skillsDir, SKILL_SLUG, 'config.json');
      expect(fs.existsSync(deployedConfig)).toBe(true);
      fs.unlinkSync(deployedConfig);

      // Call poll() directly
      await manager.watcher.poll();

      // Assert: integrity-violation was emitted with missingFiles
      const viol = events.find((e) => e.type === 'watcher:integrity-violation') as
        Extract<SkillEvent, { type: 'watcher:integrity-violation' }> | undefined;
      expect(viol).toBeDefined();
      expect(viol!.missingFiles).toContain('config.json');

      // Assert: reinstalled event
      expect(events.some((e) => e.type === 'watcher:reinstalled')).toBe(true);

      // Assert: file restored on disk
      expect(fs.existsSync(deployedConfig)).toBe(true);
      const content = fs.readFileSync(deployedConfig, 'utf-8');
      expect(content).toBe(SKILL_FILES['config.json']);
    });

    it('hidden files (.swp) do not cause false integrity violations', async () => {
      const { skill } = setupSkillInDb(repo, dirs.sourceDir);

      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir);
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Install without watcher
      await manager.install({ skillId: skill.id });
      events.length = 0;

      // Add a vim swapfile (hidden file)
      const swpFile = path.join(dirs.skillsDir, SKILL_SLUG, '.SKILL.md.swp');
      fs.writeFileSync(swpFile, 'vim swap data');

      // Call poll() directly
      await manager.watcher.poll();

      // Assert: poll completed with 0 violations
      const completed = events.find((e) => e.type === 'watcher:poll-completed') as
        Extract<SkillEvent, { type: 'watcher:poll-completed' }> | undefined;
      expect(completed).toBeDefined();
      expect(completed!.violationCount).toBe(0);

      // Assert: no violation event
      expect(events.some((e) => e.type === 'watcher:integrity-violation')).toBe(false);
    });

    it('after reinstall, all deployed files match original content', async () => {
      const { skill } = setupSkillInDb(repo, dirs.sourceDir);

      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir);
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Install without watcher
      await manager.install({ skillId: skill.id });
      events.length = 0;

      // Tamper with ALL files
      for (const [name] of Object.entries(SKILL_FILES)) {
        const filePath = path.join(dirs.skillsDir, SKILL_SLUG, name);
        fs.writeFileSync(filePath, `TAMPERED: ${name}`);
      }

      // Call poll() directly
      await manager.watcher.poll();

      // Assert: reinstalled event
      expect(events.some((e) => e.type === 'watcher:reinstalled')).toBe(true);

      // Assert: every file matches original content
      for (const [name, expectedContent] of Object.entries(SKILL_FILES)) {
        const filePath = path.join(dirs.skillsDir, SKILL_SLUG, name);
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe(expectedContent);
      }
    });
  });

  // ---- 3e-eventbus: Watcher event bridging to EventBus ----

  describe('watcher event bridging', () => {
    it('integrity violation emits skills:integrity_violation on EventBus with full details', async () => {
      const { EventBus } = await import('@agenshield/ipc');
      const bus = new EventBus();
      const busEvents: Array<{ type: string; payload: unknown }> = [];
      bus.on('skills:integrity_violation', (payload) => {
        busEvents.push({ type: 'skills:integrity_violation', payload });
      });

      const { skill } = setupSkillInDb(repo, dirs.sourceDir);
      const fakeStorage = { skills: repo } as unknown as Storage;
      manager = new SkillManager(fakeStorage, {
        offlineMode: true,
        deployers: [new OpenClawDeployAdapter({ skillsDir: dirs.skillsDir, createWrappers: false })],
        watcher: {
          skillsDir: dirs.skillsDir,
          quarantineDir: dirs.quarantineDir,
          pollIntervalMs: 60_000,
          fsScanDebounceMs: DEBOUNCE_MS,
        },
        eventBus: bus,
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      const installation = await manager.install({ skillId: skill.id });
      events.length = 0;

      // Tamper with a file
      const deployedSkillMd = path.join(dirs.skillsDir, SKILL_SLUG, 'SKILL.md');
      fs.writeFileSync(deployedSkillMd, '# TAMPERED CONTENT');

      await manager.watcher.poll();

      // Assert: EventBus received skills:integrity_violation with full details
      expect(busEvents).toHaveLength(1);
      const payload = busEvents[0].payload as Record<string, unknown>;
      expect(payload.name).toBe(installation.id);
      expect(payload.action).toBe('reinstall');
      expect(payload.modifiedFiles).toContain('SKILL.md');
      expect(payload.missingFiles).toEqual([]);
      expect(payload.unexpectedFiles).toEqual([]);
    });

    it('reinstall emits skills:integrity_restored on EventBus', async () => {
      const { EventBus } = await import('@agenshield/ipc');
      const bus = new EventBus();
      const restoredEvents: Array<{ type: string; payload: unknown }> = [];
      bus.on('skills:integrity_restored', (payload) => {
        restoredEvents.push({ type: 'skills:integrity_restored', payload });
      });

      const { skill } = setupSkillInDb(repo, dirs.sourceDir);
      const fakeStorage = { skills: repo } as unknown as Storage;
      manager = new SkillManager(fakeStorage, {
        offlineMode: true,
        deployers: [new OpenClawDeployAdapter({ skillsDir: dirs.skillsDir, createWrappers: false })],
        watcher: {
          skillsDir: dirs.skillsDir,
          quarantineDir: dirs.quarantineDir,
          pollIntervalMs: 60_000,
          fsScanDebounceMs: DEBOUNCE_MS,
        },
        eventBus: bus,
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      const installation = await manager.install({ skillId: skill.id });
      events.length = 0;

      // Tamper with a file
      const deployedSkillMd = path.join(dirs.skillsDir, SKILL_SLUG, 'SKILL.md');
      fs.writeFileSync(deployedSkillMd, '# TAMPERED CONTENT');

      await manager.watcher.poll();

      // Assert: EventBus received skills:integrity_restored with installationId
      expect(restoredEvents).toHaveLength(1);
      const payload = restoredEvents[0].payload as Record<string, unknown>;
      expect(payload.name).toBe(installation.id);
    });

    it('content removal triggers integrity violation and reinstall events on EventBus', async () => {
      const { EventBus } = await import('@agenshield/ipc');
      const bus = new EventBus();
      const allBusEvents: Array<{ type: string; payload: unknown }> = [];
      bus.on('skills:integrity_violation', (payload) => {
        allBusEvents.push({ type: 'skills:integrity_violation', payload });
      });
      bus.on('skills:integrity_restored', (payload) => {
        allBusEvents.push({ type: 'skills:integrity_restored', payload });
      });

      const { skill } = setupSkillInDb(repo, dirs.sourceDir);
      const fakeStorage = { skills: repo } as unknown as Storage;
      manager = new SkillManager(fakeStorage, {
        offlineMode: true,
        deployers: [new OpenClawDeployAdapter({ skillsDir: dirs.skillsDir, createWrappers: false })],
        watcher: {
          skillsDir: dirs.skillsDir,
          quarantineDir: dirs.quarantineDir,
          pollIntervalMs: 60_000,
          fsScanDebounceMs: DEBOUNCE_MS,
          defaultPolicy: { onModified: 'reinstall', onDeleted: 'reinstall' },
        },
        eventBus: bus,
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      await manager.install({ skillId: skill.id });
      events.length = 0;

      // Delete a file from the deployed skill
      const deployedConfig = path.join(dirs.skillsDir, SKILL_SLUG, 'config.json');
      fs.unlinkSync(deployedConfig);

      await manager.watcher.poll();

      // Assert: both violation and restored events emitted on EventBus
      const types = allBusEvents.map(e => e.type);
      expect(types).toContain('skills:integrity_violation');
      expect(types).toContain('skills:integrity_restored');

      // Verify violation has missing file details
      const violation = allBusEvents.find(e => e.type === 'skills:integrity_violation');
      const vPayload = violation!.payload as Record<string, unknown>;
      expect((vPayload.missingFiles as string[])).toContain('config.json');
    });
  });

  // ---- 3e-eventbus-slug: Watcher event bridging includes slug ----

  describe('watcher event bridging includes slug', () => {
    it('integrity violation EventBus payload includes slug (not UUID)', async () => {
      const { EventBus } = await import('@agenshield/ipc');
      const bus = new EventBus();
      const busEvents: Array<{ type: string; payload: unknown }> = [];
      bus.on('skills:integrity_violation', (payload) => {
        busEvents.push({ type: 'skills:integrity_violation', payload });
      });

      const fakeStorage = { skills: repo } as unknown as Storage;
      manager = new SkillManager(fakeStorage, {
        offlineMode: true,
        deployers: [new OpenClawDeployAdapter({ skillsDir: dirs.skillsDir, createWrappers: false })],
        watcher: {
          skillsDir: dirs.skillsDir,
          quarantineDir: dirs.quarantineDir,
          pollIntervalMs: 60_000,
          fsScanDebounceMs: DEBOUNCE_MS,
        },
        eventBus: bus,
        backupDir: dirs.backupDir,
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Upload + install
      const fileBuffers = Object.entries(SKILL_FILES).map(([name, content]) => ({
        relativePath: name,
        content: Buffer.from(content),
      }));
      const uploadResult = manager.uploadFiles({
        name: SKILL_SLUG,
        slug: SKILL_SLUG,
        version: SKILL_VERSION,
        author: 'tester',
        files: fileBuffers,
      });
      repo.approveVersion(uploadResult.version.id);
      await manager.install({ skillId: uploadResult.skill.id });
      events.length = 0;

      // Tamper with a file
      const deployedSkillMd = path.join(dirs.skillsDir, SKILL_SLUG, 'SKILL.md');
      fs.writeFileSync(deployedSkillMd, '# TAMPERED CONTENT');

      await manager.watcher.poll();

      // Assert: EventBus payload includes slug === 'test-skill', not a UUID
      expect(busEvents).toHaveLength(1);
      const payload = busEvents[0].payload as Record<string, unknown>;
      expect(payload.slug).toBe(SKILL_SLUG);
      // name is still the installationId (UUID) for backward compat
      expect(payload.name).not.toBe(SKILL_SLUG);
    });

    it('integrity restored EventBus payload includes slug (not UUID)', async () => {
      const { EventBus } = await import('@agenshield/ipc');
      const bus = new EventBus();
      const restoredEvents: Array<{ type: string; payload: unknown }> = [];
      bus.on('skills:integrity_restored', (payload) => {
        restoredEvents.push({ type: 'skills:integrity_restored', payload });
      });

      const fakeStorage = { skills: repo } as unknown as Storage;
      manager = new SkillManager(fakeStorage, {
        offlineMode: true,
        deployers: [new OpenClawDeployAdapter({ skillsDir: dirs.skillsDir, createWrappers: false })],
        watcher: {
          skillsDir: dirs.skillsDir,
          quarantineDir: dirs.quarantineDir,
          pollIntervalMs: 60_000,
          fsScanDebounceMs: DEBOUNCE_MS,
        },
        eventBus: bus,
        backupDir: dirs.backupDir,
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Upload + install
      const fileBuffers = Object.entries(SKILL_FILES).map(([name, content]) => ({
        relativePath: name,
        content: Buffer.from(content),
      }));
      const uploadResult = manager.uploadFiles({
        name: SKILL_SLUG,
        slug: SKILL_SLUG,
        version: SKILL_VERSION,
        author: 'tester',
        files: fileBuffers,
      });
      repo.approveVersion(uploadResult.version.id);
      await manager.install({ skillId: uploadResult.skill.id });
      events.length = 0;

      // Tamper with a file
      const deployedSkillMd = path.join(dirs.skillsDir, SKILL_SLUG, 'SKILL.md');
      fs.writeFileSync(deployedSkillMd, '# TAMPERED CONTENT');

      await manager.watcher.poll();

      // Assert: EventBus restored payload includes slug
      expect(restoredEvents).toHaveLength(1);
      const payload = restoredEvents[0].payload as Record<string, unknown>;
      expect(payload.slug).toBe(SKILL_SLUG);
    });
  });

  // ---- 3e-daemon-forwarding: Daemon event forwarding ----

  describe('daemon event forwarding', () => {
    it('watcher:integrity-violation skill-event includes installationId for daemon forwarding', async () => {
      const fakeStorage = { skills: repo } as unknown as Storage;
      manager = new SkillManager(fakeStorage, {
        offlineMode: true,
        deployers: [new OpenClawDeployAdapter({ skillsDir: dirs.skillsDir, createWrappers: false })],
        watcher: {
          skillsDir: dirs.skillsDir,
          quarantineDir: dirs.quarantineDir,
          pollIntervalMs: 60_000,
          fsScanDebounceMs: DEBOUNCE_MS,
        },
        backupDir: dirs.backupDir,
      });

      // Capture raw skill-event emissions (what server.ts would listen to)
      const rawEvents: SkillEvent[] = [];
      manager.on('skill-event', (e: SkillEvent) => rawEvents.push(e));

      // Upload + install
      const fileBuffers = Object.entries(SKILL_FILES).map(([name, content]) => ({
        relativePath: name,
        content: Buffer.from(content),
      }));
      const uploadResult = manager.uploadFiles({
        name: SKILL_SLUG,
        slug: SKILL_SLUG,
        version: SKILL_VERSION,
        author: 'tester',
        files: fileBuffers,
      });
      repo.approveVersion(uploadResult.version.id);
      const installation = await manager.install({ skillId: uploadResult.skill.id });
      rawEvents.length = 0;

      // Tamper with a file
      const deployedSkillMd = path.join(dirs.skillsDir, SKILL_SLUG, 'SKILL.md');
      fs.writeFileSync(deployedSkillMd, '# TAMPERED CONTENT');

      await manager.watcher.poll();

      // Assert: skill-event fired with watcher:integrity-violation
      const violation = rawEvents.find((e) => e.type === 'watcher:integrity-violation');
      expect(violation).toBeDefined();
      const viol = violation as Extract<SkillEvent, { type: 'watcher:integrity-violation' }>;
      expect(viol.installationId).toBe(installation.id);
    });

    it('watcher:reinstalled skill-event fires after integrity restore', async () => {
      const fakeStorage = { skills: repo } as unknown as Storage;
      manager = new SkillManager(fakeStorage, {
        offlineMode: true,
        deployers: [new OpenClawDeployAdapter({ skillsDir: dirs.skillsDir, createWrappers: false })],
        watcher: {
          skillsDir: dirs.skillsDir,
          quarantineDir: dirs.quarantineDir,
          pollIntervalMs: 60_000,
          fsScanDebounceMs: DEBOUNCE_MS,
        },
        backupDir: dirs.backupDir,
      });

      const rawEvents: SkillEvent[] = [];
      manager.on('skill-event', (e: SkillEvent) => rawEvents.push(e));

      // Upload + install
      const fileBuffers = Object.entries(SKILL_FILES).map(([name, content]) => ({
        relativePath: name,
        content: Buffer.from(content),
      }));
      const uploadResult = manager.uploadFiles({
        name: SKILL_SLUG,
        slug: SKILL_SLUG,
        version: SKILL_VERSION,
        author: 'tester',
        files: fileBuffers,
      });
      repo.approveVersion(uploadResult.version.id);
      await manager.install({ skillId: uploadResult.skill.id });
      rawEvents.length = 0;

      // Tamper with a file
      const deployedSkillMd = path.join(dirs.skillsDir, SKILL_SLUG, 'SKILL.md');
      fs.writeFileSync(deployedSkillMd, '# TAMPERED CONTENT');

      await manager.watcher.poll();

      // Assert: watcher:reinstalled event fires
      const reinstalled = rawEvents.find((e) => e.type === 'watcher:reinstalled');
      expect(reinstalled).toBeDefined();
    });
  });

  // ---- 3e-backup-md: SKILL.md content from backup ----

  describe('SKILL.md content from backup', () => {
    it('backup preserves original SKILL.md content after file tampering', async () => {
      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir, {
        backupDir: dirs.backupDir,
      });

      // Upload + install
      const fileBuffers = Object.entries(SKILL_FILES).map(([name, content]) => ({
        relativePath: name,
        content: Buffer.from(content),
      }));
      const uploadResult = manager.uploadFiles({
        name: SKILL_SLUG,
        slug: SKILL_SLUG,
        version: SKILL_VERSION,
        author: 'tester',
        files: fileBuffers,
      });
      repo.approveVersion(uploadResult.version.id);
      await manager.install({ skillId: uploadResult.skill.id });

      // Tamper SKILL.md on disk
      const deployedSkillMd = path.join(dirs.skillsDir, SKILL_SLUG, 'SKILL.md');
      fs.writeFileSync(deployedSkillMd, '# TAMPERED CONTENT');

      // Assert: backup still has original content
      const backupContent = manager.backup!.loadSkillMd(uploadResult.version.id);
      expect(backupContent).toBe(SKILL_FILES['SKILL.md']);
    });

    it('backup SKILL.md content survives reinstall cycle', async () => {
      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir, {
        backupDir: dirs.backupDir,
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Upload + install
      const fileBuffers = Object.entries(SKILL_FILES).map(([name, content]) => ({
        relativePath: name,
        content: Buffer.from(content),
      }));
      const uploadResult = manager.uploadFiles({
        name: SKILL_SLUG,
        slug: SKILL_SLUG,
        version: SKILL_VERSION,
        author: 'tester',
        files: fileBuffers,
      });
      repo.approveVersion(uploadResult.version.id);
      await manager.install({ skillId: uploadResult.skill.id });
      events.length = 0;

      // Tamper SKILL.md on disk
      const deployedSkillMd = path.join(dirs.skillsDir, SKILL_SLUG, 'SKILL.md');
      fs.writeFileSync(deployedSkillMd, '# TAMPERED CONTENT');

      // Trigger reinstall via poll
      await manager.watcher.poll();

      // Assert: backup still has original content after reinstall
      const backupContent = manager.backup!.loadSkillMd(uploadResult.version.id);
      expect(backupContent).toBe(SKILL_FILES['SKILL.md']);

      // Assert: deployed file matches original after reinstall
      const deployedContent = fs.readFileSync(deployedSkillMd, 'utf-8');
      expect(deployedContent).toBe(SKILL_FILES['SKILL.md']);
    });
  });

  // ---- 3f: Backup recovery ----

  describe('Backup recovery', () => {
    /** Upload + install with backup-enabled manager. Returns the upload result and installation. */
    async function uploadAndInstall(
      mgr: SkillManager,
      slug = SKILL_SLUG,
      version = SKILL_VERSION,
      files = SKILL_FILES,
    ) {
      const fileBuffers = Object.entries(files).map(([name, content]) => ({
        relativePath: name,
        content: Buffer.from(content),
      }));
      const uploadResult = mgr.uploadFiles({
        name: slug,
        slug,
        version,
        author: 'tester',
        files: fileBuffers,
      });
      // Approve the version so install succeeds
      repo.approveVersion(uploadResult.version.id);
      const installation = await mgr.install({ skillId: uploadResult.skill.id });
      return { ...uploadResult, installation };
    }

    it('restores modified file from backup when source is deleted', async () => {
      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir, {
        backupDir: dirs.backupDir,
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Upload + install with backup-enabled manager → files deployed + backup saved
      const { version } = await uploadAndInstall(manager);
      events.length = 0;

      // Wait for install's unsuppressSlug timeout to clear
      await sleep(DEBOUNCE_MS * 3);

      // Delete the source files (simulate source being gone)
      if (fs.existsSync(version.folderPath)) {
        fs.rmSync(version.folderPath, { recursive: true, force: true });
      }

      // Tamper with a deployed file
      const deployedSkillMd = path.join(dirs.skillsDir, SKILL_SLUG, 'SKILL.md');
      fs.writeFileSync(deployedSkillMd, '# TAMPERED CONTENT');

      // Start watcher → integrity violation → reinstall
      manager.startWatcher();
      await sleep(100);

      await waitForEvent(manager, 'watcher:reinstalled', 5000);
      await sleep(SETTLE_MS);

      // Assert: file restored from backup (not from source — source is gone)
      const content = fs.readFileSync(deployedSkillMd, 'utf-8');
      expect(content).toBe(SKILL_FILES['SKILL.md']);
    }, 15_000);

    it('restores deleted file from backup when source is deleted', async () => {
      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir, {
        defaultPolicy: { onModified: 'reinstall', onDeleted: 'reinstall' },
        backupDir: dirs.backupDir,
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Upload + install with backup-enabled manager
      const { version } = await uploadAndInstall(manager);
      events.length = 0;

      await sleep(DEBOUNCE_MS * 3);

      // Delete source files
      if (fs.existsSync(version.folderPath)) {
        fs.rmSync(version.folderPath, { recursive: true, force: true });
      }

      // Delete a deployed file
      const deployedConfig = path.join(dirs.skillsDir, SKILL_SLUG, 'config.json');
      fs.unlinkSync(deployedConfig);

      // Start watcher → integrity violation → reinstall
      manager.startWatcher();
      await sleep(100);

      await waitForEvent(manager, 'watcher:reinstalled', 5000);
      await sleep(SETTLE_MS);

      // Assert: file restored from backup
      expect(fs.existsSync(deployedConfig)).toBe(true);
      const content = fs.readFileSync(deployedConfig, 'utf-8');
      expect(content).toBe(SKILL_FILES['config.json']);
    }, 15_000);

    it('reinstall restores entire skill folder from backup when all files deleted', async () => {
      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir, {
        defaultPolicy: { onModified: 'reinstall', onDeleted: 'reinstall' },
        backupDir: dirs.backupDir,
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Upload + install with backup-enabled manager
      const { version } = await uploadAndInstall(manager);
      events.length = 0;

      await sleep(DEBOUNCE_MS * 3);

      // Delete source files
      if (fs.existsSync(version.folderPath)) {
        fs.rmSync(version.folderPath, { recursive: true, force: true });
      }

      // Delete ALL deployed files (rm the skill folder, recreate empty)
      const deployDir = path.join(dirs.skillsDir, SKILL_SLUG);
      fs.rmSync(deployDir, { recursive: true, force: true });
      fs.mkdirSync(deployDir, { recursive: true });

      // Start watcher → integrity violation → reinstall
      manager.startWatcher();
      await sleep(100);

      await waitForEvent(manager, 'watcher:reinstalled', 5000);
      await sleep(SETTLE_MS);

      // Assert: all files restored from backup with correct content
      for (const [name, expectedContent] of Object.entries(SKILL_FILES)) {
        const filePath = path.join(deployDir, name);
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe(expectedContent);
      }
    }, 15_000);

    it('reinstall uses backup content, not tampered disk content', async () => {
      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir, {
        backupDir: dirs.backupDir,
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // 1. Upload + install with backup enabled
      const fileBuffers = Object.entries(SKILL_FILES).map(([name, content]) => ({
        relativePath: name,
        content: Buffer.from(content),
      }));
      const uploadResult = manager.uploadFiles({
        name: SKILL_SLUG,
        slug: SKILL_SLUG,
        version: SKILL_VERSION,
        author: 'tester',
        files: fileBuffers,
      });
      repo.approveVersion(uploadResult.version.id);
      await manager.install({ skillId: uploadResult.skill.id });
      events.length = 0;

      // 2. Tamper SKILL.md on disk (deployed copy)
      const deployedSkillMd = path.join(dirs.skillsDir, SKILL_SLUG, 'SKILL.md');
      fs.writeFileSync(deployedSkillMd, '# HACKED CONTENT');

      // 3. Also tamper the SOURCE copy at version.folderPath
      //    (simulates worst case: both disk + source are compromised)
      const sourceSkillMd = path.join(uploadResult.version.folderPath, 'SKILL.md');
      if (fs.existsSync(sourceSkillMd)) {
        fs.writeFileSync(sourceSkillMd, '# HACKED SOURCE');
      }

      // 4. poll() → violation → reinstall
      await manager.watcher.poll();

      // Assert: integrity-violation was emitted
      const viol = events.find((e) => e.type === 'watcher:integrity-violation');
      expect(viol).toBeDefined();

      // Assert: reinstalled event was emitted
      expect(events.some((e) => e.type === 'watcher:reinstalled')).toBe(true);

      // 5. Assert: deployed SKILL.md matches ORIGINAL content (from backup)
      const deployedContent = fs.readFileSync(deployedSkillMd, 'utf-8');
      expect(deployedContent).toBe(SKILL_FILES['SKILL.md']);
      expect(deployedContent).not.toContain('HACKED');

      // 6. Assert: a second poll() reports 0 violations (clean state)
      events.length = 0;
      await manager.watcher.poll();
      const completed = events.find((e) => e.type === 'watcher:poll-completed') as
        Extract<SkillEvent, { type: 'watcher:poll-completed' }> | undefined;
      expect(completed).toBeDefined();
      expect(completed!.violationCount).toBe(0);
    }, 15_000);

    it('copy-paste skill saves backup for later approval', async () => {
      // Create backup-enabled manager with no installed skills
      manager = createManager(repo, dirs.skillsDir, dirs.quarantineDir, {
        backupDir: dirs.backupDir,
      });
      manager.on('skill-event', (e: SkillEvent) => events.push(e));
      manager.startWatcher();
      await sleep(50);

      // Drop a rogue skill folder into skillsDir
      const rogueDir = path.join(dirs.skillsDir, 'rogue-skill');
      fs.mkdirSync(rogueDir, { recursive: true });
      fs.writeFileSync(path.join(rogueDir, 'SKILL.md'), '# Rogue Skill');
      fs.writeFileSync(path.join(rogueDir, 'payload.sh'), 'echo pwned');

      // Wait for watcher:skill-detected
      await waitForEvent(manager, 'watcher:skill-detected', 5000);

      // Assert: rogue folder deleted from skillsDir (quarantined in DB)
      expect(fs.existsSync(rogueDir)).toBe(false);

      // Assert: backup has the files
      const skill = repo.getBySlug('rogue-skill');
      expect(skill).not.toBeNull();
      const versions = repo.getVersions(skill!.id);
      expect(versions).toHaveLength(1);

      expect(manager.backup!.hasBackup(versions[0].id)).toBe(true);
      const loaded = manager.backup!.loadFiles(versions[0].id);
      expect(loaded.size).toBe(2);
      expect(loaded.get('SKILL.md')!.toString()).toBe('# Rogue Skill');
      expect(loaded.get('payload.sh')!.toString()).toBe('echo pwned');
    }, 15_000);
  });
});
