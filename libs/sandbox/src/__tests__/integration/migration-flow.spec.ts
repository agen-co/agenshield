import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { sanitizeOpenClawConfig } from '../../backup/migration';

describe('Migration Flow (real filesystem)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenshield-migration-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a source config, sanitizes it, and writes the result', () => {
    const sourceConfig = {
      identity: { name: 'TestBot', emoji: 'shield' },
      skills: {
        entries: {
          'web-search': {
            enabled: true,
            env: { SERPAPI_KEY: 'sk-secret-123' },
            apiKey: 'OPENAI_KEY',
            timeout: 15000,
          },
          summarizer: {
            enabled: true,
            env: { SUMMARY_MODEL: 'gpt-4' },
            maxTokens: 4096,
          },
        },
      },
      gateway: { port: 3000 },
    };

    // Write source config
    const sourceDir = path.join(tmpDir, 'source');
    fs.mkdirSync(sourceDir, { recursive: true });
    const sourcePath = path.join(sourceDir, 'openclaw.json');
    fs.writeFileSync(sourcePath, JSON.stringify(sourceConfig, null, 2));

    // Read it back
    const raw = fs.readFileSync(sourcePath, 'utf-8');
    const parsed = JSON.parse(raw);

    // Sanitize
    const sanitized = sanitizeOpenClawConfig(parsed);

    // Write sanitized config
    const destDir = path.join(tmpDir, 'dest');
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, 'openclaw.json');
    fs.writeFileSync(destPath, JSON.stringify(sanitized, null, 2));

    // Read back sanitized config
    const sanitizedRaw = fs.readFileSync(destPath, 'utf-8');
    const sanitizedParsed = JSON.parse(sanitizedRaw);

    // Verify secrets removed
    const entries = sanitizedParsed.skills.entries;
    expect(entries['web-search']).not.toHaveProperty('env');
    expect(entries['web-search']).not.toHaveProperty('apiKey');
    expect(entries['summarizer']).not.toHaveProperty('env');

    // Verify non-secret fields preserved
    expect(entries['web-search'].enabled).toBe(true);
    expect(entries['web-search'].timeout).toBe(15000);
    expect(entries['summarizer'].enabled).toBe(true);
    expect(entries['summarizer'].maxTokens).toBe(4096);

    // Verify top-level sections preserved
    expect(sanitizedParsed.identity).toEqual({ name: 'TestBot', emoji: 'shield' });
    expect(sanitizedParsed.gateway).toEqual({ port: 3000 });
  });

  it('preserves top-level env while stripping skill-level env', () => {
    const config = {
      env: {
        OPENROUTER_API_KEY: 'or-xxx',
        DATABASE_URL: 'postgres://localhost/db',
      },
      skills: {
        entries: {
          'test-skill': {
            enabled: true,
            env: { SKILL_SECRET: 'should-be-stripped' },
          },
        },
      },
    };

    const sourcePath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(sourcePath, JSON.stringify(config));

    const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
    const sanitized = sanitizeOpenClawConfig(parsed);

    // Write and read back
    const destPath = path.join(tmpDir, 'clean-config.json');
    fs.writeFileSync(destPath, JSON.stringify(sanitized, null, 2));
    const result = JSON.parse(fs.readFileSync(destPath, 'utf-8'));

    // Top-level env preserved
    expect(result.env).toEqual({
      OPENROUTER_API_KEY: 'or-xxx',
      DATABASE_URL: 'postgres://localhost/db',
    });

    // Skill-level env stripped
    expect(result.skills.entries['test-skill']).not.toHaveProperty('env');
    expect(result.skills.entries['test-skill'].enabled).toBe(true);
  });

  it('handles config with no skills section', () => {
    const config = {
      identity: { name: 'SimpleBot' },
      gateway: { port: 8080 },
    };

    const sourcePath = path.join(tmpDir, 'simple.json');
    fs.writeFileSync(sourcePath, JSON.stringify(config));

    const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
    const sanitized = sanitizeOpenClawConfig(parsed);

    const destPath = path.join(tmpDir, 'clean-simple.json');
    fs.writeFileSync(destPath, JSON.stringify(sanitized, null, 2));
    const result = JSON.parse(fs.readFileSync(destPath, 'utf-8'));

    expect(result.identity).toEqual({ name: 'SimpleBot' });
    expect(result.gateway).toEqual({ port: 8080 });
    expect(result.skills).toBeUndefined();
  });

  it('does not mutate the original config file', () => {
    const config = {
      skills: {
        entries: {
          'web-search': {
            enabled: true,
            env: { KEY: 'secret' },
            apiKey: 'also-secret',
          },
        },
      },
    };

    const sourcePath = path.join(tmpDir, 'original.json');
    fs.writeFileSync(sourcePath, JSON.stringify(config, null, 2));

    // Read and sanitize
    const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
    sanitizeOpenClawConfig(parsed);

    // Re-read original file — should be untouched
    const originalAgain = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
    expect(originalAgain.skills.entries['web-search'].env).toEqual({ KEY: 'secret' });
    expect(originalAgain.skills.entries['web-search'].apiKey).toBe('also-secret');
  });

  it('handles a full migration directory structure', () => {
    // Create source .openclaw directory
    const sourceOpenClaw = path.join(tmpDir, 'source-home', '.openclaw');
    fs.mkdirSync(sourceOpenClaw, { recursive: true });
    fs.mkdirSync(path.join(sourceOpenClaw, 'workspace', 'skills', 'web-search'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(sourceOpenClaw, 'agents'), { recursive: true });

    // Write source config with secrets
    const sourceConfig = {
      identity: { name: 'ProdBot' },
      skills: {
        allowBundled: ['gemini'],
        entries: {
          'web-search': {
            enabled: true,
            env: { SERPAPI_KEY: 'real-key' },
            apiKey: 'OPENAI_KEY',
            timeout: 10000,
          },
        },
      },
      gateway: { port: 3000, cors: true },
    };
    fs.writeFileSync(
      path.join(sourceOpenClaw, 'openclaw.json'),
      JSON.stringify(sourceConfig, null, 2),
    );

    // Write a skill file
    fs.writeFileSync(
      path.join(sourceOpenClaw, 'workspace', 'skills', 'web-search', 'SKILL.md'),
      '---\nname: web-search\nversion: 1.0.0\n---\nSearch the web.',
    );

    // Create destination .openclaw directory
    const destOpenClaw = path.join(tmpDir, 'dest-home', '.openclaw');
    fs.mkdirSync(destOpenClaw, { recursive: true });

    // Simulate migration: copy everything
    fs.cpSync(sourceOpenClaw, destOpenClaw, { recursive: true });

    // Sanitize the dest config
    const destConfigPath = path.join(destOpenClaw, 'openclaw.json');
    const rawConfig = JSON.parse(fs.readFileSync(destConfigPath, 'utf-8'));
    const sanitized = sanitizeOpenClawConfig(rawConfig);
    fs.writeFileSync(destConfigPath, JSON.stringify(sanitized, null, 2));

    // Verify dest structure
    expect(fs.existsSync(path.join(destOpenClaw, 'workspace', 'skills', 'web-search', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(destOpenClaw, 'agents'))).toBe(true);

    // Verify sanitized config
    const finalConfig = JSON.parse(fs.readFileSync(destConfigPath, 'utf-8'));
    expect(finalConfig.identity).toEqual({ name: 'ProdBot' });
    expect(finalConfig.gateway).toEqual({ port: 3000, cors: true });
    expect(finalConfig.skills.allowBundled).toEqual(['gemini']);
    expect(finalConfig.skills.entries['web-search']).toEqual({
      enabled: true,
      timeout: 10000,
    });
    expect(finalConfig.skills.entries['web-search']).not.toHaveProperty('env');
    expect(finalConfig.skills.entries['web-search']).not.toHaveProperty('apiKey');

    // Verify source is untouched
    const sourceStillHasSecrets = JSON.parse(
      fs.readFileSync(path.join(sourceOpenClaw, 'openclaw.json'), 'utf-8'),
    );
    expect(sourceStillHasSecrets.skills.entries['web-search'].env.SERPAPI_KEY).toBe('real-key');
    expect(sourceStillHasSecrets.skills.entries['web-search'].apiKey).toBe('OPENAI_KEY');
  });

  it('handles empty skills entries gracefully', () => {
    const config = {
      skills: { entries: {} },
    };

    const sourcePath = path.join(tmpDir, 'empty-entries.json');
    fs.writeFileSync(sourcePath, JSON.stringify(config));

    const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
    const sanitized = sanitizeOpenClawConfig(parsed);

    const destPath = path.join(tmpDir, 'clean-empty-entries.json');
    fs.writeFileSync(destPath, JSON.stringify(sanitized, null, 2));
    const result = JSON.parse(fs.readFileSync(destPath, 'utf-8'));

    expect(result.skills.entries).toEqual({});
  });
});
