/**
 * SyncService source-prefixed slug tests
 *
 * Verifies that SyncService.syncSource() correctly prefixes slugs
 * based on the source adapter ID, and that getSkillFiles() strips
 * prefixes before delegating to adapters.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { InitialSchemaMigration } from '../../../storage/src/migrations/001-initial-schema';
import { SkillsManagerColumnsMigration } from '../../../storage/src/migrations/003-skills-manager-columns';
import { SkillsRepository } from '../../../storage/src/repositories/skills/skills.repository';
import { SkillManager } from '../manager';
import { OpenClawDeployAdapter } from '../deploy/adapters/openclaw.adapter';
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

describe('SyncService source-prefixed slugs', () => {
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
      deployers: [new OpenClawDeployAdapter({ skillsDir: dirs.skillsDir, createWrappers: false })],
      watcher: {
        skillsDir: dirs.skillsDir,
        quarantineDir: dirs.quarantineDir,
        pollIntervalMs: 60_000,
      },
      backupDir: dirs.backupDir,
    });
  }

  it('prefixes slug with source prefix (registry → cb-)', async () => {
    manager = createManager();

    const def = makeSkillDefinition({ skillId: 'gog', sourceId: 'registry' });
    const source = createMockSource('registry', 'ClawHub', [def]);
    await manager.sync.registerSource(source);

    const result = await manager.syncSource('registry', 'openclaw');

    // Assert: result.installed includes the raw ID
    expect(result.installed).toContain('gog');

    // Assert: DB skill slug is 'cb-gog' not 'gog'
    const skill = repo.getBySlug('cb-gog');
    expect(skill).not.toBeNull();
    expect(skill!.slug).toBe('cb-gog');

    // Assert: no skill with raw slug 'gog'
    const rawSkill = repo.getBySlug('gog');
    expect(rawSkill).toBeNull();
  });

  it('prefixes slug with source prefix (mcp → ag-)', async () => {
    manager = createManager();

    const def = makeSkillDefinition({ skillId: 'agenco', sourceId: 'mcp' });
    const source = createMockSource('mcp', 'AgentFront', [def]);
    await manager.sync.registerSource(source);

    const result = await manager.syncSource('mcp', 'openclaw');

    expect(result.installed).toContain('agenco');

    // Assert: DB slug is 'ag-agenco'
    const skill = repo.getBySlug('ag-agenco');
    expect(skill).not.toBeNull();
    expect(skill!.slug).toBe('ag-agenco');
  });

  it('does not double-prefix already-prefixed slugs', async () => {
    manager = createManager();

    // Source returns skillId that already has the 'ag-' prefix
    const def = makeSkillDefinition({ skillId: 'ag-agenco', sourceId: 'mcp' });
    const source = createMockSource('mcp', 'AgentFront', [def]);
    await manager.sync.registerSource(source);

    const result = await manager.syncSource('mcp', 'openclaw');

    expect(result.installed).toContain('ag-agenco');

    // Assert: slug remains 'ag-agenco' (idempotent, not 'ag-ag-agenco')
    const skill = repo.getBySlug('ag-agenco');
    expect(skill).not.toBeNull();

    // Assert: no double-prefixed slug exists
    const doublePrefix = repo.getBySlug('ag-ag-agenco');
    expect(doublePrefix).toBeNull();
  });

  it('getSkillFiles strips prefix before delegating to adapter', async () => {
    manager = createManager();

    const getSkillFilesCalls: string[] = [];
    const def = makeSkillDefinition({ skillId: 'gog', sourceId: 'registry' });
    const source = createMockSource('registry', 'ClawHub', [def], { getSkillFilesCalls });
    await manager.sync.registerSource(source);

    // Call getSkillFiles with prefixed slug
    const result = await manager.sync.getSkillFiles('cb-gog');

    // Assert: adapter.getSkillFiles was called with stripped 'gog' (not 'cb-gog')
    expect(getSkillFilesCalls).toContain('gog');
    expect(getSkillFilesCalls).not.toContain('cb-gog');
    expect(result).not.toBeNull();
    expect(result!.skillId).toBe('gog');
  });
});
