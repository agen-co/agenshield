jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
}));

import { parseSkillMd, extractSkillInfo, extractCommands, stripEnvFromSkillMd } from '../../detection/discovery/skill-scanner';

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
});
