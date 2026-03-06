/**
 * DaemonDeployAdapter tests
 *
 * Tests the daemon's production deploy adapter with mocked external dependencies
 * (broker, sudo, policy manager) and real filesystem operations.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import type { Skill, SkillVersion, SkillFile, SkillInstallation } from '@agenshield/ipc';

// ─── Mocks ────────────────────────────────────────────────────

jest.mock('../services/broker-bridge', () => ({
  isBrokerAvailable: jest.fn().mockResolvedValue(false),
  installSkillViaBroker: jest.fn().mockResolvedValue({ installed: true }),
  uninstallSkillViaBroker: jest.fn().mockResolvedValue({ uninstalled: true }),
}));

jest.mock('../services/skill-lifecycle', () => ({
  addSkillPolicy: jest.fn(),
  removeSkillPolicy: jest.fn(),
  createSkillWrapper: jest.fn().mockResolvedValue(undefined),
  removeSkillWrapper: jest.fn(),
  removeBrewBinaryWrappers: jest.fn().mockResolvedValue(undefined),
  sudoMkdir: jest.fn().mockResolvedValue(undefined),
  sudoWriteFile: jest.fn().mockResolvedValue(undefined),
  sudoRm: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/skill-tag-injector', () => ({
  injectInstallationTag: jest.fn().mockImplementation((content: string) => Promise.resolve(content)),
}));

jest.mock('../config', () => ({
  loadConfig: jest.fn().mockReturnValue({ policies: [] }),
  updateConfig: jest.fn(),
}));

jest.mock('../command-sync', () => ({
  syncCommandPolicies: jest.fn(),
}));

jest.mock('../services/policy-manager', () => ({
  getPolicyManager: jest.fn().mockReturnValue({ recompile: jest.fn() }),
  hasPolicyManager: jest.fn().mockReturnValue(true),
}));

jest.mock('@agenshield/sandbox', () => ({
  stripEnvFromSkillMd: jest.fn().mockImplementation((content: string) => content.replace(/ENV_VAR=\S+/g, '<!-- env stripped -->')),
}));

import { DaemonDeployAdapter } from '../adapters/daemon-deploy-adapter';
import type { DeployContext } from '@agentshield/skills';
import { isBrokerAvailable, installSkillViaBroker, uninstallSkillViaBroker } from '../services/broker-bridge';
import { addSkillPolicy, removeSkillPolicy, removeBrewBinaryWrappers, removeSkillWrapper } from '../services/skill-lifecycle';
import { injectInstallationTag } from '../services/skill-tag-injector';
import { stripEnvFromSkillMd } from '@agenshield/sandbox';
import { hasPolicyManager, getPolicyManager } from '../services/policy-manager';

// ─── Helpers ──────────────────────────────────────────────────

function createTmpDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-deploy-'));
  const skillsDir = path.join(base, 'skills');
  const binDir = path.join(base, 'bin');
  const agentHome = path.join(base, 'agent');
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(agentHome, { recursive: true });
  return {
    base,
    skillsDir,
    binDir,
    agentHome,
    cleanup: () => { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* */ } },
  };
}

function makeSkill(overrides?: Partial<Skill>): Skill {
  return {
    id: '1', name: 'Test Skill', slug: 'test-skill', tags: [],
    source: 'manual', sourceOrigin: 'unknown', isPublic: true,
    createdAt: '', updatedAt: '', ...overrides,
  };
}

function makeVersion(folderPath: string, overrides?: Partial<SkillVersion>): SkillVersion {
  return {
    id: '1', skillId: '1', version: '1.0.0', folderPath,
    contentHash: '', hashUpdatedAt: '', approval: 'unknown',
    trusted: false, analysisStatus: 'pending',
    requiredBins: [], requiredEnv: [], extractedCommands: [],
    createdAt: '', updatedAt: '', ...overrides,
  };
}

function makeInstallation(overrides?: Partial<SkillInstallation>): SkillInstallation {
  return {
    id: '1', skillVersionId: '1', status: 'pending',
    autoUpdate: true, installedAt: '', updatedAt: '', ...overrides,
  };
}

function makeFiles(contents: Record<string, string>): { files: SkillFile[]; fileContents: Map<string, Buffer> } {
  const files: SkillFile[] = [];
  const fileContents = new Map<string, Buffer>();
  let i = 0;
  for (const [relPath, content] of Object.entries(contents)) {
    const buf = Buffer.from(content);
    files.push({
      id: String(++i), skillVersionId: '1', relativePath: relPath,
      fileHash: crypto.createHash('sha256').update(buf).digest('hex'),
      sizeBytes: buf.length, createdAt: '', updatedAt: '',
    });
    fileContents.set(relPath, buf);
  }
  return { files, fileContents };
}

// ─── Tests ────────────────────────────────────────────────────

describe('DaemonDeployAdapter', () => {
  let dirs: ReturnType<typeof createTmpDirs>;
  let adapter: DaemonDeployAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    dirs = createTmpDirs();
    adapter = new DaemonDeployAdapter({
      skillsDir: dirs.skillsDir,
      agentHome: dirs.agentHome,
      socketGroup: 'ash_test',
      binDir: dirs.binDir,
      devMode: true,
    });
  });

  afterEach(() => dirs.cleanup());

  // ─── canDeploy ────────────────────────────────────────────

  describe('canDeploy', () => {
    it('returns true for undefined profileId', () => {
      expect(adapter.canDeploy(undefined)).toBe(true);
    });

    it('returns true for any profileId', () => {
      expect(adapter.canDeploy('some-profile-uuid')).toBe(true);
      expect(adapter.canDeploy('claude-code')).toBe(true);
    });
  });

  // ─── deploy (devMode) ────────────────────────────────────

  describe('deploy (devMode)', () => {
    it('writes files to disk and returns correct paths/hash', async () => {
      const { files, fileContents } = makeFiles({
        'index.ts': 'export default {}',
        'config.json': '{"key":"val"}',
      });

      const context: DeployContext = {
        skill: makeSkill(),
        version: makeVersion(dirs.skillsDir),
        files,
        installation: makeInstallation(),
        fileContents,
      };

      const result = await adapter.deploy(context);

      expect(result.deployedPath).toBe(path.join(dirs.skillsDir, 'test-skill'));
      expect(result.deployedHash).toBeTruthy();
      expect(fs.existsSync(path.join(dirs.skillsDir, 'test-skill', 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(dirs.skillsDir, 'test-skill', 'config.json'))).toBe(true);
    });

    it('creates dev wrapper in binDir', async () => {
      const { files, fileContents } = makeFiles({ 'index.ts': 'export default {}' });

      const context: DeployContext = {
        skill: makeSkill(),
        version: makeVersion(dirs.skillsDir),
        files,
        installation: makeInstallation(),
        fileContents,
      };

      await adapter.deploy(context);

      const wrapperPath = path.join(dirs.binDir, 'test-skill');
      expect(fs.existsSync(wrapperPath)).toBe(true);
      const wrapperContent = fs.readFileSync(wrapperPath, 'utf-8');
      expect(wrapperContent).toContain('dev-wrapper');
      expect(wrapperContent).toContain('test-skill');
    });

    it('calls addSkillPolicy', async () => {
      const { files, fileContents } = makeFiles({ 'index.ts': 'code' });

      const context: DeployContext = {
        skill: makeSkill(),
        version: makeVersion(dirs.skillsDir),
        files,
        installation: makeInstallation(),
        fileContents,
      };

      await adapter.deploy(context);

      expect(addSkillPolicy).toHaveBeenCalledWith('test-skill');
    });

    it('calls recompile on policy manager', async () => {
      const { files, fileContents } = makeFiles({ 'index.ts': 'code' });

      const context: DeployContext = {
        skill: makeSkill(),
        version: makeVersion(dirs.skillsDir),
        files,
        installation: makeInstallation(),
        fileContents,
      };

      await adapter.deploy(context);

      expect(hasPolicyManager).toHaveBeenCalled();
      expect(getPolicyManager().recompile).toHaveBeenCalled();
    });
  });

  // ─── deploy (file processing) ────────────────────────────

  describe('deploy (file processing)', () => {
    it('strips env from SKILL.md', async () => {
      const { files, fileContents } = makeFiles({
        'SKILL.md': '# Skill\nENV_VAR=secret',
      });

      const context: DeployContext = {
        skill: makeSkill(),
        version: makeVersion(dirs.skillsDir),
        files,
        installation: makeInstallation(),
        fileContents,
      };

      await adapter.deploy(context);

      expect(stripEnvFromSkillMd).toHaveBeenCalled();
      const deployed = fs.readFileSync(path.join(dirs.skillsDir, 'test-skill', 'SKILL.md'), 'utf-8');
      expect(deployed).toContain('<!-- env stripped -->');
      expect(deployed).not.toContain('ENV_VAR=secret');
    });

    it('injects installation tag into SKILL.md', async () => {
      const { files, fileContents } = makeFiles({
        'SKILL.md': '# Skill\nContent',
      });

      const context: DeployContext = {
        skill: makeSkill(),
        version: makeVersion(dirs.skillsDir),
        files,
        installation: makeInstallation(),
        fileContents,
      };

      await adapter.deploy(context);

      expect(injectInstallationTag).toHaveBeenCalled();
    });

    it('leaves non-SKILL.md files unchanged', async () => {
      const { files, fileContents } = makeFiles({
        'index.ts': 'export const x = 1',
      });

      const context: DeployContext = {
        skill: makeSkill(),
        version: makeVersion(dirs.skillsDir),
        files,
        installation: makeInstallation(),
        fileContents,
      };

      await adapter.deploy(context);

      expect(stripEnvFromSkillMd).not.toHaveBeenCalled();
      const deployed = fs.readFileSync(path.join(dirs.skillsDir, 'test-skill', 'index.ts'), 'utf-8');
      expect(deployed).toBe('export const x = 1');
    });

    it('prefers backup content over disk source', async () => {
      // Write a different version on disk
      const sourceDir = path.join(dirs.base, 'source');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(path.join(sourceDir, 'index.ts'), 'disk version');

      const fileContents = new Map<string, Buffer>();
      fileContents.set('index.ts', Buffer.from('backup version'));

      const files: SkillFile[] = [{
        id: '1', skillVersionId: '1', relativePath: 'index.ts',
        fileHash: crypto.createHash('sha256').update('backup version').digest('hex'),
        sizeBytes: 14, createdAt: '', updatedAt: '',
      }];

      const context: DeployContext = {
        skill: makeSkill(),
        version: makeVersion(sourceDir),
        files,
        installation: makeInstallation(),
        fileContents,
      };

      await adapter.deploy(context);

      const deployed = fs.readFileSync(path.join(dirs.skillsDir, 'test-skill', 'index.ts'), 'utf-8');
      expect(deployed).toBe('backup version');
    });
  });

  // ─── deploy (production tiers) ───────────────────────────

  describe('deploy (production tiers)', () => {
    let prodAdapter: DaemonDeployAdapter;

    beforeEach(() => {
      prodAdapter = new DaemonDeployAdapter({
        skillsDir: dirs.skillsDir,
        agentHome: dirs.agentHome,
        socketGroup: 'ash_test',
        binDir: dirs.binDir,
        devMode: false,
      });
    });

    it('uses broker when available', async () => {
      (isBrokerAvailable as jest.Mock).mockResolvedValueOnce(true);
      (installSkillViaBroker as jest.Mock).mockResolvedValueOnce({ installed: true });

      const { files, fileContents } = makeFiles({ 'index.ts': 'code' });
      const context: DeployContext = {
        skill: makeSkill(),
        version: makeVersion(dirs.skillsDir),
        files,
        installation: makeInstallation(),
        fileContents,
      };

      await prodAdapter.deploy(context);

      expect(installSkillViaBroker).toHaveBeenCalled();
    });

    it('falls back to direct fs when broker and sudo fail', async () => {
      (isBrokerAvailable as jest.Mock).mockResolvedValueOnce(false);
      // sudoMkdir is already mocked to succeed (resolves undefined)

      const { files, fileContents } = makeFiles({ 'index.ts': 'fallback code' });
      const context: DeployContext = {
        skill: makeSkill(),
        version: makeVersion(dirs.skillsDir),
        files,
        installation: makeInstallation(),
        fileContents,
      };

      const result = await prodAdapter.deploy(context);
      expect(result.deployedPath).toContain('test-skill');
    });
  });

  // ─── undeploy (devMode) ──────────────────────────────────

  describe('undeploy (devMode)', () => {
    it('removes deployed directory', async () => {
      // Pre-create deployed files
      const deployDir = path.join(dirs.skillsDir, 'test-skill');
      fs.mkdirSync(deployDir, { recursive: true });
      fs.writeFileSync(path.join(deployDir, 'index.ts'), 'code');

      await adapter.undeploy(makeInstallation({ status: 'active' }), makeVersion(dirs.skillsDir), makeSkill());

      expect(fs.existsSync(deployDir)).toBe(false);
    });

    it('calls removeSkillPolicy', async () => {
      const deployDir = path.join(dirs.skillsDir, 'test-skill');
      fs.mkdirSync(deployDir, { recursive: true });

      await adapter.undeploy(makeInstallation({ status: 'active' }), makeVersion(dirs.skillsDir), makeSkill());

      expect(removeSkillPolicy).toHaveBeenCalledWith('test-skill');
    });

    it('calls removeBrewBinaryWrappers', async () => {
      await adapter.undeploy(makeInstallation({ status: 'active' }), makeVersion(dirs.skillsDir), makeSkill());

      expect(removeBrewBinaryWrappers).toHaveBeenCalledWith('test-skill');
    });

    it('calls removeSkillWrapper', async () => {
      await adapter.undeploy(makeInstallation({ status: 'active' }), makeVersion(dirs.skillsDir), makeSkill());

      expect(removeSkillWrapper).toHaveBeenCalledWith('test-skill', dirs.binDir);
    });

    it('calls recompile on policy manager', async () => {
      await adapter.undeploy(makeInstallation({ status: 'active' }), makeVersion(dirs.skillsDir), makeSkill());

      expect(getPolicyManager().recompile).toHaveBeenCalled();
    });
  });

  // ─── undeploy (production) ───────────────────────────────

  describe('undeploy (production)', () => {
    let prodAdapter: DaemonDeployAdapter;

    beforeEach(() => {
      prodAdapter = new DaemonDeployAdapter({
        skillsDir: dirs.skillsDir,
        agentHome: dirs.agentHome,
        socketGroup: 'ash_test',
        binDir: dirs.binDir,
        devMode: false,
      });
    });

    it('uses broker when available', async () => {
      (isBrokerAvailable as jest.Mock).mockResolvedValueOnce(true);

      await prodAdapter.undeploy(makeInstallation({ status: 'active' }), makeVersion(dirs.skillsDir), makeSkill());

      expect(uninstallSkillViaBroker).toHaveBeenCalled();
    });

    it('falls back to sudo when broker unavailable', async () => {
      (isBrokerAvailable as jest.Mock).mockResolvedValueOnce(false);

      const deployDir = path.join(dirs.skillsDir, 'test-skill');
      fs.mkdirSync(deployDir, { recursive: true });

      await prodAdapter.undeploy(makeInstallation({ status: 'active' }), makeVersion(dirs.skillsDir), makeSkill());

      const { sudoRm } = require('../services/skill-lifecycle');
      expect(sudoRm).toHaveBeenCalled();
    });
  });

  // ─── checkIntegrity ──────────────────────────────────────

  describe('checkIntegrity', () => {
    const skill = makeSkill();

    it('reports intact when all files match', async () => {
      const deployDir = path.join(dirs.skillsDir, 'test-skill');
      fs.mkdirSync(deployDir, { recursive: true });
      const content = 'export default {}';
      fs.writeFileSync(path.join(deployDir, 'index.ts'), content);
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      const files: SkillFile[] = [{
        id: '1', skillVersionId: '1', relativePath: 'index.ts',
        fileHash: hash, sizeBytes: content.length, createdAt: '', updatedAt: '',
      }];

      const result = await adapter.checkIntegrity(makeInstallation({ status: 'active' }), makeVersion(dirs.skillsDir), files, skill);
      expect(result.intact).toBe(true);
      expect(result.modifiedFiles).toHaveLength(0);
      expect(result.missingFiles).toHaveLength(0);
      expect(result.unexpectedFiles).toHaveLength(0);
    });

    it('detects modified files', async () => {
      const deployDir = path.join(dirs.skillsDir, 'test-skill');
      fs.mkdirSync(deployDir, { recursive: true });
      fs.writeFileSync(path.join(deployDir, 'index.ts'), 'tampered content');

      const files: SkillFile[] = [{
        id: '1', skillVersionId: '1', relativePath: 'index.ts',
        fileHash: 'original-hash', sizeBytes: 10, createdAt: '', updatedAt: '',
      }];

      const result = await adapter.checkIntegrity(makeInstallation({ status: 'active' }), makeVersion(dirs.skillsDir), files, skill);
      expect(result.intact).toBe(false);
      expect(result.modifiedFiles).toContain('index.ts');
    });

    it('detects missing files', async () => {
      const deployDir = path.join(dirs.skillsDir, 'test-skill');
      fs.mkdirSync(deployDir, { recursive: true });

      const files: SkillFile[] = [{
        id: '1', skillVersionId: '1', relativePath: 'missing.ts',
        fileHash: 'abc', sizeBytes: 10, createdAt: '', updatedAt: '',
      }];

      const result = await adapter.checkIntegrity(makeInstallation({ status: 'active' }), makeVersion(dirs.skillsDir), files, skill);
      expect(result.intact).toBe(false);
      expect(result.missingFiles).toContain('missing.ts');
    });

    it('detects unexpected files', async () => {
      const deployDir = path.join(dirs.skillsDir, 'test-skill');
      fs.mkdirSync(deployDir, { recursive: true });
      const content = 'export default {}';
      fs.writeFileSync(path.join(deployDir, 'index.ts'), content);
      fs.writeFileSync(path.join(deployDir, 'extra.ts'), 'unexpected');
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      const files: SkillFile[] = [{
        id: '1', skillVersionId: '1', relativePath: 'index.ts',
        fileHash: hash, sizeBytes: content.length, createdAt: '', updatedAt: '',
      }];

      const result = await adapter.checkIntegrity(makeInstallation({ status: 'active' }), makeVersion(dirs.skillsDir), files, skill);
      expect(result.intact).toBe(false);
      expect(result.unexpectedFiles).toContain('extra.ts');
    });

    it('detects unexpected files in nested dirs', async () => {
      const deployDir = path.join(dirs.skillsDir, 'test-skill');
      fs.mkdirSync(path.join(deployDir, 'src', 'lib'), { recursive: true });
      const content = 'export default {}';
      fs.writeFileSync(path.join(deployDir, 'index.ts'), content);
      fs.writeFileSync(path.join(deployDir, 'src', 'lib', 'extra.ts'), 'nested');
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      const files: SkillFile[] = [{
        id: '1', skillVersionId: '1', relativePath: 'index.ts',
        fileHash: hash, sizeBytes: content.length, createdAt: '', updatedAt: '',
      }];

      const result = await adapter.checkIntegrity(makeInstallation({ status: 'active' }), makeVersion(dirs.skillsDir), files, skill);
      expect(result.intact).toBe(false);
      expect(result.unexpectedFiles).toContain('src/lib/extra.ts');
    });
  });

  // ─── profile resolution ──────────────────────────────────

  describe('profile resolution', () => {
    it('uses default paths when no profileId', async () => {
      const { files, fileContents } = makeFiles({ 'index.ts': 'code' });

      const context: DeployContext = {
        skill: makeSkill(),
        version: makeVersion(dirs.skillsDir),
        files,
        installation: makeInstallation({ profileId: undefined }),
        fileContents,
      };

      const result = await adapter.deploy(context);
      expect(result.deployedPath).toBe(path.join(dirs.skillsDir, 'test-skill'));
    });

    it('uses per-profile paths when profile has agentHomeDir', async () => {
      const profileHome = path.join(dirs.base, 'profile-agent');
      const profileSkillsDir = path.join(profileHome, '.openclaw', 'workspace', 'skills');
      fs.mkdirSync(path.join(profileHome, 'bin'), { recursive: true });

      const profileAdapter = new DaemonDeployAdapter({
        skillsDir: dirs.skillsDir,
        agentHome: dirs.agentHome,
        socketGroup: 'ash_test',
        binDir: dirs.binDir,
        devMode: true,
        profiles: {
          getById: (id: string) => id === 'p1' ? {
            id: 'p1', name: 'Profile 1', type: 'target' as const,
            agentHomeDir: profileHome, agentUsername: 'ash_custom_agent',
            createdAt: '', updatedAt: '',
          } : null,
        },
      });

      const { files, fileContents } = makeFiles({ 'index.ts': 'code' });
      const context: DeployContext = {
        skill: makeSkill(),
        version: makeVersion(dirs.skillsDir),
        files,
        installation: makeInstallation({ profileId: 'p1' }),
        fileContents,
      };

      const result = await profileAdapter.deploy(context);
      expect(result.deployedPath).toBe(path.join(profileSkillsDir, 'test-skill'));
    });

    it('resolves Claude Code skillsDir for claude-code presetId', async () => {
      const profileHome = path.join(dirs.base, 'claude-agent');
      const claudeSkillsDir = path.join(profileHome, '.claude', 'skills');

      const profileAdapter = new DaemonDeployAdapter({
        skillsDir: dirs.skillsDir,
        agentHome: dirs.agentHome,
        socketGroup: 'ash_test',
        binDir: dirs.binDir,
        devMode: true,
        profiles: {
          getById: (id: string) => id === 'cc1' ? {
            id: 'cc1', name: 'Claude', type: 'target' as const,
            agentHomeDir: profileHome, agentUsername: 'ash_claude_agent',
            presetId: 'claude-code',
            createdAt: '', updatedAt: '',
          } : null,
        },
      });

      const { files, fileContents } = makeFiles({ 'index.ts': 'code' });
      const context: DeployContext = {
        skill: makeSkill(),
        version: makeVersion(dirs.skillsDir),
        files,
        installation: makeInstallation({ profileId: 'cc1' }),
        fileContents,
      };

      const result = await profileAdapter.deploy(context);
      expect(result.deployedPath).toBe(path.join(claudeSkillsDir, 'test-skill'));
    });
  });
});
