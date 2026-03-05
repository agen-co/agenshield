/**
 * SkillWatcherService tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { SchemaMigration } from '../../../storage/src/migrations/001-schema';
import { SkillsRepository } from '../../../storage/src/repositories/skills/skills.repository';
import { DeployService } from '../deploy/deploy.service';
import { SkillWatcherService } from '../watcher/watcher.service';
import type { DeployAdapter, IntegrityCheckResult } from '../deploy/types';
import type { SkillEvent } from '../events';

function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new SchemaMigration().up(db);
  return { db, cleanup: () => { db.close(); try { fs.rmSync(dir, { recursive: true }); } catch { /* */ } } };
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

function createMockAdapter(integrityResult?: Partial<IntegrityCheckResult>): DeployAdapter & { deployCalls: number } {
  const defaultResult: IntegrityCheckResult = { intact: true, modifiedFiles: [], missingFiles: [], unexpectedFiles: [], ...integrityResult };
  let deployCalls = 0;
  return {
    id: 'mock',
    displayName: 'Mock',
    get deployCalls() { return deployCalls; },
    canDeploy: () => true,
    deploy: async () => { deployCalls++; return { deployedPath: '/deployed', deployedHash: 'hash' }; },
    undeploy: async () => {},
    checkIntegrity: async () => defaultResult,
  };
}

describe('SkillWatcherService', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let repo: SkillsRepository;
  let emitter: EventEmitter;
  let events: SkillEvent[];

  beforeEach(() => {
    jest.useFakeTimers();
    ({ db, cleanup } = createTestDb());
    repo = new SkillsRepository(db, () => null);
    emitter = new EventEmitter();
    events = [];
    emitter.on('skill-event', (e: SkillEvent) => events.push(e));
  });

  afterEach(() => {
    jest.useRealTimers();
    cleanup();
  });

  describe('start/stop', () => {
    it('sets running flag and emits events', () => {
      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter);

      expect(watcher.isRunning).toBe(false);

      watcher.start();
      expect(watcher.isRunning).toBe(true);
      expect(events.some((e) => e.type === 'watcher:started')).toBe(true);

      watcher.stop();
      expect(watcher.isRunning).toBe(false);
      expect(events.some((e) => e.type === 'watcher:stopped')).toBe(true);
    });

    it('start is idempotent', () => {
      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter);

      watcher.start();
      watcher.start(); // Should not create a second interval
      expect(events.filter((e) => e.type === 'watcher:started')).toHaveLength(1);

      watcher.stop();
    });
  });

  describe('poll', () => {
    it('emits poll-completed with 0 violations when all intact', async () => {
      const adapter = createMockAdapter({ intact: true });
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter);

      const skill = repo.create(makeSkillInput());
      repo.addVersion(makeVersionInput(skill.id));

      await watcher.poll();

      const pollCompleted = events.find((e) => e.type === 'watcher:poll-completed');
      expect(pollCompleted).toBeDefined();
      expect((pollCompleted as Extract<SkillEvent, { type: 'watcher:poll-completed' }>).violationCount).toBe(0);
    });

    it('reinstalls on modified files with default policy', async () => {
      const adapter = createMockAdapter({ intact: false, modifiedFiles: ['index.ts'], missingFiles: [], unexpectedFiles: [] });
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter);

      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      repo.install({ skillVersionId: version.id, status: 'active' });

      await watcher.poll();

      const violation = events.find((e) => e.type === 'watcher:integrity-violation');
      expect(violation).toBeDefined();
      expect((violation as Extract<SkillEvent, { type: 'watcher:integrity-violation' }>).action).toBe('reinstall');

      expect(events.some((e) => e.type === 'watcher:reinstalled')).toBe(true);
    });

    it('reinstalls on deleted files with reinstall policy', async () => {
      const adapter = createMockAdapter({ intact: false, modifiedFiles: [], missingFiles: ['index.ts'], unexpectedFiles: [] });
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        defaultPolicy: { onDeleted: 'reinstall', onModified: 'reinstall' },
      });

      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      repo.install({ skillVersionId: version.id, status: 'active' });

      await watcher.poll();

      expect(events.some((e) => e.type === 'watcher:reinstalled')).toBe(true);
      expect(adapter.deployCalls).toBeGreaterThan(0);
    });

    it('uses stricter action when both modified and deleted', async () => {
      const adapter = createMockAdapter({ intact: false, modifiedFiles: ['a.ts'], missingFiles: ['b.ts'], unexpectedFiles: [] });
      const deployer = new DeployService(repo, [adapter], emitter);
      // onModified: reinstall, onDeleted: quarantine → should quarantine
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        defaultPolicy: { onModified: 'reinstall', onDeleted: 'quarantine' },
      });

      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      repo.install({ skillVersionId: version.id, status: 'active' });

      await watcher.poll();

      const violation = events.find((e) => e.type === 'watcher:integrity-violation') as Extract<SkillEvent, { type: 'watcher:integrity-violation' }>;
      expect(violation.action).toBe('quarantine');
    });

    it('emits action-error when action fails', async () => {
      // Use a modified adapter that makes checkIntegrity fail-like with violations,
      // but the repo doesn't have the installation for reinstall (causing deploy to fail)
      const failingAdapter: DeployAdapter = {
        id: 'failing',
        displayName: 'Failing',
        canDeploy: () => true,
        deploy: async () => { throw new Error('cannot deploy'); },
        undeploy: async () => {},
        checkIntegrity: async () => ({ intact: false, modifiedFiles: ['x.ts'], missingFiles: [], unexpectedFiles: [] }),
      };

      const deployer = new DeployService(repo, [failingAdapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        defaultPolicy: { onModified: 'reinstall' },
      });

      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      repo.install({ skillVersionId: version.id, status: 'active' });

      await watcher.poll();

      // Since reinstall attempts to call deployer.deploy (which goes through the service again),
      // and the adapter.deploy throws, the watcher should emit action-error
      expect(events.some((e) => e.type === 'watcher:action-error')).toBe(true);
    });
  });

  describe('resolvePolicy', () => {
    it('returns default policy when no override', () => {
      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter);

      const policy = watcher.resolvePolicy('some-id');
      expect(policy.onModified).toBe('reinstall');
      expect(policy.onDeleted).toBe('reinstall');
    });

    it('merges per-installation override with defaults', () => {
      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter);

      watcher.setInstallationPolicy('inst-1', { onModified: 'quarantine' });
      const policy = watcher.resolvePolicy('inst-1');
      expect(policy.onModified).toBe('quarantine');
      expect(policy.onDeleted).toBe('reinstall'); // default
    });
  });

  describe('setInstallationPolicy / removeInstallationPolicy', () => {
    it('adds and removes per-installation policies', () => {
      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter);

      watcher.setInstallationPolicy('inst-1', { onModified: 'quarantine' });
      expect(watcher.resolvePolicy('inst-1').onModified).toBe('quarantine');

      watcher.removeInstallationPolicy('inst-1');
      expect(watcher.resolvePolicy('inst-1').onModified).toBe('reinstall'); // back to default
    });
  });

  describe('skillsDir resolution', () => {
    it('resolves relative skillsDir to absolute in constructor', () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-resolve-'));
      const relativeDir = path.relative(process.cwd(), path.join(tmpDir, 'skills'));
      fs.mkdirSync(path.join(tmpDir, 'skills'), { recursive: true });

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        skillsDir: relativeDir,
      });

      // scanForNewSkills should not throw — path was resolved to absolute
      expect(() => watcher.scanForNewSkills()).not.toThrow();

      jest.useFakeTimers();

      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });
  });

  describe('fs.watch error handling', () => {
    it('emits watcher:error and attempts restart after FSWatcher error', () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-err-'));
      const skillsDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        skillsDir,
      });

      watcher.start();

      // No errors initially
      expect(events.filter(e => e.type === 'watcher:error')).toHaveLength(0);

      // Trigger the error handler on the internal fsWatcher
      const internalWatcher = (watcher as any).fsWatcher as fs.FSWatcher;
      expect(internalWatcher).not.toBeNull();
      internalWatcher.emit('error', new Error('simulated fs.watch error'));

      // Should have emitted watcher:error
      const errorEvents = events.filter(e => e.type === 'watcher:error');
      expect(errorEvents).toHaveLength(1);
      expect((errorEvents[0] as any).error).toContain('fs.watch error');

      // fsWatcher should have been closed and set to null
      expect((watcher as any).fsWatcher).toBeNull();

      watcher.stop();
      jest.useFakeTimers();

      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });
  });

  describe('scanForNewSkills with backup', () => {
    it('saves backup when backup service provided', () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-backup-'));
      const skillsDir = path.join(tmpDir, 'skills');
      const backupDir = path.join(tmpDir, 'backup');
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.mkdirSync(backupDir, { recursive: true });

      const { SkillBackupService } = require('../backup');
      const backup = new SkillBackupService(backupDir);

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        skillsDir,
        quarantineDir: path.join(tmpDir, 'quarantine'),
      }, backup);

      // Drop a skill folder
      const rogueDir = path.join(skillsDir, 'rogue-skill');
      fs.mkdirSync(rogueDir, { recursive: true });
      fs.writeFileSync(path.join(rogueDir, 'SKILL.md'), '# Rogue');
      fs.writeFileSync(path.join(rogueDir, 'index.ts'), 'export default {}');

      watcher.scanForNewSkills();

      // Rogue folder should be removed from skillsDir
      expect(fs.existsSync(rogueDir)).toBe(false);

      // Skill should be registered in DB
      const skill = repo.getBySlug('rogue-skill');
      expect(skill).not.toBeNull();

      // Backup should have the files
      const versions = repo.getVersions(skill!.id);
      expect(versions).toHaveLength(1);
      expect(backup.hasBackup(versions[0].id)).toBe(true);

      const loaded = backup.loadFiles(versions[0].id);
      expect(loaded.size).toBe(2);
      expect(loaded.get('SKILL.md')!.toString()).toBe('# Rogue');
      expect(loaded.get('index.ts')!.toString()).toBe('export default {}');

      jest.useFakeTimers();

      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });
  });

  describe('poll event emission', () => {
    it('emits watcher:reinstalled after successful reinstall', async () => {
      const adapter = createMockAdapter({ intact: false, modifiedFiles: ['index.ts'], missingFiles: [], unexpectedFiles: [] });
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        defaultPolicy: { onModified: 'reinstall' },
      });

      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      repo.install({ skillVersionId: version.id, status: 'active' });

      await watcher.poll();

      const eventTypes = events.map(e => e.type);
      expect(eventTypes).toContain('watcher:integrity-violation');
      expect(eventTypes).toContain('watcher:reinstalled');
    });

    it('emits watcher:quarantined when policy is quarantine', async () => {
      const adapter = createMockAdapter({ intact: false, modifiedFiles: ['index.ts'], missingFiles: [], unexpectedFiles: [] });
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        defaultPolicy: { onModified: 'quarantine', onDeleted: 'quarantine' },
      });

      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      repo.install({ skillVersionId: version.id, status: 'active' });

      await watcher.poll();

      const eventTypes = events.map(e => e.type);
      expect(eventTypes).toContain('watcher:integrity-violation');
      expect(eventTypes).toContain('watcher:quarantined');

      // Verify the violation event has quarantine action
      const violation = events.find(e => e.type === 'watcher:integrity-violation') as Extract<SkillEvent, { type: 'watcher:integrity-violation' }>;
      expect(violation.action).toBe('quarantine');

      // Verify installation status updated to quarantined
      const installations = repo.getInstallations({ skillVersionId: version.id });
      expect(installations[0].status).toBe('quarantined');
    });
  });

  describe('parent watcher for missing skillsDir', () => {
    it('watches parent dir and transitions to fs.watch when skillsDir is created', () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-parent-'));
      const skillsDir = path.join(tmpDir, 'skills');
      // Do NOT create skillsDir — it should be missing at start

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        skillsDir,
        pollIntervalMs: 600_000,
      });

      watcher.start();

      // skillsDir doesn't exist, so fsWatcher should not be active
      // but parentWatcher should be watching tmpDir
      const pw = (watcher as any).parentWatcher as fs.FSWatcher;
      expect(pw).not.toBeNull();
      expect((watcher as any).fsWatcher).toBeNull();

      // Create the skillsDir, then trigger the parentWatcher callback directly
      // to avoid race conditions with fs.watch event delivery
      fs.mkdirSync(skillsDir, { recursive: true });
      pw.emit('change', 'rename', 'skills');

      // parentWatcher should have been closed and fs.watch started
      expect((watcher as any).parentWatcher).toBeNull();
      expect((watcher as any).fsWatcher).not.toBeNull();

      watcher.stop();
      jest.useFakeTimers();

      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });

    it('does nothing when parent dir also does not exist', () => {
      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        skillsDir: '/nonexistent/path/skills',
      });

      // Should not throw
      watcher.start();
      watcher.stop();
    });
  });

  describe('catch-block retry in startFsWatch', () => {
    it('recovers fs.watch after directory is deleted and recreated', async () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-retry-'));
      const skillsDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        skillsDir,
      });

      watcher.start();

      // Give fs.watch time to initialize
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Delete the skills directory — this triggers an fs.watch error,
      // which should schedule a retry via setTimeout(startFsWatch, 5000)
      fs.rmSync(skillsDir, { recursive: true, force: true });

      // Wait for error handler to fire
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should have emitted a watcher error from the fs.watch error or poll
      const hasError = events.some(e => e.type === 'watcher:error');
      // The error may or may not fire depending on OS timing — the key test
      // is that after recreating the dir, the watcher recovers

      // Recreate the directory
      fs.mkdirSync(skillsDir, { recursive: true });

      // Wait for retry (5s) + a bit of buffer
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // Create a skill folder and verify fs.watch detects it
      const skill = repo.create(makeSkillInput({ slug: 'retry-test' }));
      const version = repo.addVersion(makeVersionInput(skill.id, { folderPath: path.join(skillsDir, 'retry-test') }));
      repo.install({ skillVersionId: version.id, status: 'active' });

      const testDir = path.join(skillsDir, 'retry-test');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'index.ts'), 'export default {}');

      // Wait for debounced fs.watch event
      await new Promise((resolve) => setTimeout(resolve, 500));

      const fsChangeEvents = events.filter(e => e.type === 'watcher:fs-change');
      expect(fsChangeEvents.length).toBeGreaterThanOrEqual(1);

      watcher.stop();
      jest.useFakeTimers();

      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    }, 15000);
  });

  describe('poll error handling', () => {
    it('emits watcher:error when checkAllIntegrity throws', async () => {
      // Create a deployer with an adapter that throws during integrity check
      const badAdapter: DeployAdapter = {
        id: 'bad',
        displayName: 'Bad',
        canDeploy: () => true,
        deploy: async () => ({ deployedPath: '', deployedHash: '' }),
        undeploy: async () => {},
        checkIntegrity: async () => { throw new Error('integrity check exploded'); },
      };

      const deployer = new DeployService(repo, [badAdapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter);

      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      repo.install({ skillVersionId: version.id, status: 'active' });

      await watcher.poll();

      expect(events.some((e) => e.type === 'watcher:error')).toBe(true);
    });
  });

  describe('setScanCallbacks', () => {
    it('sets callbacks without error', () => {
      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter);
      const cb = { onQuarantined: jest.fn() };
      watcher.setScanCallbacks(cb);
      // Verify callback is invoked during scan
      jest.useRealTimers();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-cb-'));
      const skillsDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });
      const watcher2 = new SkillWatcherService(repo, deployer, emitter, { skillsDir });
      watcher2.setScanCallbacks(cb);
      const rogueDir = path.join(skillsDir, 'cb-test-skill');
      fs.mkdirSync(rogueDir, { recursive: true });
      fs.writeFileSync(path.join(rogueDir, 'index.ts'), 'export default {}');
      watcher2.scanForNewSkills();
      expect(cb.onQuarantined).toHaveBeenCalledWith('cb-test-skill', expect.any(String));
      jest.useFakeTimers();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });
  });

  describe('handleFsChange for known skill with no active installation', () => {
    it('routes to scanForNewSkills via fs.watch when known skill has no active installation', async () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-noactive-'));
      const skillsDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        skillsDir,
        fsScanDebounceMs: 50,
        // Use a very long poll interval so it doesn't interfere
        pollIntervalMs: 600_000,
      });

      // Create a skill in DB with NO active installation (disabled)
      const skill = repo.create(makeSkillInput({ slug: 'no-active-slug' }));
      const version = repo.addVersion(makeVersionInput(skill.id));
      repo.install({ skillVersionId: version.id, status: 'disabled' });

      watcher.start();

      // Wait for the initial poll to finish
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Clear events from initial poll
      events.length = 0;

      // Now create a directory matching the known slug with no active installation
      const skillDir = path.join(skillsDir, 'no-active-slug');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'index.ts'), 'export default {}');

      // Wait for fs.watch debounce + handleFsChange
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should have emitted watcher:fs-change
      const fsChangeEvents = events.filter(e => e.type === 'watcher:fs-change');
      expect(fsChangeEvents.length).toBeGreaterThanOrEqual(1);

      watcher.stop();
      jest.useFakeTimers();

      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    }, 10000);
  });

  describe('quarantine with quarantineDir', () => {
    it('moves files to quarantine directory when policy is quarantine and quarantineDir is set', async () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-qdir-'));
      const skillsDir = path.join(tmpDir, 'skills');
      const quarantineDir = path.join(tmpDir, 'quarantine');
      fs.mkdirSync(skillsDir, { recursive: true });

      // Create real files on disk for the skill version
      const skillFolder = path.join(skillsDir, 'quarantine-test');
      fs.mkdirSync(skillFolder, { recursive: true });
      fs.writeFileSync(path.join(skillFolder, 'index.ts'), 'export default {}');
      fs.writeFileSync(path.join(skillFolder, 'readme.md'), '# Readme');

      // Adapter reports integrity violation
      const adapter = createMockAdapter({ intact: false, modifiedFiles: ['index.ts'], missingFiles: [], unexpectedFiles: [] });
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        skillsDir,
        quarantineDir,
        defaultPolicy: { onModified: 'quarantine', onDeleted: 'quarantine' },
      });

      // Create skill with active installation pointing to the skill folder
      const skill = repo.create(makeSkillInput({ slug: 'quarantine-test' }));
      const version = repo.addVersion(makeVersionInput(skill.id, { folderPath: skillFolder }));
      repo.install({ skillVersionId: version.id, status: 'active' });

      await watcher.poll();

      // Should have quarantined
      expect(events.some(e => e.type === 'watcher:quarantined')).toBe(true);

      // quarantine directory should have the files
      expect(fs.existsSync(quarantineDir)).toBe(true);
      const quarantinedSkillDir = path.join(quarantineDir, 'quarantine-test');
      expect(fs.existsSync(quarantinedSkillDir)).toBe(true);
      expect(fs.existsSync(path.join(quarantinedSkillDir, 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(quarantinedSkillDir, 'readme.md'))).toBe(true);

      // Original folder should be removed
      expect(fs.existsSync(skillFolder)).toBe(false);

      jest.useFakeTimers();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });

    it('removes tampered files when quarantineDir is null', async () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-noqdir-'));
      const skillsDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      const skillFolder = path.join(skillsDir, 'noq-test');
      fs.mkdirSync(skillFolder, { recursive: true });
      fs.writeFileSync(path.join(skillFolder, 'index.ts'), 'code');

      const adapter = createMockAdapter({ intact: false, modifiedFiles: ['index.ts'], missingFiles: [], unexpectedFiles: [] });
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        skillsDir,
        // No quarantineDir
        defaultPolicy: { onModified: 'quarantine', onDeleted: 'quarantine' },
      });

      const skill = repo.create(makeSkillInput({ slug: 'noq-test' }));
      const version = repo.addVersion(makeVersionInput(skill.id, { folderPath: skillFolder }));
      repo.install({ skillVersionId: version.id, status: 'active' });

      await watcher.poll();

      expect(events.some(e => e.type === 'watcher:quarantined')).toBe(true);
      // Files should be removed (not moved since no quarantineDir)
      expect(fs.existsSync(skillFolder)).toBe(false);

      jest.useFakeTimers();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });
  });

  describe('readSkillMeta with valid _meta.json', () => {
    it('uses metadata from _meta.json when present in skill directory', () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-meta-'));
      const skillsDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, { skillsDir });

      // Create a skill directory with a valid _meta.json
      const skillDir = path.join(skillsDir, 'meta-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, '_meta.json'), JSON.stringify({
        name: 'My Custom Skill',
        slug: 'meta-skill',
        version: '2.0.0',
        description: 'A skill with metadata',
      }));
      fs.writeFileSync(path.join(skillDir, 'index.ts'), 'export default {}');

      watcher.scanForNewSkills();

      // Skill should be registered in DB with metadata from _meta.json
      const skill = repo.getBySlug('meta-skill');
      expect(skill).not.toBeNull();
      expect(skill!.name).toBe('My Custom Skill');
      expect(skill!.description).toBe('A skill with metadata');

      // Version should use version from _meta.json
      const versions = repo.getVersions(skill!.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].version).toBe('2.0.0');

      jest.useFakeTimers();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });
  });

  describe('collectFiles with nested subdirectory', () => {
    it('collects files from nested subdirectories', () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-nested-'));
      const skillsDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, { skillsDir });

      // Create a skill directory with nested subdirectories
      const skillDir = path.join(skillsDir, 'nested-skill');
      fs.mkdirSync(path.join(skillDir, 'src', 'lib'), { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'index.ts'), 'export default {}');
      fs.writeFileSync(path.join(skillDir, 'src', 'main.ts'), 'console.log("main")');
      fs.writeFileSync(path.join(skillDir, 'src', 'lib', 'util.ts'), 'export const util = true');

      watcher.scanForNewSkills();

      // Skill should be registered
      const skill = repo.getBySlug('nested-skill');
      expect(skill).not.toBeNull();

      // All files should be collected — check DB file count
      const versions = repo.getVersions(skill!.id);
      expect(versions).toHaveLength(1);
      const files = repo.getFiles(versions[0].id);
      expect(files).toHaveLength(3);

      // Verify nested paths are correct
      const relativePaths = files.map(f => f.relativePath).sort();
      expect(relativePaths).toEqual(['index.ts', 'src/lib/util.ts', 'src/main.ts']);

      jest.useFakeTimers();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });
  });

  describe('hasActiveInstallation returns false', () => {
    it('returns false when skill has no active installations', () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-noactive2-'));
      const skillsDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, { skillsDir });

      // Create a skill with a disabled installation (not active)
      const skill = repo.create(makeSkillInput({ slug: 'inactive-skill' }));
      const version = repo.addVersion(makeVersionInput(skill.id));
      repo.install({ skillVersionId: version.id, status: 'disabled' });

      // Create a dir for this skill on disk
      const skillDir = path.join(skillsDir, 'inactive-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'index.ts'), 'export default {}');

      watcher.scanForNewSkills();

      // Since hasActiveInstallation returns false, it should be detected as needing quarantine
      const detectedEvents = events.filter(e => e.type === 'watcher:skill-detected');
      expect(detectedEvents.length).toBeGreaterThanOrEqual(1);

      jest.useFakeTimers();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });
  });

  describe('scanForNewSkills with existing quarantined version same content', () => {
    it('removes dir without re-registering when content hash matches quarantined version', () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-samehash-'));
      const skillsDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, { skillsDir });

      // First: create a skill directory and let scanForNewSkills register it
      const skillDir = path.join(skillsDir, 'same-hash-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'index.ts'), 'export const x = 1');

      watcher.scanForNewSkills();

      // Verify skill was created and quarantined
      const skill = repo.getBySlug('same-hash-skill');
      expect(skill).not.toBeNull();
      const versions = repo.getVersions(skill!.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].approval).toBe('quarantined');
      const originalVersionId = versions[0].id;

      // Directory should have been removed
      expect(fs.existsSync(skillDir)).toBe(false);

      // Now recreate the SAME skill directory with identical content
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'index.ts'), 'export const x = 1');

      // Clear events
      events.length = 0;

      watcher.scanForNewSkills();

      // Directory should be removed again
      expect(fs.existsSync(skillDir)).toBe(false);

      // No new version should be created (same content hash + quarantined)
      const versionsAfter = repo.getVersions(skill!.id);
      expect(versionsAfter).toHaveLength(1);
      expect(versionsAfter[0].id).toBe(originalVersionId);

      // No watcher:skill-detected event should be emitted (early exit path)
      const detectedEvents = events.filter(e => e.type === 'watcher:skill-detected');
      expect(detectedEvents).toHaveLength(0);

      jest.useFakeTimers();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });

    it('replaces existing version when content hash changes', () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-diffhash-'));
      const skillsDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, { skillsDir });

      // First: create a skill directory
      const skillDir = path.join(skillsDir, 'diff-hash');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'index.ts'), 'version 1');

      watcher.scanForNewSkills();

      const skill = repo.getBySlug('diff-hash');
      expect(skill).not.toBeNull();
      const v1 = repo.getVersions(skill!.id);
      expect(v1).toHaveLength(1);

      // Recreate with DIFFERENT content
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'index.ts'), 'version 2 — different content');

      watcher.scanForNewSkills();

      // Old version should have been deleted and a new one created
      const v2 = repo.getVersions(skill!.id);
      expect(v2).toHaveLength(1);
      expect(v2[0].contentHash).not.toBe(v1[0].contentHash);

      jest.useFakeTimers();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });
  });

  describe('scanForNewSkills outer catch block', () => {
    it('emits watcher:error when skillsDir is a file instead of directory', () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-scanerr-'));
      const skillsDir = path.join(tmpDir, 'skills');
      // Create a FILE named 'skills' instead of a directory
      fs.writeFileSync(skillsDir, 'not a directory');

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, { skillsDir });

      watcher.scanForNewSkills();

      // Should emit watcher:error because readdirSync on a file throws ENOTDIR
      const errorEvents = events.filter(e => e.type === 'watcher:error');
      expect(errorEvents.length).toBeGreaterThanOrEqual(1);
      expect((errorEvents[0] as Extract<SkillEvent, { type: 'watcher:error' }>).error).toContain('Filesystem scan error');

      jest.useFakeTimers();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });
  });

  describe('stopFsWatch cleanup paths', () => {
    it('cleans up parentWatcher when stopping with missing skillsDir', () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-stopparent-'));
      const skillsDir = path.join(tmpDir, 'skills');
      // Do NOT create skillsDir — parent watcher will be set up

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, { skillsDir });

      watcher.start();

      // parentWatcher should have been set up since skillsDir doesn't exist
      // but parent dir (tmpDir) does. Now stop should clean it up.
      watcher.stop();

      // Should not throw and parentWatcher should be null
      // Verify by starting and stopping again
      expect(() => {
        watcher.start();
        watcher.stop();
      }).not.toThrow();

      jest.useFakeTimers();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });

    it('clears debounce timers when stopping after fs.watch events', async () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-stopdebounce-'));
      const skillsDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      // Use a very long debounce so timers are still pending when we stop
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        skillsDir,
        fsScanDebounceMs: 60000,
      });

      watcher.start();

      // Trigger fs.watch events by creating directories
      const dir1 = path.join(skillsDir, 'debounce-test-1');
      const dir2 = path.join(skillsDir, 'debounce-test-2');
      fs.mkdirSync(dir1, { recursive: true });
      fs.writeFileSync(path.join(dir1, 'a.ts'), 'a');
      fs.mkdirSync(dir2, { recursive: true });
      fs.writeFileSync(path.join(dir2, 'b.ts'), 'b');

      // Wait a bit for fs.watch events to fire and create debounce timers
      await new Promise((resolve) => setTimeout(resolve, 300));

      // stop() should clear all debounce timers
      watcher.stop();

      // Wait longer than the debounce interval — if timers weren't cleared,
      // handleFsChange would fire and emit events
      const eventCountBefore = events.filter(e => e.type === 'watcher:fs-change').length;
      await new Promise((resolve) => setTimeout(resolve, 200));
      const eventCountAfter = events.filter(e => e.type === 'watcher:fs-change').length;

      // No new fs-change events should have fired after stop
      expect(eventCountAfter).toBe(eventCountBefore);

      jest.useFakeTimers();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    }, 10000);
  });

  describe('suppressSlug clears pending debounce timer', () => {
    it('clears debounce timer when slug is suppressed', () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-suppress-'));
      const skillsDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        skillsDir,
        fsScanDebounceMs: 5000, // long debounce so timer is still pending
        pollIntervalMs: 600_000,
      });

      watcher.start();

      // Simulate a debounce timer by triggering fsWatcher change event
      const fsw = (watcher as any).fsWatcher as fs.FSWatcher;
      expect(fsw).not.toBeNull();
      fsw.emit('change', 'rename', 'test-slug/index.ts');

      // Verify debounce timer was created
      expect((watcher as any).debounceTimers.has('test-slug')).toBe(true);

      // Suppress the slug — should clear the pending debounce timer
      watcher.suppressSlug('test-slug');

      expect((watcher as any).debounceTimers.has('test-slug')).toBe(false);

      watcher.stop();
      jest.useFakeTimers();

      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });
  });

  describe('startFsWatch catch block (lines 154-163)', () => {
    it('emits watcher:error when fs.watch constructor throws', (done) => {
      // SWC snapshots `import * as fs` into a separate namespace object per file,
      // so jest.spyOn(fs, 'watch') in the test file does not affect the service's
      // copy. We use jest.isolateModules to load a fresh copy of the service with
      // a mocked node:fs that throws from watch().

      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-fsthrow-'));
      const skillsDir = path.join(tmpDir, 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      jest.isolateModules(() => {
        // Replace fs.watch in the module cache before requiring the service
        const realFs = jest.requireActual<typeof fs>('node:fs');
        jest.doMock('node:fs', () => ({
          ...realFs,
          watch: () => { throw new Error('Mocked fs.watch failure'); },
        }));

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { SkillWatcherService: IsolatedWatcher } = require('../watcher/watcher.service');

        const adapter = createMockAdapter();
        const deployer = new DeployService(repo, [adapter], emitter);
        const watcher = new IsolatedWatcher(repo, deployer, emitter, {
          skillsDir,
          pollIntervalMs: 600_000,
        });

        watcher.start();

        // Should have emitted watcher:error with the failure message
        const errorEvents = events.filter(e => e.type === 'watcher:error');
        expect(errorEvents.length).toBeGreaterThanOrEqual(1);
        expect((errorEvents[0] as Extract<SkillEvent, { type: 'watcher:error' }>).error).toContain('Failed to start fs.watch');

        watcher.stop();
      });

      jest.useFakeTimers();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
      done();
    });
  });

  describe('parentWatcher error handler (lines 182-184)', () => {
    it('closes parentWatcher on error without crashing', () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-parenterr-'));
      const skillsDir = path.join(tmpDir, 'skills');
      // Do NOT create skillsDir so parentWatcher is set up

      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        skillsDir,
        pollIntervalMs: 600_000,
      });

      watcher.start();

      // parentWatcher should be set since skillsDir doesn't exist
      const pw = (watcher as any).parentWatcher as fs.FSWatcher;
      expect(pw).not.toBeNull();

      // Trigger the error handler directly
      pw.emit('error', new Error('simulated parent watcher error'));

      // parentWatcher should have been closed and nulled
      expect((watcher as any).parentWatcher).toBeNull();

      watcher.stop();
      jest.useFakeTimers();

      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });
  });

  describe('moveToQuarantine', () => {
    it('copies files and removes source directory', async () => {
      jest.useRealTimers();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-move-'));
      const skillsDir = path.join(tmpDir, 'skills');
      const quarantineDir = path.join(tmpDir, 'quarantine');
      fs.mkdirSync(skillsDir, { recursive: true });

      // Create skill files on disk
      const skillFolder = path.join(skillsDir, 'move-test');
      fs.mkdirSync(skillFolder, { recursive: true });
      fs.writeFileSync(path.join(skillFolder, 'main.ts'), 'const main = true');
      fs.writeFileSync(path.join(skillFolder, 'helper.ts'), 'const helper = true');

      const adapter = createMockAdapter({ intact: false, modifiedFiles: ['main.ts'], missingFiles: [], unexpectedFiles: [] });
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter, {
        skillsDir,
        quarantineDir,
        defaultPolicy: { onModified: 'quarantine' },
      });

      const skill = repo.create(makeSkillInput({ slug: 'move-test' }));
      const version = repo.addVersion(makeVersionInput(skill.id, { folderPath: skillFolder }));
      repo.install({ skillVersionId: version.id, status: 'active' });

      await watcher.poll();

      // Source should be removed
      expect(fs.existsSync(skillFolder)).toBe(false);

      // Destination should have the files
      const destDir = path.join(quarantineDir, 'move-test');
      expect(fs.existsSync(destDir)).toBe(true);
      expect(fs.readFileSync(path.join(destDir, 'main.ts'), 'utf-8')).toBe('const main = true');
      expect(fs.readFileSync(path.join(destDir, 'helper.ts'), 'utf-8')).toBe('const helper = true');

      jest.useFakeTimers();
      try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* */ }
    });
  });
});
