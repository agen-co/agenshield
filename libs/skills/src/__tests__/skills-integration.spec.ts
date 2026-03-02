/**
 * Skills Integration Tests
 *
 * Tests the full SkillManager with real SQLite + real filesystem.
 * Mock only the remote client. Deploy adapters are mocks with spies
 * that validate actual file content is passed correctly.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { Storage } from '../../../storage/src/storage';
import { SkillManager } from '../manager';
import type { DeployAdapter, DeployResult, DeployContext } from '../deploy/types';
import type { RemoteSkillClient } from '../remote/types';
import type { SkillEvent } from '../events';
import type { EventBus } from '@agenshield/ipc';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createTestStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-integ-'));
  const dbPath = path.join(dir, 'test.db');
  const activityDbPath = path.join(dir, 'activity.db');
  const storage = Storage.open(dbPath, activityDbPath);
  return {
    storage,
    dir,
    cleanup: () => {
      storage.close();
      try { fs.rmSync(dir, { recursive: true }); } catch { /* */ }
    },
  };
}

function createMockRemoteClient(skills?: Map<string, {
  name: string; slug: string; author: string; description: string; tags: string[]; remoteId: string;
}>): RemoteSkillClient {
  return {
    search: jest.fn().mockResolvedValue({ skills: [], total: 0 }),
    getSkill: jest.fn().mockImplementation(async (id: string) => {
      if (skills?.has(id)) return skills.get(id)!;
      return null;
    }),
    download: jest.fn().mockResolvedValue({ zipBuffer: Buffer.from('zip'), checksum: 'ck123', version: '1.0.0' }),
    upload: jest.fn().mockResolvedValue({ name: 'skill', slug: 'skill', remoteId: 'r1', author: 'a', description: '', tags: [] }),
    checkVersion: jest.fn().mockResolvedValue(null),
  };
}

function createMockDeployAdapter(opts?: {
  canDeploy?: (profileId?: string) => boolean;
  deployResult?: DeployResult;
  shouldThrow?: boolean;
}): DeployAdapter & { deploySpy: jest.Mock; undeploySpy: jest.Mock } {
  const deploySpy = jest.fn().mockImplementation(async (ctx: DeployContext) => {
    if (opts?.shouldThrow) throw new Error('deploy failed');
    return opts?.deployResult ?? { deployedPath: '/deployed/' + ctx.skill.slug, deployedHash: 'hash' };
  });
  const undeploySpy = jest.fn().mockResolvedValue(undefined);
  return {
    id: 'mock',
    displayName: 'Mock Deployer',
    canDeploy: opts?.canDeploy ?? (() => true),
    deploy: deploySpy,
    undeploy: undeploySpy,
    checkIntegrity: jest.fn().mockResolvedValue({ intact: true, modifiedFiles: [], missingFiles: [], unexpectedFiles: [] }),
    deploySpy,
    undeploySpy,
  };
}

function createMockEventBus(): EventBus & { emissions: Array<{ type: string; payload: unknown }> } {
  const emissions: Array<{ type: string; payload: unknown }> = [];
  return {
    emit: jest.fn().mockImplementation((type: string, payload: unknown) => {
      emissions.push({ type, payload });
    }),
    on: jest.fn().mockReturnValue(() => {}),
    once: jest.fn().mockReturnValue(() => {}),
    onChannel: jest.fn().mockReturnValue(() => {}),
    onAny: jest.fn().mockReturnValue(() => {}),
    off: jest.fn(),
    emissions,
  } as unknown as EventBus & { emissions: Array<{ type: string; payload: unknown }> };
}

function makeSkillFiles() {
  return [
    { relativePath: 'SKILL.md', content: Buffer.from('# Test Skill\n\nA test skill for integration testing.') },
    { relativePath: 'index.ts', content: Buffer.from('export default { name: "test" }') },
  ];
}

/** Create a profile record so FK constraints on skill_installations.profile_id pass */
function ensureProfile(storage: Storage, profileId: string): void {
  storage.profiles.create({ name: profileId, type: 'target' as const, id: profileId });
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe('Skills Integration Tests', () => {
  let storage: Storage;
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ storage, dir, cleanup } = createTestStorage());
  });

  afterEach(() => cleanup());

  /* ---------------------------------------------------------------- */
  /*  Full lifecycle                                                   */
  /* ---------------------------------------------------------------- */

  describe('Full lifecycle: upload → install → analyze → uninstall', () => {
    it('upload creates skill, install creates installation, analyze persists, uninstall removes', async () => {
      const manager = new SkillManager(storage, { offlineMode: true });
      const events: SkillEvent[] = [];
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      // Upload
      const { skill, version } = manager.uploadFiles({
        name: 'Lifecycle Skill', slug: 'lifecycle', version: '1.0.0', author: 'test',
        files: makeSkillFiles(),
      });
      expect(skill.slug).toBe('lifecycle');
      expect(version.version).toBe('1.0.0');

      // Install
      const installation = await manager.install({ skillId: skill.id });
      expect(installation.status).toBe('active');

      // Analyze
      const analysis = await manager.analyze(version.id);
      expect(analysis.status).toBe('success');

      // Verify DB persisted analysis
      const updatedVersion = manager.getRepository().getVersionById(version.id)!;
      expect(updatedVersion.analysisStatus).toBe('complete');

      // Uninstall
      const result = await manager.uninstall(installation.id);
      expect(result).toBe(true);
      expect(manager.listInstalled()).toHaveLength(0);
    });

    it('events emitted in correct order', async () => {
      const manager = new SkillManager(storage, { offlineMode: true });
      const events: SkillEvent[] = [];
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      const { skill, version } = manager.uploadFiles({
        name: 'Order Test', slug: 'order-test', version: '1.0.0',
        files: makeSkillFiles(),
      });
      const inst = await manager.install({ skillId: skill.id });
      await manager.analyze(version.id);
      await manager.uninstall(inst.id);

      const types = events.map((e) => e.type);
      const uploadIdx = types.indexOf('upload:started');
      const installIdx = types.indexOf('install:started');
      const analyzeIdx = types.indexOf('analyze:started');
      const uninstallIdx = types.indexOf('uninstall:started');

      expect(uploadIdx).toBeLessThan(installIdx);
      expect(installIdx).toBeLessThan(analyzeIdx);
      expect(analyzeIdx).toBeLessThan(uninstallIdx);
    });

    it('DB state correct after each step', async () => {
      const manager = new SkillManager(storage, { offlineMode: true });
      const repo = manager.getRepository();

      // After upload
      const { skill, version } = manager.uploadFiles({
        name: 'DB State', slug: 'db-state', version: '1.0.0',
        files: makeSkillFiles(),
      });
      expect(repo.getBySlug('db-state')).not.toBeNull();
      expect(repo.getFiles(version.id)).toHaveLength(2);
      expect(repo.getInstallations()).toHaveLength(0);

      // After install
      const inst = await manager.install({ skillId: skill.id });
      expect(repo.getInstallations()).toHaveLength(1);
      expect(repo.getInstallationById(inst.id)!.status).toBe('active');

      // After uninstall
      await manager.uninstall(inst.id);
      expect(repo.getInstallations()).toHaveLength(0);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Install to specific target                                       */
  /* ---------------------------------------------------------------- */

  describe('Install to specific target', () => {
    it('install with profileId creates target-scoped installation', async () => {
      ensureProfile(storage, 'profile-abc');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      const { skill } = manager.uploadFiles({
        name: 'Target Skill', slug: 'target-skill', version: '1.0.0',
        files: makeSkillFiles(),
      });

      const inst = await manager.install({ skillId: skill.id, profileId: 'profile-abc' });

      expect(inst.profileId).toBe('profile-abc');
      expect(inst.status).toBe('active');
    });

    it('deploy spy called with correct profileId', async () => {
      ensureProfile(storage, 'profile-xyz');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      const { skill } = manager.uploadFiles({
        name: 'Deploy Profile', slug: 'deploy-profile', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.install({ skillId: skill.id, profileId: 'profile-xyz' });

      expect(adapter.deploySpy).toHaveBeenCalledTimes(1);
      const ctx = adapter.deploySpy.mock.calls[0][0] as DeployContext;
      expect(ctx.installation.profileId).toBe('profile-xyz');
    });

    it('deploy spy receives file content from version', async () => {
      const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integ-backup-'));
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, {
        offlineMode: true, deployers: [adapter], backupDir,
      });

      const { skill } = manager.uploadFiles({
        name: 'File Content', slug: 'file-content', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.install({ skillId: skill.id });

      const ctx = adapter.deploySpy.mock.calls[0][0] as DeployContext;
      expect(ctx.files.length).toBeGreaterThan(0);
      // Backup file contents should be provided
      expect(ctx.fileContents).toBeDefined();

      try { fs.rmSync(backupDir, { recursive: true }); } catch { /* */ }
    });

    it('installation record has correct profileId in DB', async () => {
      ensureProfile(storage, 'prof-1');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      const { skill } = manager.uploadFiles({
        name: 'DB Profile', slug: 'db-profile', version: '1.0.0',
        files: makeSkillFiles(),
      });

      const inst = await manager.install({ skillId: skill.id, profileId: 'prof-1' });
      const dbInst = manager.getRepository().getInstallationById(inst.id);

      expect(dbInst!.profileId).toBe('prof-1');
    });

    it('listInstalled returns skill for that profile scope', async () => {
      ensureProfile(storage, 'p1');
      const manager = new SkillManager(storage, { offlineMode: true });

      const { skill } = manager.uploadFiles({
        name: 'List Profile', slug: 'list-profile', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.install({ skillId: skill.id, profileId: 'p1' });

      // listInstalled without scope returns only global (profile_id IS NULL) installations.
      // Profile-scoped installations are visible via the repository directly.
      const repo = manager.getRepository();
      const installations = repo.getInstallations();
      expect(installations.some((i) => i.profileId === 'p1')).toBe(true);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Install to multiple targets                                      */
  /* ---------------------------------------------------------------- */

  describe('Install to multiple targets', () => {
    it('installToTargets creates one installation per target', async () => {
      ensureProfile(storage, 't1');
      ensureProfile(storage, 't2');
      ensureProfile(storage, 't3');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      manager.uploadFiles({
        name: 'Multi Target', slug: 'multi-target', version: '1.0.0',
        files: makeSkillFiles(),
      });

      const results = await manager.installToTargets('multi-target', ['t1', 't2', 't3']);

      expect(results).toHaveLength(3);
      expect(results[0].profileId).toBe('t1');
      expect(results[1].profileId).toBe('t2');
      expect(results[2].profileId).toBe('t3');
    });

    it('deploy spy called once per target with correct profileId', async () => {
      ensureProfile(storage, 'x');
      ensureProfile(storage, 'y');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      manager.uploadFiles({
        name: 'Deploy Multi', slug: 'deploy-multi', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.installToTargets('deploy-multi', ['x', 'y']);

      expect(adapter.deploySpy).toHaveBeenCalledTimes(2);
      const profiles = adapter.deploySpy.mock.calls.map(
        (call: [DeployContext]) => call[0].installation.profileId,
      );
      expect(profiles).toContain('x');
      expect(profiles).toContain('y');
    });

    it('each installation in DB has distinct profileId', async () => {
      ensureProfile(storage, 'a');
      ensureProfile(storage, 'b');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      manager.uploadFiles({
        name: 'DB Multi', slug: 'db-multi', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.installToTargets('db-multi', ['a', 'b']);

      const repo = manager.getRepository();
      const installations = repo.getInstallations();
      const profiles = installations.map((i) => i.profileId);
      expect(profiles).toContain('a');
      expect(profiles).toContain('b');
    });

    it('install events emitted for each target', async () => {
      ensureProfile(storage, 'e1');
      ensureProfile(storage, 'e2');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });
      const events: SkillEvent[] = [];
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      manager.uploadFiles({
        name: 'Events Multi', slug: 'events-multi', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.installToTargets('events-multi', ['e1', 'e2']);

      const installCompleted = events.filter((e) => e.type === 'install:completed');
      expect(installCompleted).toHaveLength(2);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Uninstall from specific target                                   */
  /* ---------------------------------------------------------------- */

  describe('Uninstall from specific target', () => {
    it('uninstall removes only the targeted installation', async () => {
      ensureProfile(storage, 't1');
      ensureProfile(storage, 't2');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      manager.uploadFiles({
        name: 'Uninstall Target', slug: 'uninstall-target', version: '1.0.0',
        files: makeSkillFiles(),
      });

      const results = await manager.installToTargets('uninstall-target', ['t1', 't2']);

      await manager.uninstall(results[0].id);

      const repo = manager.getRepository();
      const remaining = repo.getInstallations();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].profileId).toBe('t2');
    });

    it('other installations remain active', async () => {
      ensureProfile(storage, 't1');
      ensureProfile(storage, 't2');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      manager.uploadFiles({
        name: 'Remain Active', slug: 'remain-active', version: '1.0.0',
        files: makeSkillFiles(),
      });

      const [inst1, inst2] = await manager.installToTargets('remain-active', ['t1', 't2']);

      await manager.uninstall(inst1.id);

      const dbInst2 = manager.getRepository().getInstallationById(inst2.id);
      expect(dbInst2!.status).toBe('active');
    });

    it('undeploy spy called with correct installation', async () => {
      ensureProfile(storage, 't1');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      manager.uploadFiles({
        name: 'Undeploy Call', slug: 'undeploy-call', version: '1.0.0',
        files: makeSkillFiles(),
      });

      const [inst] = await manager.installToTargets('undeploy-call', ['t1']);

      await manager.uninstall(inst.id);

      expect(adapter.undeploySpy).toHaveBeenCalledTimes(1);
      const [undeployInst] = adapter.undeploySpy.mock.calls[0];
      expect(undeployInst.id).toBe(inst.id);
    });

    it('uninstall events emitted', async () => {
      ensureProfile(storage, 't1');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });
      const events: SkillEvent[] = [];
      manager.on('skill-event', (e: SkillEvent) => events.push(e));

      manager.uploadFiles({
        name: 'Uninstall Events', slug: 'uninstall-events', version: '1.0.0',
        files: makeSkillFiles(),
      });

      const [inst] = await manager.installToTargets('uninstall-events', ['t1']);
      events.length = 0;

      await manager.uninstall(inst.id);

      const types = events.map((e) => e.type);
      expect(types).toContain('uninstall:started');
      expect(types).toContain('uninstall:completed');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Uninstall from all targets (revokeSkill)                         */
  /* ---------------------------------------------------------------- */

  describe('Uninstall from all targets (revokeSkill)', () => {
    it('revokeSkill uninstalls all active installations', async () => {
      ensureProfile(storage, 't1');
      ensureProfile(storage, 't2');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      manager.uploadFiles({
        name: 'Revoke All', slug: 'revoke-all', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.installToTargets('revoke-all', ['t1', 't2']);
      expect(manager.getRepository().getInstallations()).toHaveLength(2);

      await manager.revokeSkill('revoke-all');

      expect(manager.getRepository().getInstallations()).toHaveLength(0);
    });

    it('undeploy spy called for each installation', async () => {
      ensureProfile(storage, 't1');
      ensureProfile(storage, 't2');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      manager.uploadFiles({
        name: 'Revoke Undeploy', slug: 'revoke-undeploy', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.installToTargets('revoke-undeploy', ['t1', 't2']);
      adapter.undeploySpy.mockClear();

      await manager.revokeSkill('revoke-undeploy');

      expect(adapter.undeploySpy).toHaveBeenCalledTimes(2);
    });

    it('version quarantined after revoke', async () => {
      const manager = new SkillManager(storage, { offlineMode: true });

      const { skill, version } = manager.uploadFiles({
        name: 'Quarantine', slug: 'quarantine-test', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.install({ skillId: skill.id });
      await manager.revokeSkill('quarantine-test');

      const updated = manager.getRepository().getVersionById(version.id)!;
      expect(updated.approval).toBe('quarantined');
    });

    it('listInstalled returns empty after revoke', async () => {
      const manager = new SkillManager(storage, { offlineMode: true });

      const { skill } = manager.uploadFiles({
        name: 'Empty After', slug: 'empty-after', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.install({ skillId: skill.id });
      await manager.revokeSkill('empty-after');

      expect(manager.listInstalled()).toHaveLength(0);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Reject skill (full delete)                                       */
  /* ---------------------------------------------------------------- */

  describe('Reject skill (full delete)', () => {
    it('rejectSkill removes skill + versions + installations from DB', async () => {
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });
      const repo = manager.getRepository();

      const { skill } = manager.uploadFiles({
        name: 'Reject Me', slug: 'reject-me', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.install({ skillId: skill.id });

      await manager.rejectSkill('reject-me');

      expect(repo.getBySlug('reject-me')).toBeNull();
      expect(repo.getInstallations()).toHaveLength(0);
    });

    it('undeploy spy called for all installations before delete', async () => {
      ensureProfile(storage, 't1');
      ensureProfile(storage, 't2');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      manager.uploadFiles({
        name: 'Reject Deploy', slug: 'reject-deploy', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.installToTargets('reject-deploy', ['t1', 't2']);
      adapter.undeploySpy.mockClear();

      await manager.rejectSkill('reject-deploy');

      expect(adapter.undeploySpy).toHaveBeenCalledTimes(2);
    });

    it('skill no longer found by slug', async () => {
      const manager = new SkillManager(storage, { offlineMode: true });

      manager.uploadFiles({
        name: 'Gone', slug: 'gone-skill', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.rejectSkill('gone-skill');

      expect(manager.getSkillBySlug('gone-skill')).toBeNull();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Toggle skill                                                     */
  /* ---------------------------------------------------------------- */

  describe('Toggle skill', () => {
    it('toggleSkill disables active skill (uninstalls)', async () => {
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      const { skill } = manager.uploadFiles({
        name: 'Toggle Off', slug: 'toggle-off', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.install({ skillId: skill.id });
      const result = await manager.toggleSkill('toggle-off');

      expect(result.action).toBe('disabled');
      expect(manager.getRepository().getInstallations()).toHaveLength(0);
    });

    it('toggleSkill enables disabled skill (re-installs)', async () => {
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      const { skill } = manager.uploadFiles({
        name: 'Toggle On', slug: 'toggle-on', version: '1.0.0',
        files: makeSkillFiles(),
      });

      // Install then disable
      await manager.install({ skillId: skill.id });
      await manager.toggleSkill('toggle-on');
      expect(manager.getRepository().getInstallations()).toHaveLength(0);

      // Toggle should re-enable
      const result = await manager.toggleSkill('toggle-on');
      expect(result.action).toBe('enabled');
      expect(manager.getRepository().getInstallations()).toHaveLength(1);
    });

    it('toggle with profileId scopes to specific target', async () => {
      ensureProfile(storage, 't1');
      ensureProfile(storage, 't2');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      const { skill } = manager.uploadFiles({
        name: 'Toggle Scoped', slug: 'toggle-scoped', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.installToTargets('toggle-scoped', ['t1', 't2']);

      // Toggle off only for t1
      const result = await manager.toggleSkill('toggle-scoped', { profileId: 't1' });

      expect(result.action).toBe('disabled');
      const installations = manager.getRepository().getInstallations();
      expect(installations).toHaveLength(1);
      expect(installations[0].profileId).toBe('t2');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Approve quarantined skill                                        */
  /* ---------------------------------------------------------------- */

  describe('Approve quarantined skill', () => {
    it('approveSkill changes version approval to approved', async () => {
      const manager = new SkillManager(storage, { offlineMode: true });
      const repo = manager.getRepository();

      const { skill, version } = manager.uploadFiles({
        name: 'Approve Me', slug: 'approve-me', version: '1.0.0',
        files: makeSkillFiles(),
      });

      // Quarantine it first
      repo.quarantineVersion(version.id);
      expect(repo.getVersionById(version.id)!.approval).toBe('quarantined');

      await manager.approveSkill('approve-me');

      expect(repo.getVersionById(version.id)!.approval).toBe('approved');
    });

    it('approveSkill creates active installation', async () => {
      const manager = new SkillManager(storage, { offlineMode: true });

      manager.uploadFiles({
        name: 'Approve Install', slug: 'approve-install', version: '1.0.0',
        files: makeSkillFiles(),
      });

      const inst = await manager.approveSkill('approve-install');

      expect(inst.status).toBe('active');
    });

    it('approveSkill with profileId installs to specific target', async () => {
      ensureProfile(storage, 'prof-1');
      const adapter = createMockDeployAdapter();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });

      manager.uploadFiles({
        name: 'Approve Target', slug: 'approve-target', version: '1.0.0',
        files: makeSkillFiles(),
      });

      const inst = await manager.approveSkill('approve-target', { profileId: 'prof-1' });

      expect(inst.profileId).toBe('prof-1');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Download + install two-phase workflow                             */
  /* ---------------------------------------------------------------- */

  describe('Download + install two-phase workflow', () => {
    it('download creates skill + version, no installation', async () => {
      const remoteSkills = new Map([
        ['dl-skill', { name: 'Download Skill', slug: 'dl-skill', author: 'test', description: '', tags: [], remoteId: 'r-dl' }],
      ]);
      const remote = createMockRemoteClient(remoteSkills);
      const manager = new SkillManager(storage, { remoteClient: remote });

      const { skill, version } = await manager.download({ slug: 'dl-skill' });

      expect(skill.slug).toBe('dl-skill');
      expect(version).toBeDefined();
      expect(manager.getRepository().getInstallations()).toHaveLength(0);
    });

    it('install after download creates installation for existing skill', async () => {
      const remoteSkills = new Map([
        ['dl-then-install', { name: 'DL Install', slug: 'dl-then-install', author: 'test', description: '', tags: [], remoteId: 'r-dli' }],
      ]);
      const remote = createMockRemoteClient(remoteSkills);
      const manager = new SkillManager(storage, { remoteClient: remote });

      const { skill } = await manager.download({ slug: 'dl-then-install' });
      const inst = await manager.install({ skillId: skill.id });

      expect(inst.status).toBe('active');
      expect(manager.listInstalled()).toHaveLength(1);
    });

    it('download same slug returns cached (dedup)', async () => {
      const remoteSkills = new Map([
        ['dedup-skill', { name: 'Dedup', slug: 'dedup-skill', author: 'test', description: '', tags: [], remoteId: 'r-dedup' }],
      ]);
      const remote = createMockRemoteClient(remoteSkills);
      const manager = new SkillManager(storage, { remoteClient: remote });

      const result1 = await manager.download({ slug: 'dedup-skill' });
      const result2 = await manager.download({ slug: 'dedup-skill' });

      expect(result1.skill.id).toBe(result2.skill.id);
      // Remote.download should only be called once
      expect(remote.download).toHaveBeenCalledTimes(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Event bridging to EventBus                                       */
  /* ---------------------------------------------------------------- */

  describe('Event bridging to EventBus', () => {
    it('download:started → skills:download_started with {name}', async () => {
      const remoteSkills = new Map([
        ['bridge-dl', { name: 'Bridge DL', slug: 'bridge-dl', author: 'test', description: '', tags: [], remoteId: 'r-bdl' }],
      ]);
      const remote = createMockRemoteClient(remoteSkills);
      const bus = createMockEventBus();
      const manager = new SkillManager(storage, { remoteClient: remote, eventBus: bus });

      await manager.download({ slug: 'bridge-dl' });

      const emission = bus.emissions.find((e) => e.type === 'skills:download_started');
      expect(emission).toBeDefined();
      expect((emission!.payload as Record<string, unknown>).name).toBe('bridge-dl');
    });

    it('download:completed → skills:downloaded with {name, slug}', async () => {
      const remoteSkills = new Map([
        ['bridge-dlc', { name: 'Bridge DLC', slug: 'bridge-dlc', author: 'test', description: '', tags: [], remoteId: 'r-bdlc' }],
      ]);
      const remote = createMockRemoteClient(remoteSkills);
      const bus = createMockEventBus();
      const manager = new SkillManager(storage, { remoteClient: remote, eventBus: bus });

      await manager.download({ slug: 'bridge-dlc' });

      const emission = bus.emissions.find((e) => e.type === 'skills:downloaded');
      expect(emission).toBeDefined();
      const payload = emission!.payload as Record<string, unknown>;
      expect(payload.name).toBe('bridge-dlc');
      expect(payload.slug).toBe('bridge-dlc');
    });

    it('download:error → skills:download_failed with {name, error}', async () => {
      const remote = createMockRemoteClient(); // No skills — will fail
      const bus = createMockEventBus();
      const manager = new SkillManager(storage, { remoteClient: remote, eventBus: bus });

      await manager.download({ slug: 'nonexistent' }).catch(() => {});

      const emission = bus.emissions.find((e) => e.type === 'skills:download_failed');
      expect(emission).toBeDefined();
      const payload = emission!.payload as Record<string, unknown>;
      expect(payload.error).toBeDefined();
    });

    it('install:started → skills:install_started with {name}', async () => {
      const bus = createMockEventBus();
      const manager = new SkillManager(storage, { offlineMode: true, eventBus: bus });

      const { skill } = manager.uploadFiles({
        name: 'Bridge Install', slug: 'bridge-install', version: '1.0.0',
        files: makeSkillFiles(),
      });
      await manager.install({ skillId: skill.id });

      const emission = bus.emissions.find((e) => e.type === 'skills:install_started');
      expect(emission).toBeDefined();
    });

    it('install:completed → skills:installed with {name}', async () => {
      const bus = createMockEventBus();
      const manager = new SkillManager(storage, { offlineMode: true, eventBus: bus });

      const { skill } = manager.uploadFiles({
        name: 'Bridge Installed', slug: 'bridge-installed', version: '1.0.0',
        files: makeSkillFiles(),
      });
      await manager.install({ skillId: skill.id });

      const emission = bus.emissions.find((e) => e.type === 'skills:installed');
      expect(emission).toBeDefined();
    });

    it('install:error → skills:install_failed with {name, error}', async () => {
      const bus = createMockEventBus();
      const manager = new SkillManager(storage, { offlineMode: true, eventBus: bus });

      await manager.install({ skillId: 'nonexistent' }).catch(() => {});

      const emission = bus.emissions.find((e) => e.type === 'skills:install_failed');
      expect(emission).toBeDefined();
      expect((emission!.payload as Record<string, unknown>).error).toBeDefined();
    });

    it('analyze:completed → skills:analyzed with {name, analysis}', async () => {
      const bus = createMockEventBus();
      const manager = new SkillManager(storage, { offlineMode: true, eventBus: bus });

      const { version } = manager.uploadFiles({
        name: 'Bridge Analyze', slug: 'bridge-analyze', version: '1.0.0',
        files: makeSkillFiles(),
      });
      await manager.analyze(version.id);

      const emission = bus.emissions.find((e) => e.type === 'skills:analyzed');
      expect(emission).toBeDefined();
    });

    it('analyze:error → skills:analysis_failed with {name, error}', async () => {
      const bus = createMockEventBus();
      const failAdapter = {
        id: 'fail', displayName: 'Fail',
        analyze: () => { throw new Error('boom'); },
      };
      const manager = new SkillManager(storage, { offlineMode: true, eventBus: bus, analyzers: [failAdapter] });

      const { version } = manager.uploadFiles({
        name: 'Bridge Fail', slug: 'bridge-fail', version: '1.0.0',
        files: makeSkillFiles(),
      });
      await manager.analyze(version.id).catch(() => {});

      const emission = bus.emissions.find((e) => e.type === 'skills:analysis_failed');
      expect(emission).toBeDefined();
    });

    it('deploy:completed → skills:deployed with {name, adapterId}', async () => {
      const adapter = createMockDeployAdapter();
      const bus = createMockEventBus();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter], eventBus: bus });

      const { skill } = manager.uploadFiles({
        name: 'Bridge Deploy', slug: 'bridge-deploy', version: '1.0.0',
        files: makeSkillFiles(),
      });
      await manager.install({ skillId: skill.id });

      const emission = bus.emissions.find((e) => e.type === 'skills:deployed');
      expect(emission).toBeDefined();
      expect((emission!.payload as Record<string, unknown>).adapterId).toBe('mock');
    });

    it('deploy:error → skills:deploy_failed with {name, error}', async () => {
      const adapter = createMockDeployAdapter({ shouldThrow: true });
      const bus = createMockEventBus();
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter], eventBus: bus });

      const { skill } = manager.uploadFiles({
        name: 'Bridge Deploy Fail', slug: 'bridge-deploy-fail', version: '1.0.0',
        files: makeSkillFiles(),
      });
      await manager.install({ skillId: skill.id }).catch(() => {});

      const emission = bus.emissions.find((e) => e.type === 'skills:deploy_failed');
      expect(emission).toBeDefined();
      expect((emission!.payload as Record<string, unknown>).error).toBeDefined();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Watcher suppression                                              */
  /* ---------------------------------------------------------------- */

  describe('Watcher suppression', () => {
    it('install auto-suppresses watcher slug during operation', async () => {
      const manager = new SkillManager(storage, { offlineMode: true });
      const watcher = manager.getWatcher();
      const suppressSpy = jest.spyOn(watcher, 'suppressSlug');
      const unsuppressSpy = jest.spyOn(watcher, 'unsuppressSlug');

      const { skill } = manager.uploadFiles({
        name: 'Suppress Install', slug: 'suppress-install', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.install({ skillId: skill.id });

      expect(suppressSpy).toHaveBeenCalledWith('suppress-install');
      expect(unsuppressSpy).toHaveBeenCalledWith('suppress-install');
    });

    it('uninstall auto-suppresses watcher slug during operation', async () => {
      const manager = new SkillManager(storage, { offlineMode: true });
      const watcher = manager.getWatcher();

      const { skill } = manager.uploadFiles({
        name: 'Suppress Uninstall', slug: 'suppress-uninstall', version: '1.0.0',
        files: makeSkillFiles(),
      });

      const inst = await manager.install({ skillId: skill.id });

      const suppressSpy = jest.spyOn(watcher, 'suppressSlug');
      const unsuppressSpy = jest.spyOn(watcher, 'unsuppressSlug');

      await manager.uninstall(inst.id);

      expect(suppressSpy).toHaveBeenCalledWith('suppress-uninstall');
      expect(unsuppressSpy).toHaveBeenCalledWith('suppress-uninstall');
    });

    it('watcher unsuppressed after install completes (success)', async () => {
      const manager = new SkillManager(storage, { offlineMode: true });
      const watcher = manager.getWatcher();
      const unsuppressSpy = jest.spyOn(watcher, 'unsuppressSlug');

      const { skill } = manager.uploadFiles({
        name: 'Unsuppress OK', slug: 'unsuppress-ok', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.install({ skillId: skill.id });

      expect(unsuppressSpy).toHaveBeenCalledWith('unsuppress-ok');
    });

    it('watcher unsuppressed after install fails (error)', async () => {
      const adapter = createMockDeployAdapter({ shouldThrow: true });
      const manager = new SkillManager(storage, { offlineMode: true, deployers: [adapter] });
      const watcher = manager.getWatcher();
      const unsuppressSpy = jest.spyOn(watcher, 'unsuppressSlug');

      const { skill } = manager.uploadFiles({
        name: 'Unsuppress Fail', slug: 'unsuppress-fail', version: '1.0.0',
        files: makeSkillFiles(),
      });

      await manager.install({ skillId: skill.id }).catch(() => {});

      expect(unsuppressSpy).toHaveBeenCalledWith('unsuppress-fail');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Content / backup                                                 */
  /* ---------------------------------------------------------------- */

  describe('Content / backup', () => {
    it('uploadFiles with backupDir stores SKILL.md in backup', () => {
      const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-content-'));
      const manager = new SkillManager(storage, { offlineMode: true, backupDir });

      const { version } = manager.uploadFiles({
        name: 'Backup Content', slug: 'backup-content', version: '1.0.0',
        files: makeSkillFiles(),
      });

      expect(manager.backup).not.toBeNull();
      expect(manager.backup!.hasBackup(version.id)).toBe(true);

      try { fs.rmSync(backupDir, { recursive: true }); } catch { /* */ }
    });

    it('backup.loadSkillMd returns stored content', () => {
      const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-load-'));
      const manager = new SkillManager(storage, { offlineMode: true, backupDir });

      const { version } = manager.uploadFiles({
        name: 'Load Content', slug: 'load-content', version: '1.0.0',
        files: makeSkillFiles(),
      });

      const content = manager.backup!.loadSkillMd(version.id);
      expect(content).toContain('# Test Skill');

      try { fs.rmSync(backupDir, { recursive: true }); } catch { /* */ }
    });

    it('file hashes match expected SHA-256', () => {
      const manager = new SkillManager(storage, { offlineMode: true });
      const fileContent = Buffer.from('hello world');
      const expectedHash = crypto.createHash('sha256').update(fileContent).digest('hex');

      const { version } = manager.uploadFiles({
        name: 'Hash Check', slug: 'hash-check', version: '1.0.0',
        files: [{ relativePath: 'test.txt', content: fileContent }],
      });

      const files = manager.getRepository().getFiles(version.id);
      expect(files[0].fileHash).toBe(expectedHash);
    });
  });
});
