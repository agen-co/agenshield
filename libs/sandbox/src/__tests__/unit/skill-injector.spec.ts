jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}));

jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
  mkdirSync: jest.fn(),
  copyFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  chmodSync: jest.fn(),
  unlinkSync: jest.fn(),
  rmSync: jest.fn(),
}));

import * as fs from 'node:fs';
import { getSkillsDir, getAgenCoSkillPath, generateSkillWrapperScript } from '../../inject/skill-injector';

const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

describe('getSkillsDir', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns correct path based on home directory', () => {
    mockedExistsSync.mockReturnValue(false);

    const result = getSkillsDir('/Users/ash_default_agent');

    expect(result).toBe(
      '/Users/ash_default_agent/.openclaw/workspace/skills',
    );
  });

  it('prefers .openclaw/workspace/skills when parent exists', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === '/Users/agent/.openclaw/workspace';
    });

    const result = getSkillsDir('/Users/agent');

    expect(result).toBe('/Users/agent/.openclaw/workspace/skills');
  });

  it('falls back to .config/openclaw/skills when it exists', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === '/Users/agent/.config/openclaw') return true;
      return false;
    });

    const result = getSkillsDir('/Users/agent');

    expect(result).toBe('/Users/agent/.config/openclaw/skills');
  });

  it('returns first default path when nothing exists', () => {
    mockedExistsSync.mockReturnValue(false);

    const result = getSkillsDir('/Users/nobody');

    expect(result).toContain('.openclaw/workspace/skills');
  });
});

describe('getAgenCoSkillPath', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws when skill is not found at any path', () => {
    mockedExistsSync.mockReturnValue(false);

    expect(() => getAgenCoSkillPath()).toThrow('AgenCo skill not found');
  });

  it('returns path when SKILL.md exists at primary location', () => {
    const originalEnv = process.env['AGENSHIELD_AGENT_HOME'];
    process.env['AGENSHIELD_AGENT_HOME'] = '/Users/ash_default_agent';

    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) ===
        '/Users/ash_default_agent/.openclaw/workspace/skills/agenco/SKILL.md';
    });

    const result = getAgenCoSkillPath();

    expect(result).toBe(
      '/Users/ash_default_agent/.openclaw/workspace/skills/agenco',
    );

    process.env['AGENSHIELD_AGENT_HOME'] = originalEnv;
  });

  it('falls back to /opt/agenshield/skills/agenco', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === '/opt/agenshield/skills/agenco/SKILL.md';
    });

    const result = getAgenCoSkillPath();

    expect(result).toBe('/opt/agenshield/skills/agenco');
  });
});

describe('generateSkillWrapperScript', () => {
  it('returns a bash script with correct env vars', () => {
    const script = generateSkillWrapperScript(
      'test-skill',
      '/path/to/bin/test.js',
    );

    expect(script).toContain('#!/bin/bash');
    expect(script).toContain('AGENSHIELD_CONTEXT_TYPE=skill');
    expect(script).toContain('AGENSHIELD_SKILL_SLUG=test-skill');
    expect(script).toContain('exec "/path/to/bin/test.js" "$@"');
  });

  it('includes the skill slug in the comment', () => {
    const script = generateSkillWrapperScript(
      'agenco',
      '/skills/agenco/bin/agenco.js',
    );

    expect(script).toContain('skill wrapper for: agenco');
  });

  it('passes through all arguments with $@', () => {
    const script = generateSkillWrapperScript('skill', '/bin/skill');

    expect(script).toContain('"$@"');
  });
});
