/**
 * SkillManager integration tests
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Storage } from '../../../storage/src/storage';
import { SkillManager } from '../manager';
import type { DeployAdapter } from '../deploy/types';
import type { SkillEvent } from '../events';

// Minimal mock to create Storage without full DB path setup
function createTestStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-mgr-test-'));
  const dbPath = path.join(dir, 'test.db');
  const storage = Storage.open(dbPath);
  return { storage, cleanup: () => { storage.close(); try { fs.rmSync(dir, { recursive: true }); } catch { /* */ } } };
}

describe('SkillManager', () => {
  let storage: Storage;
  let cleanup: () => void;

  beforeEach(() => {
    ({ storage, cleanup } = createTestStorage());
  });

  afterEach(() => cleanup());

  it('creates with offline mode', () => {
    const manager = new SkillManager(storage, { offlineMode: true });
    expect(manager.catalog).toBeDefined();
    expect(manager.installer).toBeDefined();
    expect(manager.analyzer).toBeDefined();
    expect(manager.uploader).toBeDefined();
    expect(manager.updater).toBeDefined();
  });

  it('full lifecycle: upload, search, install, analyze', async () => {
    const manager = new SkillManager(storage, { offlineMode: true });
    const events: SkillEvent[] = [];
    manager.on('skill-event', (e: SkillEvent) => events.push(e));

    // Upload
    const { skill, version } = manager.uploadFiles({
      name: 'My Skill',
      slug: 'my-skill',
      version: '1.0.0',
      author: 'test',
      files: [
        { relativePath: 'index.ts', content: Buffer.from('export default {}') },
        { relativePath: 'SKILL.md', content: Buffer.from('# My Skill') },
      ],
    });

    expect(skill.name).toBe('My Skill');
    expect(version.version).toBe('1.0.0');

    // Search
    const searchResults = await manager.search('My Skill');
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0].source).toBe('local');

    // Install
    const installation = await manager.install({ skillId: skill.id });
    expect(installation.status).toBe('active');
    expect(installation.autoUpdate).toBe(true);

    // List installed
    const installed = manager.listInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].slug).toBe('my-skill');

    // Analyze
    const analysis = await manager.analyze(version.id);
    expect(analysis.status).toBe('success');
    expect((analysis.data as Record<string, unknown>).hasManifest).toBe(true);

    // Get skill
    const found = manager.getSkill(skill.id);
    expect(found!.slug).toBe('my-skill');

    // Uninstall
    const uninstalled = await manager.uninstall(installation.id);
    expect(uninstalled).toBe(true);
    expect(manager.listInstalled()).toHaveLength(0);

    // Verify events
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('upload:started');
    expect(eventTypes).toContain('upload:completed');
    expect(eventTypes).toContain('install:completed');
    expect(eventTypes).toContain('analyze:completed');
    expect(eventTypes).toContain('uninstall:completed');
  });

  it('checkUpdates returns empty in offline mode', async () => {
    const manager = new SkillManager(storage, { offlineMode: true });
    const results = await manager.checkUpdates();
    expect(results).toEqual([]);
  });

  it('creates with deployers and watcher options', () => {
    const adapter: DeployAdapter = {
      id: 'test',
      displayName: 'Test',
      canDeploy: () => true,
      deploy: async () => ({ deployedPath: '/deployed', deployedHash: 'hash' }),
      undeploy: async () => {},
      checkIntegrity: async () => ({ intact: true, modifiedFiles: [], missingFiles: [], unexpectedFiles: [] }),
    };

    const manager = new SkillManager(storage, {
      offlineMode: true,
      deployers: [adapter],
      watcher: { pollIntervalMs: 5000 },
    });

    expect(manager.deployer).toBeDefined();
    expect(manager.watcher).toBeDefined();
    expect(manager.watcher.isRunning).toBe(false);
  });

  it('autoStartWatcher starts the watcher on construction', () => {
    jest.useFakeTimers();
    try {
      const manager = new SkillManager(storage, {
        offlineMode: true,
        autoStartWatcher: true,
      });

      expect(manager.watcher.isRunning).toBe(true);
      manager.stopWatcher();
    } finally {
      jest.useRealTimers();
    }
  });

  it('startWatcher/stopWatcher convenience methods', () => {
    jest.useFakeTimers();
    try {
      const manager = new SkillManager(storage, { offlineMode: true });

      expect(manager.watcher.isRunning).toBe(false);
      manager.startWatcher();
      expect(manager.watcher.isRunning).toBe(true);
      manager.stopWatcher();
      expect(manager.watcher.isRunning).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('creates backup service when backupDir is provided', () => {
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-backup-'));
    const manager = new SkillManager(storage, { offlineMode: true, backupDir });
    expect(manager.backup).not.toBeNull();
    try { fs.rmSync(backupDir, { recursive: true }); } catch { /* */ }
  });

  it('backup is null when backupDir omitted', () => {
    const manager = new SkillManager(storage, { offlineMode: true });
    expect(manager.backup).toBeNull();
  });

  it('deployer and watcher default to empty when no options', () => {
    const manager = new SkillManager(storage, { offlineMode: true });
    expect(manager.deployer).toBeDefined();
    expect(manager.deployer.findAdapter(undefined)).toBeNull(); // no adapters configured
    expect(manager.watcher).toBeDefined();
    expect(manager.watcher.isRunning).toBe(false);
  });
});
