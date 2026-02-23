import {
  generateAgentProfile,
  generateOperationProfile,
} from '../../enforcement/seatbelt';

describe('generateAgentProfile', () => {
  const defaultOptions = {
    workspacePath: '/Users/ash_default_agent/workspace',
    socketPath: '/Users/ash_default_agent/.agenshield/run/agenshield.sock',
    agentHome: '/Users/ash_default_agent',
  };

  it('returns a string', () => {
    const profile = generateAgentProfile(defaultOptions);

    expect(typeof profile).toBe('string');
    expect(profile.length).toBeGreaterThan(0);
  });

  it('has balanced parentheses', () => {
    const profile = generateAgentProfile(defaultOptions);
    let depth = 0;

    for (const char of profile) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }

    expect(depth).toBe(0);
  });

  it('contains (version 1) declaration', () => {
    const profile = generateAgentProfile(defaultOptions);

    expect(profile).toContain('(version 1)');
  });

  it('contains deny default rule', () => {
    const profile = generateAgentProfile(defaultOptions);

    expect(profile).toContain('(deny default)');
  });

  it('contains deny rules for system binaries', () => {
    const profile = generateAgentProfile(defaultOptions);

    expect(profile).toContain('(deny file-read*');
    expect(profile).toContain('/usr/bin');
    expect(profile).toContain('/usr/sbin');
  });

  it('contains allow rules for workspace', () => {
    const profile = generateAgentProfile(defaultOptions);

    expect(profile).toContain('(allow file-read* file-write*');
    expect(profile).toContain(defaultOptions.workspacePath);
  });

  it('contains network denial', () => {
    const profile = generateAgentProfile(defaultOptions);

    expect(profile).toContain('(deny network*)');
  });

  it('allows unix socket communication', () => {
    const profile = generateAgentProfile(defaultOptions);

    expect(profile).toContain('(allow network-outbound');
    expect(profile).toContain(defaultOptions.socketPath);
  });

  it('includes agentHome in per-target rules', () => {
    const profile = generateAgentProfile(defaultOptions);

    expect(profile).toContain(defaultOptions.agentHome!);
  });

  it('contains deny rules for agent-owned directories', () => {
    const profile = generateAgentProfile(defaultOptions);

    expect(profile).toContain(
      `(deny file-write* (subpath "${defaultOptions.agentHome}/bin"))`,
    );
    expect(profile).toContain(
      `(deny file-write* (subpath "${defaultOptions.agentHome}/.openclaw"))`,
    );
  });

  it('includes additional read paths when provided', () => {
    const profile = generateAgentProfile({
      ...defaultOptions,
      additionalReadPaths: ['/extra/path1', '/extra/path2'],
    });

    expect(profile).toContain(
      '(allow file-read* (subpath "/extra/path1"))',
    );
    expect(profile).toContain(
      '(allow file-read* (subpath "/extra/path2"))',
    );
  });
});

describe('generateOperationProfile', () => {
  it('generates file_read profile', () => {
    const profile = generateOperationProfile('file_read', '/test/path');

    expect(profile).toContain('(version 1)');
    expect(profile).toContain('(deny default)');
    expect(profile).toContain('/test/path');
    expect(profile).toContain('(deny network*)');
  });

  it('generates file_write profile', () => {
    const profile = generateOperationProfile('file_write', '/test/path');

    expect(profile).toContain('(allow file-read* file-write*');
    expect(profile).toContain('/test/path');
  });

  it('generates http_request profile', () => {
    const profile = generateOperationProfile('http_request', 'api.example.com');

    expect(profile).toContain('(allow network-outbound');
    expect(profile).toContain('api.example.com');
  });

  it('generates exec profile', () => {
    const profile = generateOperationProfile('exec', '/usr/local/bin/node');

    expect(profile).toContain('(allow process-exec');
    expect(profile).toContain('/usr/local/bin/node');
  });

  it('generates minimal profile for unknown operation', () => {
    const profile = generateOperationProfile('unknown');

    expect(profile).toContain('(version 1)');
    expect(profile).toContain('(deny default)');
  });
});
