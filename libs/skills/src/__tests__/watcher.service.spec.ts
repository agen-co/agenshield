/**
 * SkillWatcherService tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { InitialSchemaMigration } from '../../../storage/src/migrations/001-initial-schema';
import { SkillsManagerColumnsMigration } from '../../../storage/src/migrations/003-skills-manager-columns';
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

    it('quarantines on modified files with default policy', async () => {
      const adapter = createMockAdapter({ intact: false, modifiedFiles: ['index.ts'], missingFiles: [], unexpectedFiles: [] });
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter);

      const skill = repo.create(makeSkillInput());
      const version = repo.addVersion(makeVersionInput(skill.id));
      const inst = repo.install({ skillVersionId: version.id, status: 'active' });

      await watcher.poll();

      const violation = events.find((e) => e.type === 'watcher:integrity-violation');
      expect(violation).toBeDefined();
      expect((violation as Extract<SkillEvent, { type: 'watcher:integrity-violation' }>).action).toBe('quarantine');

      expect(events.some((e) => e.type === 'watcher:quarantined')).toBe(true);

      // Verify DB status updated
      const installations = repo.getInstallations();
      const updated = installations.find((i) => i.id === inst.id);
      expect(updated?.status).toBe('quarantined');
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
      expect(policy.onModified).toBe('quarantine');
      expect(policy.onDeleted).toBe('quarantine');
    });

    it('merges per-installation override with defaults', () => {
      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter);

      watcher.setInstallationPolicy('inst-1', { onModified: 'reinstall' });
      const policy = watcher.resolvePolicy('inst-1');
      expect(policy.onModified).toBe('reinstall');
      expect(policy.onDeleted).toBe('quarantine'); // default
    });
  });

  describe('setInstallationPolicy / removeInstallationPolicy', () => {
    it('adds and removes per-installation policies', () => {
      const adapter = createMockAdapter();
      const deployer = new DeployService(repo, [adapter], emitter);
      const watcher = new SkillWatcherService(repo, deployer, emitter);

      watcher.setInstallationPolicy('inst-1', { onModified: 'reinstall' });
      expect(watcher.resolvePolicy('inst-1').onModified).toBe('reinstall');

      watcher.removeInstallationPolicy('inst-1');
      expect(watcher.resolvePolicy('inst-1').onModified).toBe('quarantine'); // back to default
    });
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
});
