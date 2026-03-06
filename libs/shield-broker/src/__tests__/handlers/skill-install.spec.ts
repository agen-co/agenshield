import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { handleSkillInstall, handleSkillUninstall } from '../../handlers/skill-install.js';
import { createHandlerContext, createMockDeps } from '../helpers.js';

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}));

const ctx = createHandlerContext();
const deps = createMockDeps();

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'broker-skill-test-'));
}

describe('handleSkillInstall', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('should return error when agentHome is missing', async () => {
    const result = await handleSkillInstall(
      { slug: 'test', files: [{ name: 'file.md', content: 'x' }], agentHome: '' },
      ctx, deps
    );
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1003);
  });

  it('should return error for invalid slug', async () => {
    const result = await handleSkillInstall(
      { slug: '../evil', files: [{ name: 'file.md', content: 'x' }], agentHome: tmpDir },
      ctx, deps
    );
    expect(result.success).toBe(false);
    expect(result.error!.message).toContain('Invalid skill slug');
  });

  it('should return error for slug starting with dot', async () => {
    const result = await handleSkillInstall(
      { slug: '.hidden', files: [{ name: 'file.md', content: 'x' }], agentHome: tmpDir },
      ctx, deps
    );
    expect(result.success).toBe(false);
  });

  it('should return error when files array is empty', async () => {
    const result = await handleSkillInstall(
      { slug: 'test', files: [], agentHome: tmpDir },
      ctx, deps
    );
    expect(result.success).toBe(false);
    expect(result.error!.message).toContain('Files array');
  });

  it('should return error for file name with path traversal', async () => {
    const result = await handleSkillInstall(
      { slug: 'test', files: [{ name: '../escape.md', content: 'x' }], agentHome: tmpDir },
      ctx, deps
    );
    expect(result.success).toBe(false);
    expect(result.error!.message).toContain('Invalid file name');
  });

  it('should create skill directory and write files', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    const result = await handleSkillInstall(
      {
        slug: 'my-skill',
        files: [
          { name: 'skill.md', content: '# My Skill' },
          { name: 'lib/utils.js', content: 'module.exports = {}' },
        ],
        agentHome: tmpDir,
        skillsDir,
      },
      ctx, deps
    );
    expect(result.success).toBe(true);
    expect(result.data!.installed).toBe(true);
    expect(result.data!.filesWritten).toBe(2);
    expect(fs.existsSync(path.join(skillsDir, 'my-skill', 'skill.md'))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, 'my-skill', 'lib', 'utils.js'))).toBe(true);
  });

  it('should handle base64 encoded content', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    const result = await handleSkillInstall(
      {
        slug: 'bin-skill',
        files: [{ name: 'data.bin', content: Buffer.from('binary data').toString('base64'), base64: true }],
        agentHome: tmpDir,
        skillsDir,
      },
      ctx, deps
    );
    expect(result.success).toBe(true);
    const content = fs.readFileSync(path.join(skillsDir, 'bin-skill', 'data.bin'));
    expect(content.toString()).toBe('binary data');
  });

  it('should create wrapper script when createWrapper is true', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    const result = await handleSkillInstall(
      {
        slug: 'wrapped-skill',
        files: [{ name: 'skill.md', content: 'x' }],
        agentHome: tmpDir,
        createWrapper: true,
        skillsDir,
      },
      ctx, deps
    );
    expect(result.success).toBe(true);
    expect(result.data!.wrapperPath).toBeDefined();
    const wrapperContent = fs.readFileSync(result.data!.wrapperPath!, 'utf-8');
    expect(wrapperContent).toContain('#!/bin/bash');
    expect(wrapperContent).toContain('wrapped-skill');
  });

  it('should return error for file without name', async () => {
    const result = await handleSkillInstall(
      { slug: 'test', files: [{ name: '', content: 'x' }], agentHome: tmpDir },
      ctx, deps
    );
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1003);
    expect(result.error!.message).toContain('must have a name');
  });

  it('should include warnings when chmod fails', async () => {
    const { execSync } = require('node:child_process');
    (execSync as jest.Mock).mockImplementation(() => { throw new Error('chmod failed'); });
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

    const skillsDir = path.join(tmpDir, 'skills');
    const result = await handleSkillInstall(
      {
        slug: 'warn-skill',
        files: [{ name: 'skill.md', content: 'x' }],
        agentHome: tmpDir,
        skillsDir,
      },
      ctx, deps
    );
    expect(result.success).toBe(true);
    expect(result.data!.warnings).toBeDefined();
    expect(result.data!.warnings!.length).toBeGreaterThan(0);
    consoleSpy.mockRestore();
  });
});

describe('handleSkillUninstall', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('should return error for invalid slug', async () => {
    const result = await handleSkillUninstall(
      { slug: '../evil', agentHome: tmpDir },
      ctx, deps
    );
    expect(result.success).toBe(false);
  });

  it('should remove skill directory', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    const skillDir = path.join(skillsDir, 'test-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'skill.md'), 'x');

    const result = await handleSkillUninstall(
      { slug: 'test-skill', agentHome: tmpDir, skillsDir },
      ctx, deps
    );
    expect(result.success).toBe(true);
    expect(result.data!.uninstalled).toBe(true);
    expect(fs.existsSync(skillDir)).toBe(false);
  });

  it('should remove wrapper when removeWrapper is true', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const binDir = path.join(tmpDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'test-skill'), '#!/bin/bash');

    const result = await handleSkillUninstall(
      { slug: 'test-skill', agentHome: tmpDir, removeWrapper: true, skillsDir },
      ctx, deps
    );
    expect(result.success).toBe(true);
    expect(result.data!.wrapperRemoved).toBe(true);
    expect(fs.existsSync(path.join(binDir, 'test-skill'))).toBe(false);
  });

  it('should report wrapperRemoved:false when wrapper does not exist', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    const result = await handleSkillUninstall(
      { slug: 'no-wrapper', agentHome: tmpDir, removeWrapper: true, skillsDir },
      ctx, deps
    );
    expect(result.success).toBe(true);
    expect(result.data!.wrapperRemoved).toBe(false);
  });

  it('should handle non-existent skill directory gracefully', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    const result = await handleSkillUninstall(
      { slug: 'nonexistent', agentHome: tmpDir, skillsDir },
      ctx, deps
    );
    expect(result.success).toBe(true);
  });

  it('should return error when agentHome is missing', async () => {
    const result = await handleSkillUninstall(
      { slug: 'test', agentHome: '' },
      ctx, deps
    );
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1003);
    expect(result.error!.message).toContain('agentHome');
  });
});
