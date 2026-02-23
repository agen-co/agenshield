import {
  PROXIED_COMMANDS,
  shieldExecPath,
  generateShieldExecContent,
} from '../../shell/shield-exec';
import {
  SHIELD_EXEC_PATH,
  SHIELD_EXEC_CONTENT,
} from '../../legacy';

describe('PROXIED_COMMANDS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(PROXIED_COMMANDS)).toBe(true);
    expect(PROXIED_COMMANDS.length).toBeGreaterThan(0);
  });

  it('contains core commands (curl, git, npm)', () => {
    expect(PROXIED_COMMANDS).toContain('curl');
    expect(PROXIED_COMMANDS).toContain('git');
    expect(PROXIED_COMMANDS).toContain('npm');
  });

  it('contains ssh and scp', () => {
    expect(PROXIED_COMMANDS).toContain('ssh');
    expect(PROXIED_COMMANDS).toContain('scp');
  });

  it('contains brew', () => {
    expect(PROXIED_COMMANDS).toContain('brew');
  });

  it('contains shieldctl and agenco', () => {
    expect(PROXIED_COMMANDS).toContain('shieldctl');
    expect(PROXIED_COMMANDS).toContain('agenco');
  });
});

describe('shieldExecPath', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns a path string', () => {
    const result = shieldExecPath('/Users/testuser');

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes hostHome in the path when provided', () => {
    const result = shieldExecPath('/Users/testuser');

    expect(result).toBe('/Users/testuser/.agenshield/bin/shield-exec');
  });

  it('falls back to HOME env when no hostHome is provided', () => {
    process.env = { ...originalEnv, HOME: '/Users/envuser' };

    const result = shieldExecPath();

    expect(result).toBe('/Users/envuser/.agenshield/bin/shield-exec');
  });

  it('falls back to legacy path when no home is available', () => {
    process.env = { ...originalEnv };
    delete process.env.HOME;

    const result = shieldExecPath('');

    expect(result).toBe(SHIELD_EXEC_PATH);
  });
});

describe('SHIELD_EXEC_PATH (legacy)', () => {
  it('points to /opt/agenshield/bin/shield-exec', () => {
    expect(SHIELD_EXEC_PATH).toBe('/opt/agenshield/bin/shield-exec');
  });
});

describe('generateShieldExecContent', () => {
  it('returns valid script content', () => {
    const content = generateShieldExecContent('/Users/testuser');

    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
  });

  it('replaces shebang with correct node-bin path', () => {
    const content = generateShieldExecContent('/Users/testuser');

    expect(content).toContain('/Users/testuser/.agenshield/bin/node-bin');
  });

  it('contains import statements', () => {
    const content = generateShieldExecContent('/Users/testuser');

    expect(content).toContain("import path from 'node:path'");
    expect(content).toContain("import net from 'node:net'");
  });

  it('contains socket communication logic', () => {
    const content = generateShieldExecContent('/Users/testuser');

    expect(content).toContain('sendRequest');
    expect(content).toContain('jsonrpc');
  });
});

describe('SHIELD_EXEC_CONTENT', () => {
  it('starts with a shebang', () => {
    expect(SHIELD_EXEC_CONTENT.startsWith('#!')).toBe(true);
  });

  it('contains the main function', () => {
    expect(SHIELD_EXEC_CONTENT).toContain('async function main()');
  });
});
