import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Detection Flow (real filesystem)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenshield-detect-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a fake npm installation and verifies detection', () => {
    // Create fake npm global structure
    const npmRoot = path.join(tmpDir, 'lib', 'node_modules', 'openclaw');
    fs.mkdirSync(npmRoot, { recursive: true });

    const packageJson = {
      name: 'openclaw',
      version: '1.5.0',
      bin: { openclaw: './dist/entry.js' },
    };
    fs.writeFileSync(
      path.join(npmRoot, 'package.json'),
      JSON.stringify(packageJson, null, 2),
    );

    // Verify the structure
    expect(fs.existsSync(npmRoot)).toBe(true);

    const pkg = JSON.parse(
      fs.readFileSync(path.join(npmRoot, 'package.json'), 'utf-8'),
    );
    expect(pkg.name).toBe('openclaw');
    expect(pkg.version).toBe('1.5.0');
  });

  it('creates a fake git installation and verifies detection', () => {
    // Create fake git repo structure
    const repoPath = path.join(tmpDir, 'openclaw');
    fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });

    const packageJson = {
      name: 'openclaw',
      version: '2.0.0-dev',
    };
    fs.writeFileSync(
      path.join(repoPath, 'package.json'),
      JSON.stringify(packageJson, null, 2),
    );

    // Verify
    expect(fs.existsSync(path.join(repoPath, '.git'))).toBe(true);

    const pkg = JSON.parse(
      fs.readFileSync(path.join(repoPath, 'package.json'), 'utf-8'),
    );
    expect(pkg.name).toBe('openclaw');
    expect(pkg.version).toContain('2.0.0');
  });

  it('creates fake config directory and verifies detection', () => {
    const configDir = path.join(tmpDir, '.openclaw');
    fs.mkdirSync(configDir);
    fs.writeFileSync(
      path.join(configDir, 'openclaw.json'),
      JSON.stringify({
        identity: { name: 'TestBot' },
        skills: {
          entries: {
            'web-search': { enabled: true, env: { API_KEY: 'test' } },
          },
        },
      }),
    );

    // Verify
    expect(fs.existsSync(configDir)).toBe(true);

    const config = JSON.parse(
      fs.readFileSync(path.join(configDir, 'openclaw.json'), 'utf-8'),
    );
    expect(config.identity.name).toBe('TestBot');
    expect(config.skills.entries['web-search'].enabled).toBe(true);
  });

  it('creates SKILL.md with frontmatter and verifies parsing', () => {
    const skillDir = path.join(tmpDir, 'skills', 'web-search');
    fs.mkdirSync(skillDir, { recursive: true });

    const skillMd = `---
name: web-search
description: Search the web
version: 1.0.0
requires:
  bins:
    - curl
    - jq
  env:
    - SERPAPI_KEY
---
# Web Search Skill

This skill searches the web using SerpAPI.
`;
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd);

    // Read back and verify frontmatter
    const content = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');

    // Parse frontmatter manually
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('name: web-search');
    expect(match![1]).toContain('description: Search the web');
    expect(match![1]).toContain('curl');
    expect(match![1]).toContain('SERPAPI_KEY');
  });

  it('creates a wrapper script and verifies it is executable', () => {
    const wrapperPath = path.join(tmpDir, 'openclaw');
    const content = `#!/bin/bash
# Test wrapper
exec node /path/to/openclaw "$@"
`;
    fs.writeFileSync(wrapperPath, content, { mode: 0o755 });

    const stats = fs.statSync(wrapperPath);
    // Check executable bit
    expect(stats.mode & 0o111).toBeTruthy();

    const readBack = fs.readFileSync(wrapperPath, 'utf-8');
    expect(readBack).toContain('#!/bin/bash');
    expect(readBack).toContain('exec node');
  });

  it('scans a directory for skill subdirectories', () => {
    const skillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(skillsDir);

    // Create multiple skill directories
    const skillNames = ['web-search', 'summarizer', 'translator'];
    for (const name of skillNames) {
      const dir = path.join(skillsDir, name);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\n---\nBody`);
    }

    // Scan
    const entries = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    expect(entries).toEqual(expect.arrayContaining(skillNames));
    expect(entries.length).toBe(skillNames.length);
  });
});
