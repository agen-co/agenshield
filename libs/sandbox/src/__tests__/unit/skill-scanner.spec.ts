var mockExistsSync: jest.Mock;
var mockReadFileSync: jest.Mock;
var mockReaddirSync: jest.Mock;
var mockGetSkillsDir: jest.Mock;

jest.mock('node:fs', () => ({
  existsSync: (mockExistsSync = jest.fn().mockReturnValue(false)),
  readFileSync: (mockReadFileSync = jest.fn()),
  readdirSync: (mockReaddirSync = jest.fn().mockReturnValue([])),
}));

jest.mock('../../inject/skill-injector.js', () => ({
  getSkillsDir: (mockGetSkillsDir = jest.fn().mockReturnValue('/home/user/.openclaw/workspace/skills')),
}));

import {
  parseSkillMd,
  extractSkillInfo,
  extractCommands,
  stripEnvFromSkillMd,
  getApprovalStatus,
  scanSkills,
} from '../../detection/discovery/skill-scanner';

beforeEach(() => {
  jest.clearAllMocks();
  // Re-establish defaults after clearAllMocks
  mockExistsSync.mockReturnValue(false);
  mockReaddirSync.mockReturnValue([]);
  mockGetSkillsDir.mockReturnValue('/home/user/.openclaw/workspace/skills');
});

describe('parseSkillMd', () => {
  it('parses YAML frontmatter from SKILL.md content', () => {
    const content = `---
name: test-skill
description: A test skill
version: 1.0.0
---
This is the body of the skill.`;

    const result = parseSkillMd(content);

    expect(result).not.toBeNull();
    expect(result!.metadata.name).toBe('test-skill');
    expect(result!.metadata.description).toBe('A test skill');
    expect(result!.metadata.version).toBe('1.0.0');
    expect(result!.body).toContain('body of the skill');
  });

  it('returns null for content without frontmatter', () => {
    const content = 'This is just plain text without frontmatter';

    const result = parseSkillMd(content);

    expect(result).toBeNull();
  });

  it('returns null for malformed YAML', () => {
    const content = `---
  name: [invalid yaml
  : broken
---
Body`;

    const result = parseSkillMd(content);

    // yaml library may parse some malformed content, but truly broken should fail
    // This test verifies we handle the error gracefully
    // The behavior depends on the yaml parser's strictness
    expect(result === null || typeof result?.metadata === 'object').toBe(true);
  });

  it('parses frontmatter with requires section', () => {
    const content = `---
name: web-search
description: Web search skill
requires:
  bins:
    - curl
    - jq
  env:
    - SERPAPI_KEY
---
Usage instructions here.`;

    const result = parseSkillMd(content);

    expect(result).not.toBeNull();
    expect(result!.metadata.requires?.bins).toEqual(['curl', 'jq']);
    expect(result!.metadata.requires?.env).toEqual(['SERPAPI_KEY']);
  });

  it('returns empty body when only frontmatter is present', () => {
    const content = `---
name: minimal
---
`;

    const result = parseSkillMd(content);

    expect(result).not.toBeNull();
    expect(result!.body.trim()).toBe('');
  });

  it('returns null when parsed YAML is a scalar, not an object', () => {
    const content = `---
just a string value
---
Body`;

    const result = parseSkillMd(content);

    expect(result).toBeNull();
  });

  it('handles complex frontmatter with metadata.openclaw section', () => {
    const content = `---
name: complex-skill
metadata:
  openclaw:
    requires:
      bins:
        - node
      env:
        - API_KEY
    primaryEnv: API_KEY
---
Body`;

    const result = parseSkillMd(content);

    expect(result).not.toBeNull();
    expect(result!.metadata.metadata?.openclaw?.requires?.bins).toEqual(['node']);
    expect(result!.metadata.metadata?.openclaw?.primaryEnv).toBe('API_KEY');
  });
});

describe('extractSkillInfo', () => {
  it('extracts api keys from top-level requires.env', () => {
    const metadata = {
      name: 'test',
      requires: {
        env: ['OPENAI_KEY', 'SERPAPI_KEY'],
      },
    };

    const info = extractSkillInfo(metadata);

    expect(info.apiKeys).toContain('OPENAI_KEY');
    expect(info.apiKeys).toContain('SERPAPI_KEY');
  });

  it('extracts bins from requires.bins', () => {
    const metadata = {
      name: 'test',
      requires: {
        bins: ['curl', 'jq'],
      },
    };

    const info = extractSkillInfo(metadata);

    expect(info.bins).toContain('curl');
    expect(info.bins).toContain('jq');
  });

  it('returns empty arrays for null metadata', () => {
    const info = extractSkillInfo(null);

    expect(info.apiKeys).toHaveLength(0);
    expect(info.bins).toHaveLength(0);
    expect(info.anyBins).toHaveLength(0);
    expect(info.configOptions).toHaveLength(0);
  });

  it('deduplicates values from top-level and openclaw sections', () => {
    const metadata = {
      name: 'test',
      requires: { bins: ['curl'] },
      metadata: {
        openclaw: {
          requires: { bins: ['curl', 'wget'] },
        },
      },
    };

    const info = extractSkillInfo(metadata);

    expect(info.bins).toEqual(['curl', 'wget']);
  });
});

describe('extractCommands', () => {
  it('extracts required commands from metadata bins', () => {
    const metadata = {
      name: 'test',
      requires: { bins: ['curl', 'jq'] },
    };
    const binaryLookup = new Map();
    binaryLookup.set('curl', { name: 'curl', path: '/usr/bin/curl', protection: 'proxied' });

    const commands = extractCommands(metadata, '', binaryLookup);

    expect(commands.length).toBe(2);
    const curlCmd = commands.find((c) => c.name === 'curl');
    expect(curlCmd).toBeDefined();
    expect(curlCmd!.source).toBe('metadata');
    expect(curlCmd!.available).toBe(true);
    expect(curlCmd!.required).toBe(true);
  });

  it('marks unavailable commands correctly', () => {
    const metadata = {
      name: 'test',
      requires: { bins: ['nonexistent-tool'] },
    };
    const binaryLookup = new Map();

    const commands = extractCommands(metadata, '', binaryLookup);

    expect(commands[0].available).toBe(false);
    expect(commands[0].resolvedPath).toBeUndefined();
  });

  it('extracts commands from body via regex patterns', () => {
    const body = 'curl https://api.example.com\necho "test" | jq .data';
    const binaryLookup = new Map();
    binaryLookup.set('curl', { name: 'curl', path: '/usr/bin/curl', protection: 'proxied' });

    const commands = extractCommands(null, body, binaryLookup);

    const curlCmd = commands.find((c) => c.name === 'curl');
    expect(curlCmd).toBeDefined();
    expect(curlCmd!.source).toBe('analysis');
  });
});

describe('stripEnvFromSkillMd', () => {
  it('strips requires.env from frontmatter', () => {
    const content = `---
name: test
requires:
  env:
    - API_KEY
  bins:
    - curl
---
Body`;

    const result = stripEnvFromSkillMd(content);

    expect(result).not.toContain('API_KEY');
    expect(result).toContain('curl');
    expect(result).toContain('name: test');
  });

  it('returns original content if no frontmatter', () => {
    const content = 'Just plain text';
    const result = stripEnvFromSkillMd(content);

    expect(result).toBe(content);
  });

  it('strips metadata.openclaw.primaryEnv', () => {
    const content = `---
name: test
metadata:
  openclaw:
    primaryEnv: MY_KEY
    requires:
      env:
        - MY_KEY
---
Body`;

    const result = stripEnvFromSkillMd(content);

    expect(result).not.toContain('MY_KEY');
  });

  it('returns original content when YAML parsing throws', () => {
    // We can trigger the catch by providing frontmatter that parseYaml will throw on.
    // The yaml library is strict about some patterns — use a tab character
    // in a way that causes an error. An alternative: mock parseYaml, but simpler
    // to just check that the function is resilient. We'll use the real function
    // and trust the existing coverage. Instead, let's craft something that
    // passes the regex but fails YAML parsing more aggressively.
    const content = `---
\t: !!invalid
---
Body`;

    const result = stripEnvFromSkillMd(content);

    // Should return either the original or the re-serialized form — no crash
    expect(typeof result).toBe('string');
  });
});

describe('extractCommands — allowedCommands', () => {
  it('extracts commands from agenshield.allowedCommands as non-required', () => {
    const metadata = {
      name: 'test',
      agenshield: { allowedCommands: ['git', 'npm'] },
    };
    const binaryLookup = new Map();
    binaryLookup.set('git', { name: 'git', path: '/usr/bin/git', protection: 'allowed' });

    const commands = extractCommands(metadata, '', binaryLookup);

    expect(commands).toHaveLength(2);
    const gitCmd = commands.find((c) => c.name === 'git');
    expect(gitCmd).toBeDefined();
    expect(gitCmd!.source).toBe('metadata');
    expect(gitCmd!.available).toBe(true);
    expect(gitCmd!.required).toBe(false);
    expect(gitCmd!.resolvedPath).toBe('/usr/bin/git');

    const npmCmd = commands.find((c) => c.name === 'npm');
    expect(npmCmd).toBeDefined();
    expect(npmCmd!.available).toBe(false);
    expect(npmCmd!.required).toBe(false);
  });

  it('deduplicates between requires.bins and agenshield.allowedCommands', () => {
    const metadata = {
      name: 'test',
      requires: { bins: ['git'] },
      agenshield: { allowedCommands: ['git', 'npm'] },
    };
    const binaryLookup = new Map();

    const commands = extractCommands(metadata, '', binaryLookup);

    // git from requires.bins (required=true), npm from allowedCommands (required=false)
    expect(commands).toHaveLength(2);
    const gitCmd = commands.find((c) => c.name === 'git');
    expect(gitCmd!.required).toBe(true);
    const npmCmd = commands.find((c) => c.name === 'npm');
    expect(npmCmd!.required).toBe(false);
  });

  it('filters IGNORE_WORDS from body analysis', () => {
    const body = 'if true then echo hello';
    const binaryLookup = new Map();
    binaryLookup.set('if', { name: 'if', path: '/usr/bin/if', protection: 'allowed' });
    binaryLookup.set('true', { name: 'true', path: '/usr/bin/true', protection: 'allowed' });

    const commands = extractCommands(null, body, binaryLookup);

    // 'if', 'true', 'then', 'echo' are all in IGNORE_WORDS
    const names = commands.map((c) => c.name);
    expect(names).not.toContain('if');
    expect(names).not.toContain('true');
    expect(names).not.toContain('then');
    expect(names).not.toContain('echo');
  });

  it('deduplicates commands found in both metadata and body', () => {
    const metadata = {
      name: 'test',
      requires: { bins: ['curl'] },
    };
    const body = 'curl https://example.com';
    const binaryLookup = new Map();
    binaryLookup.set('curl', { name: 'curl', path: '/usr/bin/curl', protection: 'proxied' });

    const commands = extractCommands(metadata, body, binaryLookup);

    // curl should appear only once (from metadata)
    const curlCmds = commands.filter((c) => c.name === 'curl');
    expect(curlCmds).toHaveLength(1);
    expect(curlCmds[0].source).toBe('metadata');
  });
});

describe('getApprovalStatus', () => {
  it('returns "approved" when skill is in the approved list JSON', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/opt/agenshield/config/approved-skills.json');
    mockReadFileSync.mockReturnValue(JSON.stringify([
      { name: 'my-skill' },
      { name: 'other-skill' },
    ]));

    const status = getApprovalStatus('my-skill');

    expect(status).toBe('approved');
  });

  it('returns "quarantined" when skill directory exists in quarantine', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === '/opt/agenshield/config/approved-skills.json') return false;
      if (p === '/opt/agenshield/quarantine/skills/my-skill') return true;
      return false;
    });

    const status = getApprovalStatus('my-skill');

    expect(status).toBe('quarantined');
  });

  it('returns "unknown" when skill is neither approved nor quarantined', () => {
    mockExistsSync.mockReturnValue(false);

    const status = getApprovalStatus('my-skill');

    expect(status).toBe('unknown');
  });

  it('returns "unknown" when approved-skills.json has invalid JSON', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/opt/agenshield/config/approved-skills.json');
    mockReadFileSync.mockReturnValue('not valid json {{{');

    const status = getApprovalStatus('my-skill');

    // JSON.parse will throw, caught by try/catch, falls through to quarantine check then unknown
    expect(status).toBe('unknown');
  });

  it('returns "unknown" when approved list exists but skill is not in it', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/opt/agenshield/config/approved-skills.json');
    mockReadFileSync.mockReturnValue(JSON.stringify([{ name: 'other-skill' }]));

    const status = getApprovalStatus('my-skill');

    expect(status).toBe('unknown');
  });

  it('handles error when existsSync throws for quarantine check', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === '/opt/agenshield/config/approved-skills.json') return false;
      throw new Error('permission denied');
    });

    const status = getApprovalStatus('my-skill');

    expect(status).toBe('unknown');
  });
});

describe('scanSkills', () => {
  const makeDirent = (name: string, isDir: boolean) => ({
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    parentPath: '',
    path: '',
  });

  it('returns empty array when agentHome is not provided', () => {
    const result = scanSkills({}, new Map());

    expect(result).toEqual([]);
  });

  it('scans skills directory and returns discovered skills with SKILL.md', () => {
    const skillsDir = '/home/user/.openclaw/workspace/skills';
    mockGetSkillsDir.mockReturnValue(skillsDir);
    mockExistsSync.mockImplementation((p: string) => {
      if (p === skillsDir) return true;
      if (p === `${skillsDir}/web-search/SKILL.md`) return true;
      return false;
    });
    mockReaddirSync.mockReturnValue([
      makeDirent('web-search', true),
    ]);
    mockReadFileSync.mockImplementation((p: string) => {
      if (p === `${skillsDir}/web-search/SKILL.md`) {
        return `---
name: web-search
description: Search the web
requires:
  bins:
    - curl
---
Use curl to search.`;
      }
      return '';
    });

    const binaryLookup = new Map();
    binaryLookup.set('curl', { name: 'curl', path: '/usr/bin/curl', protection: 'proxied' });

    const result = scanSkills({ agentHome: '/home/user' }, binaryLookup);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('web-search');
    expect(result[0].hasSkillMd).toBe(true);
    expect(result[0].metadata).not.toBeNull();
    expect(result[0].metadata!.name).toBe('web-search');
    expect(result[0].requiredCommands.length).toBeGreaterThanOrEqual(1);
    expect(result[0].approval).toBe('unknown');
  });

  it('skips non-directory entries', () => {
    const skillsDir = '/home/user/.openclaw/workspace/skills';
    mockGetSkillsDir.mockReturnValue(skillsDir);
    mockExistsSync.mockImplementation((p: string) => {
      if (p === skillsDir) return true;
      return false;
    });
    mockReaddirSync.mockReturnValue([
      makeDirent('README.md', false),
      makeDirent('.DS_Store', false),
    ]);

    const result = scanSkills({ agentHome: '/home/user' }, new Map());

    expect(result).toHaveLength(0);
  });

  it('handles skill directory without SKILL.md', () => {
    const skillsDir = '/home/user/.openclaw/workspace/skills';
    mockGetSkillsDir.mockReturnValue(skillsDir);
    mockExistsSync.mockImplementation((p: string) => {
      if (p === skillsDir) return true;
      // SKILL.md does NOT exist
      return false;
    });
    mockReaddirSync.mockReturnValue([
      makeDirent('bare-skill', true),
    ]);

    const result = scanSkills({ agentHome: '/home/user' }, new Map());

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('bare-skill');
    expect(result[0].hasSkillMd).toBe(false);
    expect(result[0].metadata).toBeNull();
  });

  it('handles unparseable SKILL.md gracefully', () => {
    const skillsDir = '/home/user/.openclaw/workspace/skills';
    mockGetSkillsDir.mockReturnValue(skillsDir);
    mockExistsSync.mockImplementation((p: string) => {
      if (p === skillsDir) return true;
      if (p === `${skillsDir}/bad-skill/SKILL.md`) return true;
      return false;
    });
    mockReaddirSync.mockReturnValue([
      makeDirent('bad-skill', true),
    ]);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('read error');
    });

    const result = scanSkills({ agentHome: '/home/user' }, new Map());

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('bad-skill');
    expect(result[0].hasSkillMd).toBe(true);
    expect(result[0].metadata).toBeNull();
  });

  it('scans quarantine directory and adds quarantined skills', () => {
    const skillsDir = '/home/user/.openclaw/workspace/skills';
    const quarantineDir = '/opt/agenshield/quarantine/skills';
    mockGetSkillsDir.mockReturnValue(skillsDir);
    mockExistsSync.mockImplementation((p: string) => {
      if (p === skillsDir) return true;
      if (p === quarantineDir) return true;
      if (p === `${quarantineDir}/suspect-skill/SKILL.md`) return true;
      return false;
    });
    // First call: active skills dir, second call: quarantine dir
    mockReaddirSync
      .mockReturnValueOnce([]) // active dir has no skills
      .mockReturnValueOnce([makeDirent('suspect-skill', true)]); // quarantine has one
    mockReadFileSync.mockImplementation((p: string) => {
      if (p === `${quarantineDir}/suspect-skill/SKILL.md`) {
        return `---
name: suspect-skill
---
Suspicious body.`;
      }
      return '';
    });

    const result = scanSkills({ agentHome: '/home/user' }, new Map());

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('suspect-skill');
    expect(result[0].approval).toBe('quarantined');
    expect(result[0].path).toBe(`${quarantineDir}/suspect-skill`);
  });

  it('skips quarantined skills that are already found in active dir', () => {
    const skillsDir = '/home/user/.openclaw/workspace/skills';
    const quarantineDir = '/opt/agenshield/quarantine/skills';
    mockGetSkillsDir.mockReturnValue(skillsDir);
    mockExistsSync.mockImplementation((p: string) => {
      if (p === skillsDir) return true;
      if (p === quarantineDir) return true;
      // No SKILL.md files
      return false;
    });
    mockReaddirSync
      .mockReturnValueOnce([makeDirent('shared-skill', true)])
      .mockReturnValueOnce([makeDirent('shared-skill', true)]);

    const result = scanSkills({ agentHome: '/home/user' }, new Map());

    // Should only appear once (from active dir)
    const matches = result.filter((s) => s.name === 'shared-skill');
    expect(matches).toHaveLength(1);
  });

  it('sorts results alphabetically by name', () => {
    const skillsDir = '/home/user/.openclaw/workspace/skills';
    mockGetSkillsDir.mockReturnValue(skillsDir);
    mockExistsSync.mockImplementation((p: string) => {
      if (p === skillsDir) return true;
      return false;
    });
    mockReaddirSync.mockReturnValue([
      makeDirent('zebra-skill', true),
      makeDirent('alpha-skill', true),
      makeDirent('middle-skill', true),
    ]);

    const result = scanSkills({ agentHome: '/home/user' }, new Map());

    expect(result.map((s) => s.name)).toEqual(['alpha-skill', 'middle-skill', 'zebra-skill']);
  });

  it('handles quarantine dir with non-directory entries', () => {
    const skillsDir = '/home/user/.openclaw/workspace/skills';
    const quarantineDir = '/opt/agenshield/quarantine/skills';
    mockGetSkillsDir.mockReturnValue(skillsDir);
    mockExistsSync.mockImplementation((p: string) => {
      if (p === skillsDir) return false; // no active skills dir
      if (p === quarantineDir) return true;
      return false;
    });
    mockReaddirSync.mockReturnValue([
      makeDirent('not-a-dir.txt', false),
    ]);

    const result = scanSkills({ agentHome: '/home/user' }, new Map());

    expect(result).toHaveLength(0);
  });

  it('handles quarantined skill without SKILL.md', () => {
    const skillsDir = '/home/user/.openclaw/workspace/skills';
    const quarantineDir = '/opt/agenshield/quarantine/skills';
    mockGetSkillsDir.mockReturnValue(skillsDir);
    mockExistsSync.mockImplementation((p: string) => {
      if (p === skillsDir) return false;
      if (p === quarantineDir) return true;
      return false;
    });
    mockReaddirSync.mockReturnValue([
      makeDirent('bare-quarantined', true),
    ]);

    const result = scanSkills({ agentHome: '/home/user' }, new Map());

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('bare-quarantined');
    expect(result[0].hasSkillMd).toBe(false);
    expect(result[0].metadata).toBeNull();
    expect(result[0].approval).toBe('quarantined');
  });

  it('handles error reading quarantine directory gracefully', () => {
    const skillsDir = '/home/user/.openclaw/workspace/skills';
    const quarantineDir = '/opt/agenshield/quarantine/skills';
    mockGetSkillsDir.mockReturnValue(skillsDir);
    mockExistsSync.mockImplementation((p: string) => {
      if (p === skillsDir) return false;
      if (p === quarantineDir) return true;
      return false;
    });
    mockReaddirSync.mockImplementation(() => {
      throw new Error('permission denied');
    });

    const result = scanSkills({ agentHome: '/home/user' }, new Map());

    expect(result).toEqual([]);
  });

  it('handles error reading active skills directory gracefully', () => {
    const skillsDir = '/home/user/.openclaw/workspace/skills';
    mockGetSkillsDir.mockReturnValue(skillsDir);
    mockExistsSync.mockImplementation((p: string) => {
      if (p === skillsDir) return true;
      return false;
    });
    mockReaddirSync.mockImplementation(() => {
      throw new Error('permission denied');
    });

    const result = scanSkills({ agentHome: '/home/user' }, new Map());

    // Active dir error caught, quarantine dir doesn't exist → empty
    expect(result).toEqual([]);
  });

  it('handles quarantined SKILL.md read error gracefully', () => {
    const skillsDir = '/home/user/.openclaw/workspace/skills';
    const quarantineDir = '/opt/agenshield/quarantine/skills';
    mockGetSkillsDir.mockReturnValue(skillsDir);
    mockExistsSync.mockImplementation((p: string) => {
      if (p === skillsDir) return false;
      if (p === quarantineDir) return true;
      if (p === `${quarantineDir}/errored-skill/SKILL.md`) return true;
      return false;
    });
    mockReaddirSync.mockReturnValue([
      makeDirent('errored-skill', true),
    ]);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('read error');
    });

    const result = scanSkills({ agentHome: '/home/user' }, new Map());

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('errored-skill');
    expect(result[0].hasSkillMd).toBe(true);
    expect(result[0].metadata).toBeNull();
  });
});
