/**
 * SyncService slug tests
 *
 * Verifies that SyncService.syncSource() uses raw slugs (no prefixing)
 * and that sourceOrigin is set based on the source adapter ID.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { SchemaMigration } from '../../../storage/src/migrations/001-schema';
import { SkillsRepository } from '../../../storage/src/repositories/skills/skills.repository';
import { SkillManager } from '../manager';
import { TestDeployAdapter } from './helpers/test-deploy-adapter';
import type { Storage } from '@agenshield/storage';
import type {
  SkillSourceAdapter,
  SkillDefinition,
  DiscoveredTool,
  RequiredBinary,
  AdapterInstructions,
  TargetPlatform,
  ToolQuery,
} from '@agenshield/ipc';

// ─── Helpers ────────────────────────────────────────────────

function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  new SchemaMigration().up(db);

  // Add source_origin column if not present (from migration 023)
  const columns = (db.prepare("PRAGMA table_info('skills')").all() as Array<{ name: string }>).map(c => c.name);
  if (!columns.includes('source_origin')) {
    db.exec("ALTER TABLE skills ADD COLUMN source_origin TEXT NOT NULL DEFAULT 'unknown'");
  }

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
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-dirs-'));
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

/** Create a mock SkillSourceAdapter that returns the given definitions */
function createMockSource(
  id: string,
  displayName: string,
  definitions: SkillDefinition[],
  opts?: { getSkillFilesCalls?: string[] },
): SkillSourceAdapter {
  return {
    id,
    displayName,
    trusted: true,
    async getTools(_query?: ToolQuery): Promise<DiscoveredTool[]> { return []; },
    async getSkillsFor(_target: TargetPlatform): Promise<SkillDefinition[]> { return definitions; },
    async getBins(): Promise<RequiredBinary[]> { return []; },
    async getSkillFiles(skillId: string): Promise<SkillDefinition | null> {
      opts?.getSkillFilesCalls?.push(skillId);
      return definitions.find(d => d.skillId === skillId) ?? null;
    },
    async getInstructions(): Promise<AdapterInstructions[]> { return []; },
    async isAvailable(): Promise<boolean> { return true; },
  };
}

function makeSkillDefinition(overrides: Partial<SkillDefinition> & { skillId: string }): SkillDefinition {
  return {
    name: overrides.skillId,
    description: `Test skill ${overrides.skillId}`,
    version: '1.0.0',
    sha: 'test-sha-' + overrides.skillId,
    platform: 'openclaw',
    files: [
      { name: 'SKILL.md', content: `# ${overrides.skillId}\nA test skill.` },
    ],
    trusted: true,
    sourceId: 'test',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe('SyncService raw slugs (no prefixing)', () => {
  let db: Database.Database;
  let dbCleanup: () => void;
  let dirs: ReturnType<typeof createTestDirs>;
  let repo: SkillsRepository;
  let manager: SkillManager;

  beforeEach(() => {
    ({ db, cleanup: dbCleanup } = createTestDb());
    dirs = createTestDirs();
    repo = new SkillsRepository(db, () => null);
  });

  afterEach(() => {
    manager?.stopWatcher();
    manager?.removeAllListeners();
    dbCleanup();
    dirs.cleanup();
  });

  function createManager() {
    const fakeStorage = { skills: repo } as unknown as Storage;
    return new SkillManager(fakeStorage, {
      offlineMode: true,
      deployers: [new TestDeployAdapter({ skillsDir: dirs.skillsDir })],
      watcher: {
        skillsDir: dirs.skillsDir,
        quarantineDir: dirs.quarantineDir,
        pollIntervalMs: 60_000,
      },
      backupDir: dirs.backupDir,
    });
  }

  it('stores slug as raw name (no prefix) for registry source', async () => {
    manager = createManager();

    const def = makeSkillDefinition({ skillId: 'gog', sourceId: 'registry' });
    const source = createMockSource('registry', 'ClawHub', [def]);
    await manager.sync.registerSource(source);

    const result = await manager.syncSource('registry', 'openclaw');

    // Assert: result.installed includes the raw ID
    expect(result.installed).toContain('gog');

    // Assert: DB skill slug is 'gog' (raw, no prefix)
    const skill = repo.getBySlug('gog');
    expect(skill).not.toBeNull();
    expect(skill!.slug).toBe('gog');
  });

  it('stores slug as raw name (no prefix) for mcp source', async () => {
    manager = createManager();

    const def = makeSkillDefinition({ skillId: 'agenco', sourceId: 'mcp' });
    const source = createMockSource('mcp', 'AgentFront', [def]);
    await manager.sync.registerSource(source);

    const result = await manager.syncSource('mcp', 'openclaw');

    expect(result.installed).toContain('agenco');

    // Assert: DB slug is 'agenco' (raw, no 'ag-' prefix)
    const skill = repo.getBySlug('agenco');
    expect(skill).not.toBeNull();
    expect(skill!.slug).toBe('agenco');
  });

  it('getSkillFiles passes slug directly to adapter (no stripping needed)', async () => {
    manager = createManager();

    const getSkillFilesCalls: string[] = [];
    const def = makeSkillDefinition({ skillId: 'gog', sourceId: 'registry' });
    const source = createMockSource('registry', 'ClawHub', [def], { getSkillFilesCalls });
    await manager.sync.registerSource(source);

    // Call getSkillFiles with raw slug
    const result = await manager.sync.getSkillFiles('gog');

    // Assert: adapter.getSkillFiles was called with 'gog' directly
    expect(getSkillFilesCalls).toContain('gog');
    expect(result).not.toBeNull();
    expect(result!.skillId).toBe('gog');
  });
});

// ─── Source Management ───────────────────────────────────────

describe('SyncService.registerSource / unregisterSource', () => {
  let db: Database.Database;
  let dbCleanup: () => void;
  let dirs: ReturnType<typeof createTestDirs>;
  let repo: SkillsRepository;
  let manager: SkillManager;

  beforeEach(() => {
    ({ db, cleanup: dbCleanup } = createTestDb());
    dirs = createTestDirs();
    repo = new SkillsRepository(db, () => null);
  });

  afterEach(() => {
    manager?.stopWatcher();
    manager?.removeAllListeners();
    dbCleanup();
    dirs.cleanup();
  });

  function createManagerWithEvents(onEvent?: (event: any) => void) {
    const fakeStorage = { skills: repo } as unknown as Storage;
    return new SkillManager(fakeStorage, {
      offlineMode: true,
      deployers: [new TestDeployAdapter({ skillsDir: dirs.skillsDir })],
      watcher: {
        skillsDir: dirs.skillsDir,
        quarantineDir: dirs.quarantineDir,
        pollIntervalMs: 60_000,
      },
      backupDir: dirs.backupDir,
      syncOptions: onEvent ? { onEvent } : undefined,
    });
  }

  it('throws on duplicate registration', async () => {
    manager = createManagerWithEvents();
    const source = createMockSource('dup', 'Duplicate', []);
    await manager.sync.registerSource(source);

    await expect(manager.sync.registerSource(source)).rejects.toThrow(
      'Source adapter "dup" is already registered',
    );
  });

  it('calls initialize() on the source if present', async () => {
    manager = createManagerWithEvents();
    const initFn = jest.fn().mockResolvedValue(undefined);
    const source: SkillSourceAdapter = {
      ...createMockSource('init-src', 'Init Source', []),
      initialize: initFn,
    };

    await manager.sync.registerSource(source);
    expect(initFn).toHaveBeenCalledTimes(1);
  });

  it('emits source:registered event', async () => {
    const events: any[] = [];
    manager = createManagerWithEvents((e) => events.push(e));
    const source = createMockSource('ev-src', 'Events', []);

    await manager.sync.registerSource(source);
    expect(events).toContainEqual({ type: 'source:registered', sourceId: 'ev-src' });
  });

  it('unregisterSource calls dispose() and emits source:removed', async () => {
    const events: any[] = [];
    manager = createManagerWithEvents((e) => events.push(e));
    const disposeFn = jest.fn().mockResolvedValue(undefined);
    const source: SkillSourceAdapter = {
      ...createMockSource('rm-src', 'Removable', []),
      dispose: disposeFn,
    };

    await manager.sync.registerSource(source);
    await manager.sync.unregisterSource('rm-src');

    expect(disposeFn).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: 'source:removed', sourceId: 'rm-src' });
    expect(manager.sync.getSource('rm-src')).toBeUndefined();
  });

  it('unregisterSource is a no-op for unknown id', async () => {
    manager = createManagerWithEvents();
    // Should not throw
    await manager.sync.unregisterSource('nonexistent');
    expect(manager.sync.listSources()).toHaveLength(0);
  });
});

// ─── Aggregated Queries ──────────────────────────────────────

describe('SyncService aggregated queries', () => {
  let db: Database.Database;
  let dbCleanup: () => void;
  let dirs: ReturnType<typeof createTestDirs>;
  let repo: SkillsRepository;
  let manager: SkillManager;

  beforeEach(() => {
    ({ db, cleanup: dbCleanup } = createTestDb());
    dirs = createTestDirs();
    repo = new SkillsRepository(db, () => null);
  });

  afterEach(() => {
    manager?.stopWatcher();
    manager?.removeAllListeners();
    dbCleanup();
    dirs.cleanup();
  });

  function createManager() {
    const fakeStorage = { skills: repo } as unknown as Storage;
    return new SkillManager(fakeStorage, {
      offlineMode: true,
      deployers: [new TestDeployAdapter({ skillsDir: dirs.skillsDir })],
      watcher: {
        skillsDir: dirs.skillsDir,
        quarantineDir: dirs.quarantineDir,
        pollIntervalMs: 60_000,
      },
      backupDir: dirs.backupDir,
    });
  }

  // ─── discoverTools ──────────────────────────────────────────

  describe('discoverTools', () => {
    it('aggregates tools from multiple sources', async () => {
      manager = createManager();

      const srcA: SkillSourceAdapter = {
        ...createMockSource('a', 'A', []),
        async getTools() {
          return [{ id: 't1', name: 'Tool1', description: 'd1', sourceId: 'a' }];
        },
      };
      const srcB: SkillSourceAdapter = {
        ...createMockSource('b', 'B', []),
        async getTools() {
          return [{ id: 't2', name: 'Tool2', description: 'd2', sourceId: 'b' }];
        },
      };

      await manager.sync.registerSource(srcA);
      await manager.sync.registerSource(srcB);

      const tools = await manager.sync.discoverTools();
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.id)).toEqual(expect.arrayContaining(['t1', 't2']));
    });

    it('respects limit in query', async () => {
      manager = createManager();

      const src: SkillSourceAdapter = {
        ...createMockSource('big', 'Big', []),
        async getTools() {
          return [
            { id: 't1', name: 'T1', description: '', sourceId: 'big' },
            { id: 't2', name: 'T2', description: '', sourceId: 'big' },
            { id: 't3', name: 'T3', description: '', sourceId: 'big' },
          ];
        },
      };

      await manager.sync.registerSource(src);
      const tools = await manager.sync.discoverTools({ limit: 2 });
      expect(tools).toHaveLength(2);
    });

    it('skips unavailable source', async () => {
      manager = createManager();

      const src: SkillSourceAdapter = {
        ...createMockSource('off', 'Offline', []),
        async isAvailable() { return false; },
        async getTools() { return [{ id: 't1', name: 'T', description: '', sourceId: 'off' }]; },
      };

      await manager.sync.registerSource(src);
      const tools = await manager.sync.discoverTools();
      expect(tools).toHaveLength(0);
    });

    it('handles error in source gracefully (isAvailable throws)', async () => {
      manager = createManager();

      const src: SkillSourceAdapter = {
        ...createMockSource('err', 'Erroring', []),
        async isAvailable() { throw new Error('boom'); },
      };

      await manager.sync.registerSource(src);
      const tools = await manager.sync.discoverTools();
      expect(tools).toHaveLength(0);
    });
  });

  // ─── getSkillsFor ──────────────────────────────────────────

  describe('getSkillsFor', () => {
    it('aggregates skills from multiple sources', async () => {
      manager = createManager();

      const defA = makeSkillDefinition({ skillId: 'sk-a', sourceId: 'a' });
      const defB = makeSkillDefinition({ skillId: 'sk-b', sourceId: 'b' });
      const srcA = createMockSource('a', 'A', [defA]);
      const srcB = createMockSource('b', 'B', [defB]);

      await manager.sync.registerSource(srcA);
      await manager.sync.registerSource(srcB);

      const defs = await manager.sync.getSkillsFor('openclaw');
      expect(defs).toHaveLength(2);
      expect(defs.map(d => d.skillId)).toEqual(expect.arrayContaining(['sk-a', 'sk-b']));
    });

    it('skips unavailable source', async () => {
      manager = createManager();

      const src: SkillSourceAdapter = {
        ...createMockSource('off', 'Offline', [makeSkillDefinition({ skillId: 'x', sourceId: 'off' })]),
        async isAvailable() { return false; },
      };

      await manager.sync.registerSource(src);
      const defs = await manager.sync.getSkillsFor('openclaw');
      expect(defs).toHaveLength(0);
    });

    it('handles error in source gracefully (isAvailable throws)', async () => {
      manager = createManager();

      const src: SkillSourceAdapter = {
        ...createMockSource('err', 'Erroring', []),
        async isAvailable() { throw new Error('fail'); },
      };

      await manager.sync.registerSource(src);
      const defs = await manager.sync.getSkillsFor('openclaw');
      expect(defs).toHaveLength(0);
    });
  });

  // ─── getAllBins ─────────────────────────────────────────────

  describe('getAllBins', () => {
    it('deduplicates bins by name', async () => {
      manager = createManager();

      const bin = { name: 'agenco', installMethods: [], managedByShield: true };
      const srcA: SkillSourceAdapter = {
        ...createMockSource('a', 'A', []),
        async getBins() { return [bin]; },
      };
      const srcB: SkillSourceAdapter = {
        ...createMockSource('b', 'B', []),
        async getBins() { return [{ ...bin, managedByShield: false }]; },
      };

      await manager.sync.registerSource(srcA);
      await manager.sync.registerSource(srcB);

      const bins = await manager.sync.getAllBins();
      expect(bins).toHaveLength(1);
      // First registration wins
      expect(bins[0].managedByShield).toBe(true);
    });

    it('skips unavailable source', async () => {
      manager = createManager();

      const src: SkillSourceAdapter = {
        ...createMockSource('off', 'Offline', []),
        async isAvailable() { return false; },
        async getBins() { return [{ name: 'x', installMethods: [], managedByShield: true }]; },
      };

      await manager.sync.registerSource(src);
      const bins = await manager.sync.getAllBins();
      expect(bins).toHaveLength(0);
    });

    it('handles error in source gracefully (isAvailable throws)', async () => {
      manager = createManager();

      const src: SkillSourceAdapter = {
        ...createMockSource('err', 'Erroring', []),
        async isAvailable() { throw new Error('fail'); },
      };

      await manager.sync.registerSource(src);
      const bins = await manager.sync.getAllBins();
      expect(bins).toHaveLength(0);
    });
  });

  // ─── getInstructions ───────────────────────────────────────

  describe('getInstructions', () => {
    it('aggregates and sorts by priority', async () => {
      manager = createManager();

      const srcA: SkillSourceAdapter = {
        ...createMockSource('a', 'A', []),
        async getInstructions() {
          return [{ type: 'soul' as const, content: 'A-soul', mode: 'prepend' as const, priority: 50 }];
        },
      };
      const srcB: SkillSourceAdapter = {
        ...createMockSource('b', 'B', []),
        async getInstructions() {
          return [{ type: 'system' as const, content: 'B-sys', mode: 'append' as const, priority: 10 }];
        },
      };

      await manager.sync.registerSource(srcA);
      await manager.sync.registerSource(srcB);

      const instructions = await manager.sync.getInstructions();
      expect(instructions).toHaveLength(2);
      // priority 10 comes before priority 50
      expect(instructions[0].content).toBe('B-sys');
      expect(instructions[1].content).toBe('A-soul');
    });

    it('defaults priority to 100 for sorting', async () => {
      manager = createManager();

      const srcA: SkillSourceAdapter = {
        ...createMockSource('a', 'A', []),
        async getInstructions() {
          return [{ type: 'soul' as const, content: 'no-prio', mode: 'prepend' as const }];
        },
      };
      const srcB: SkillSourceAdapter = {
        ...createMockSource('b', 'B', []),
        async getInstructions() {
          return [{ type: 'system' as const, content: 'low-prio', mode: 'append' as const, priority: 50 }];
        },
      };

      await manager.sync.registerSource(srcA);
      await manager.sync.registerSource(srcB);

      const instructions = await manager.sync.getInstructions();
      // priority 50 < default 100
      expect(instructions[0].content).toBe('low-prio');
      expect(instructions[1].content).toBe('no-prio');
    });

    it('skips unavailable source', async () => {
      manager = createManager();

      const src: SkillSourceAdapter = {
        ...createMockSource('off', 'Offline', []),
        async isAvailable() { return false; },
        async getInstructions() {
          return [{ type: 'soul' as const, content: 'x', mode: 'prepend' as const }];
        },
      };

      await manager.sync.registerSource(src);
      const instructions = await manager.sync.getInstructions();
      expect(instructions).toHaveLength(0);
    });

    it('handles error in source gracefully (isAvailable throws)', async () => {
      manager = createManager();

      const src: SkillSourceAdapter = {
        ...createMockSource('err', 'Erroring', []),
        async isAvailable() { throw new Error('fail'); },
      };

      await manager.sync.registerSource(src);
      const instructions = await manager.sync.getInstructions();
      expect(instructions).toHaveLength(0);
    });
  });
});

// ─── Sync (update and removal paths) ────────────────────────

describe('SyncService.syncSource (update + removal)', () => {
  let db: Database.Database;
  let dbCleanup: () => void;
  let dirs: ReturnType<typeof createTestDirs>;
  let repo: SkillsRepository;
  let manager: SkillManager;

  beforeEach(() => {
    ({ db, cleanup: dbCleanup } = createTestDb());
    dirs = createTestDirs();
    repo = new SkillsRepository(db, () => null);
  });

  afterEach(() => {
    manager?.stopWatcher();
    manager?.removeAllListeners();
    dbCleanup();
    dirs.cleanup();
  });

  function createManagerWithEvents(onEvent?: (event: any) => void) {
    const fakeStorage = { skills: repo } as unknown as Storage;
    return new SkillManager(fakeStorage, {
      offlineMode: true,
      deployers: [new TestDeployAdapter({ skillsDir: dirs.skillsDir })],
      watcher: {
        skillsDir: dirs.skillsDir,
        quarantineDir: dirs.quarantineDir,
        pollIntervalMs: 60_000,
      },
      backupDir: dirs.backupDir,
      syncOptions: onEvent ? { onEvent } : undefined,
    });
  }

  it('updates a skill when SHA changes', async () => {
    const events: any[] = [];
    manager = createManagerWithEvents((e) => events.push(e));

    // Phase 1: initial install with sha-1
    const defV1 = makeSkillDefinition({
      skillId: 'updatable',
      sourceId: 'src',
      sha: 'sha-1',
    });
    let currentDefs = [defV1];
    const source: SkillSourceAdapter = {
      ...createMockSource('src', 'Source', []),
      async getSkillsFor() { return currentDefs; },
      async getSkillFiles(id: string) { return currentDefs.find(d => d.skillId === id) ?? null; },
    };

    await manager.sync.registerSource(source);
    const r1 = await manager.syncSource('src', 'openclaw');
    expect(r1.installed).toContain('updatable');
    expect(r1.updated).toHaveLength(0);

    // Phase 2: update with sha-2
    const defV2 = makeSkillDefinition({
      skillId: 'updatable',
      sourceId: 'src',
      sha: 'sha-2',
      version: '2.0.0',
    });
    currentDefs = [defV2];

    const r2 = await manager.syncSource('src', 'openclaw');
    expect(r2.updated).toContain('updatable');
    expect(r2.installed).toHaveLength(0);

    // Events should include skill:updated
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'skill:updated', skillId: 'updatable' }),
    );
  });

  it('removes orphaned skills no longer in source', async () => {
    const events: any[] = [];
    manager = createManagerWithEvents((e) => events.push(e));

    const defA = makeSkillDefinition({ skillId: 'keep', sourceId: 'src' });
    const defB = makeSkillDefinition({ skillId: 'remove-me', sourceId: 'src' });
    let currentDefs = [defA, defB];

    const source: SkillSourceAdapter = {
      ...createMockSource('src', 'Source', []),
      async getSkillsFor() { return currentDefs; },
      async getSkillFiles(id: string) { return currentDefs.find(d => d.skillId === id) ?? null; },
    };

    await manager.sync.registerSource(source);

    // Install both
    const r1 = await manager.syncSource('src', 'openclaw');
    expect(r1.installed).toEqual(expect.arrayContaining(['keep', 'remove-me']));

    // Now source only returns 'keep'
    currentDefs = [defA];
    const r2 = await manager.syncSource('src', 'openclaw');
    expect(r2.removed).toContain('remove-me');
    expect(r2.installed).toHaveLength(0);

    // Events should include skill:removed
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'skill:removed', skillId: 'remove-me' }),
    );

    // Verify 'remove-me' is gone from DB
    expect(repo.getBySlug('remove-me')).toBeNull();
  });

  it('returns error when source is not registered', async () => {
    manager = createManagerWithEvents();
    const result = await manager.syncSource('ghost', 'openclaw');
    expect(result.errors).toContainEqual(expect.stringContaining('not registered'));
    expect(result.installed).toHaveLength(0);
  });

  it('returns error when source.getSkillsFor throws', async () => {
    manager = createManagerWithEvents();

    const source: SkillSourceAdapter = {
      ...createMockSource('bad', 'Bad', []),
      async getSkillsFor() { throw new Error('network down'); },
    };

    await manager.sync.registerSource(source);
    const result = await manager.syncSource('bad', 'openclaw');
    expect(result.errors).toContainEqual(expect.stringContaining('network down'));
  });

  it('skips update when SHA matches', async () => {
    manager = createManagerWithEvents();

    // Compute the contentHash the same way UploadService does:
    // SHA-256 of sorted file hashes concatenated
    const fileContent = `# stable\nA test skill.`;
    const fileHash = crypto.createHash('sha256').update(Buffer.from(fileContent, 'utf-8')).digest('hex');
    const contentHash = crypto.createHash('sha256').update(fileHash).digest('hex');

    const def = makeSkillDefinition({ skillId: 'stable', sourceId: 'src', sha: contentHash });
    const source: SkillSourceAdapter = {
      ...createMockSource('src', 'Source', []),
      async getSkillsFor() { return [def]; },
      async getSkillFiles(id: string) { return id === 'stable' ? def : null; },
    };

    await manager.sync.registerSource(source);

    // First sync installs
    const r1 = await manager.syncSource('src', 'openclaw');
    expect(r1.installed).toContain('stable');

    // Second sync: SHA matches the contentHash, nothing happens
    const r2 = await manager.syncSource('src', 'openclaw');
    expect(r2.installed).toHaveLength(0);
    expect(r2.updated).toHaveLength(0);
    expect(r2.removed).toHaveLength(0);
  });

  it('emits sync-complete event after sync', async () => {
    const events: any[] = [];
    manager = createManagerWithEvents((e) => events.push(e));

    const source = createMockSource('src', 'Source', []);
    await manager.sync.registerSource(source);
    await manager.syncSource('src', 'openclaw');

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'skill:sync-complete', sourceId: 'src' }),
    );
  });
});

// ─── syncAll ─────────────────────────────────────────────────

describe('SyncService.syncAll', () => {
  let db: Database.Database;
  let dbCleanup: () => void;
  let dirs: ReturnType<typeof createTestDirs>;
  let repo: SkillsRepository;
  let manager: SkillManager;

  beforeEach(() => {
    ({ db, cleanup: dbCleanup } = createTestDb());
    dirs = createTestDirs();
    repo = new SkillsRepository(db, () => null);
  });

  afterEach(() => {
    manager?.stopWatcher();
    manager?.removeAllListeners();
    dbCleanup();
    dirs.cleanup();
  });

  function createManager() {
    const fakeStorage = { skills: repo } as unknown as Storage;
    return new SkillManager(fakeStorage, {
      offlineMode: true,
      deployers: [new TestDeployAdapter({ skillsDir: dirs.skillsDir })],
      watcher: {
        skillsDir: dirs.skillsDir,
        quarantineDir: dirs.quarantineDir,
        pollIntervalMs: 60_000,
      },
      backupDir: dirs.backupDir,
    });
  }

  it('calls syncSource for each registered source and combines results', async () => {
    manager = createManager();

    const defA = makeSkillDefinition({ skillId: 'from-a', sourceId: 'a' });
    const defB = makeSkillDefinition({ skillId: 'from-b', sourceId: 'b' });

    const srcA: SkillSourceAdapter = {
      ...createMockSource('a', 'A', [defA]),
      async getSkillsFor() { return [defA]; },
      async getSkillFiles(id: string) { return id === 'from-a' ? defA : null; },
    };
    const srcB: SkillSourceAdapter = {
      ...createMockSource('b', 'B', [defB]),
      async getSkillsFor() { return [defB]; },
      async getSkillFiles(id: string) { return id === 'from-b' ? defB : null; },
    };

    await manager.sync.registerSource(srcA);
    await manager.sync.registerSource(srcB);

    const result = await manager.sync.syncAll('openclaw');
    expect(result.installed).toEqual(expect.arrayContaining(['from-a', 'from-b']));
    expect(result.errors).toHaveLength(0);
  });
});

// ─── getSkillFiles fallback ──────────────────────────────────

describe('SyncService.getSkillFiles', () => {
  let db: Database.Database;
  let dbCleanup: () => void;
  let dirs: ReturnType<typeof createTestDirs>;
  let repo: SkillsRepository;
  let manager: SkillManager;

  beforeEach(() => {
    ({ db, cleanup: dbCleanup } = createTestDb());
    dirs = createTestDirs();
    repo = new SkillsRepository(db, () => null);
  });

  afterEach(() => {
    manager?.stopWatcher();
    manager?.removeAllListeners();
    dbCleanup();
    dirs.cleanup();
  });

  it('returns null when all sources throw', async () => {
    const fakeStorage = { skills: repo } as unknown as Storage;
    manager = new SkillManager(fakeStorage, {
      offlineMode: true,
      deployers: [new TestDeployAdapter({ skillsDir: dirs.skillsDir })],
      watcher: { skillsDir: dirs.skillsDir, pollIntervalMs: 60_000 },
      backupDir: dirs.backupDir,
    });

    const src: SkillSourceAdapter = {
      ...createMockSource('err', 'Erroring', []),
      async getSkillFiles() { throw new Error('fail'); },
    };

    await manager.sync.registerSource(src);
    const result = await manager.sync.getSkillFiles('nonexistent');
    expect(result).toBeNull();
  });
});

// ─── syncSource error paths ──────────────────────────────────

describe('SyncService.syncSource error paths', () => {
  let db: Database.Database;
  let dbCleanup: () => void;
  let dirs: ReturnType<typeof createTestDirs>;
  let repo: SkillsRepository;
  let manager: SkillManager;

  beforeEach(() => {
    ({ db, cleanup: dbCleanup } = createTestDb());
    dirs = createTestDirs();
    repo = new SkillsRepository(db, () => null);
  });

  afterEach(() => {
    manager?.stopWatcher();
    manager?.removeAllListeners();
    dbCleanup();
    dirs.cleanup();
  });

  function createManager() {
    const fakeStorage = { skills: repo } as unknown as Storage;
    return new SkillManager(fakeStorage, {
      offlineMode: true,
      deployers: [new TestDeployAdapter({ skillsDir: dirs.skillsDir })],
      watcher: { skillsDir: dirs.skillsDir, quarantineDir: dirs.quarantineDir, pollIntervalMs: 60_000 },
      backupDir: dirs.backupDir,
    });
  }

  it('records install error when uploadFiles throws', async () => {
    manager = createManager();

    // Source that returns a skill def but getSkillFiles returns null → approveSkill will throw
    const def = makeSkillDefinition({ skillId: 'fail-install', sourceId: 'src' });
    const source: SkillSourceAdapter = {
      ...createMockSource('src', 'Source', []),
      async getSkillsFor() { return [def]; },
      // Return null from getSkillFiles so uploadFiles can't find files → causes error in syncSource
      async getSkillFiles() { return null; },
    };

    await manager.sync.registerSource(source);

    // Mock uploadFiles to throw
    const original = manager.uploadFiles.bind(manager);
    manager.uploadFiles = () => { throw new Error('upload boom'); };

    const result = await manager.syncSource('src', 'openclaw');
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain('upload boom');

    manager.uploadFiles = original;
  });

  it('records update error when re-upload throws', async () => {
    manager = createManager();

    const defV1 = makeSkillDefinition({ skillId: 'fail-update', sourceId: 'src', sha: 'sha-1' });
    let currentDefs = [defV1];
    const source: SkillSourceAdapter = {
      ...createMockSource('src', 'Source', []),
      async getSkillsFor() { return currentDefs; },
      async getSkillFiles(id: string) { return currentDefs.find(d => d.skillId === id) ?? null; },
    };

    await manager.sync.registerSource(source);
    await manager.syncSource('src', 'openclaw');

    // Phase 2: change SHA and make uploadFiles throw
    const defV2 = makeSkillDefinition({ skillId: 'fail-update', sourceId: 'src', sha: 'sha-2', version: '2.0.0' });
    currentDefs = [defV2];

    const original = manager.uploadFiles.bind(manager);
    manager.uploadFiles = () => { throw new Error('update boom'); };

    const result = await manager.syncSource('src', 'openclaw');
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain('update boom');

    manager.uploadFiles = original;
  });

  it('records remove error when revokeSkill throws', async () => {
    manager = createManager();

    const def = makeSkillDefinition({ skillId: 'fail-remove', sourceId: 'src' });
    let currentDefs: SkillDefinition[] = [def];
    const source: SkillSourceAdapter = {
      ...createMockSource('src', 'Source', []),
      async getSkillsFor() { return currentDefs; },
      async getSkillFiles(id: string) { return currentDefs.find(d => d.skillId === id) ?? null; },
    };

    await manager.sync.registerSource(source);
    await manager.syncSource('src', 'openclaw');

    // Remove skill from source
    currentDefs = [];

    // Make revokeSkill throw
    const original = manager.revokeSkill.bind(manager);
    manager.revokeSkill = async () => { throw new Error('revoke boom'); };

    const result = await manager.syncSource('src', 'openclaw');
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain('revoke boom');

    manager.revokeSkill = original;
  });
});

// ─── Event emission error handling ──────────────────────────

describe('SyncService.emit error resilience', () => {
  let db: Database.Database;
  let dbCleanup: () => void;
  let dirs: ReturnType<typeof createTestDirs>;
  let repo: SkillsRepository;
  let manager: SkillManager;

  beforeEach(() => {
    ({ db, cleanup: dbCleanup } = createTestDb());
    dirs = createTestDirs();
    repo = new SkillsRepository(db, () => null);
  });

  afterEach(() => {
    manager?.stopWatcher();
    manager?.removeAllListeners();
    dbCleanup();
    dirs.cleanup();
  });

  it('does not crash when onEvent throws', async () => {
    const fakeStorage = { skills: repo } as unknown as Storage;
    manager = new SkillManager(fakeStorage, {
      offlineMode: true,
      deployers: [new TestDeployAdapter({ skillsDir: dirs.skillsDir })],
      watcher: {
        skillsDir: dirs.skillsDir,
        quarantineDir: dirs.quarantineDir,
        pollIntervalMs: 60_000,
      },
      backupDir: dirs.backupDir,
      syncOptions: {
        onEvent: () => { throw new Error('handler exploded'); },
      },
    });

    const source = createMockSource('src', 'Source', []);

    // registerSource emits source:registered — if emit doesn't catch, this will throw
    await expect(manager.sync.registerSource(source)).resolves.not.toThrow();
  });
});
