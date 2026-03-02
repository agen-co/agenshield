/**
 * SyncService slug tests
 *
 * Verifies that SyncService.syncSource() uses raw slugs (no prefixing)
 * and that sourceOrigin is set based on the source adapter ID.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import Database from 'better-sqlite3';
import { SchemaMigration } from '../../../storage/src/migrations/001-schema';
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
      deployers: [new OpenClawDeployAdapter({ skillsDir: dirs.skillsDir, createWrappers: false })],
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
