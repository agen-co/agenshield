import { sanitizeOpenClawConfig } from '../migration';

describe('sanitizeOpenClawConfig', () => {
  it('strips env and apiKey from skill entries', () => {
    const config = {
      skills: {
        entries: {
          'web-search': {
            enabled: true,
            env: { SERPAPI_KEY: 'sk-abc123' },
            apiKey: 'OPENAI_KEY',
          },
          'geo-optimization': {
            enabled: true,
            env: { GEO_TOKEN: 'tok-xyz' },
          },
        },
      },
    };

    const result = sanitizeOpenClawConfig(config);
    const entries = (result['skills'] as Record<string, unknown>)['entries'] as Record<
      string,
      Record<string, unknown>
    >;

    expect(entries['web-search']).toEqual({ enabled: true });
    expect(entries['geo-optimization']).toEqual({ enabled: true });
    expect(entries['web-search']).not.toHaveProperty('env');
    expect(entries['web-search']).not.toHaveProperty('apiKey');
    expect(entries['geo-optimization']).not.toHaveProperty('env');
  });

  it('preserves non-secret skill config fields', () => {
    const config = {
      skills: {
        allowBundled: ['gemini', 'peekaboo'],
        load: { extraDirs: ['/custom/skills'] },
        install: { preferBrew: true, nodeManager: 'npm' },
        entries: {
          gog: {
            enabled: true,
            env: { GOG_KEY: 'xxx' },
            timeout: 30000,
            maxRetries: 3,
          },
        },
      },
    };

    const result = sanitizeOpenClawConfig(config);
    const skills = result['skills'] as Record<string, unknown>;
    const entries = skills['entries'] as Record<string, Record<string, unknown>>;

    // Non-secret fields preserved
    expect(entries['gog']).toEqual({ enabled: true, timeout: 30000, maxRetries: 3 });
    expect(entries['gog']).not.toHaveProperty('env');

    // Sibling skill config keys preserved
    expect(skills['allowBundled']).toEqual(['gemini', 'peekaboo']);
    expect(skills['load']).toEqual({ extraDirs: ['/custom/skills'] });
    expect(skills['install']).toEqual({ preferBrew: true, nodeManager: 'npm' });
  });

  it('preserves all top-level sections', () => {
    const config = {
      identity: { name: 'MyBot', emoji: '🤖' },
      agent: { workspace: '~/projects' },
      channels: { telegram: { token: '...' } },
      gateway: { port: 3000 },
      env: { OPENROUTER_API_KEY: 'or-xxx' },
      logging: { level: 'info' },
      skills: {
        entries: {
          test: { enabled: true, apiKey: 'KEY' },
        },
      },
    };

    const result = sanitizeOpenClawConfig(config);

    // All top-level keys preserved
    expect(result['identity']).toEqual({ name: 'MyBot', emoji: '🤖' });
    expect(result['agent']).toEqual({ workspace: '~/projects' });
    expect(result['channels']).toEqual({ telegram: { token: '...' } });
    expect(result['gateway']).toEqual({ port: 3000 });
    expect(result['logging']).toEqual({ level: 'info' });

    // Top-level env is NOT stripped (only skill-level env is)
    expect(result['env']).toEqual({ OPENROUTER_API_KEY: 'or-xxx' });

    // Skill apiKey is stripped
    const entries = (result['skills'] as Record<string, unknown>)['entries'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(entries['test']).toEqual({ enabled: true });
    expect(entries['test']).not.toHaveProperty('apiKey');
  });

  it('enables skillWatcher in settings', () => {
    // No settings at all
    const result1 = sanitizeOpenClawConfig({});
    expect(result1['settings']).toEqual({ skillWatcher: { enabled: true } });

    // Existing settings preserved
    const result2 = sanitizeOpenClawConfig({ settings: { foo: 'bar' } });
    expect(result2['settings']).toEqual({ foo: 'bar', skillWatcher: { enabled: true } });
  });

  it('handles empty and missing skills gracefully', () => {
    // Empty config
    const result1 = sanitizeOpenClawConfig({});
    expect(result1['settings']).toEqual({ skillWatcher: { enabled: true } });

    // skills key with no entries
    const result2 = sanitizeOpenClawConfig({ skills: {} });
    expect(result2['skills']).toEqual({});

    // skills with empty entries
    const result3 = sanitizeOpenClawConfig({ skills: { entries: {} } });
    const entries = (result3['skills'] as Record<string, unknown>)['entries'] as Record<
      string,
      unknown
    >;
    expect(entries).toEqual({});
  });

  it('does NOT mutate the input object', () => {
    const config = {
      skills: {
        entries: {
          'web-search': {
            enabled: true,
            env: { SERPAPI_KEY: 'sk-abc123' },
            apiKey: 'OPENAI_KEY',
          },
        },
      },
      settings: { existing: true },
    };

    // Deep-clone to compare later
    const original = JSON.parse(JSON.stringify(config));

    sanitizeOpenClawConfig(config);

    // Input must be identical to the snapshot taken before the call
    expect(config).toEqual(original);
  });

  it('handles a full real-world config', () => {
    const config = {
      identity: { name: 'ProdBot', emoji: '🛡️', version: '2.1.0' },
      agent: { workspace: '~/workspace', maxConcurrency: 4 },
      channels: {
        telegram: { token: 'tg-token-123', chatId: '-100123' },
        slack: { botToken: 'xoxb-slack-token', channel: '#general' },
      },
      auth: { providers: ['github', 'google'], sessionTtl: 3600 },
      session: { store: 'redis', ttl: 86400 },
      tools: { enabled: ['search', 'calculator', 'code-runner'] },
      models: {
        default: 'gpt-4',
        fallback: 'gpt-3.5-turbo',
        providers: { openai: { apiKey: 'sk-model-key' } },
      },
      skills: {
        allowBundled: ['gemini'],
        load: { extraDirs: ['/opt/skills'] },
        install: { nodeManager: 'pnpm' },
        entries: {
          'web-search': {
            enabled: true,
            env: { SERPAPI_KEY: 'sk-serp-real' },
            apiKey: 'OPENAI_KEY_REAL',
            timeout: 15000,
          },
          summarizer: {
            enabled: true,
            env: { SUMMARY_MODEL: 'gpt-4' },
            maxTokens: 4096,
          },
          translator: {
            enabled: false,
            apiKey: 'DEEPL_KEY',
            languages: ['en', 'es', 'fr'],
          },
          'code-runner': {
            enabled: true,
            sandbox: true,
          },
        },
      },
      logging: { level: 'debug', file: '/var/log/openclaw.log' },
      gateway: { port: 3000, host: '0.0.0.0', cors: true },
      env: {
        OPENROUTER_API_KEY: 'or-xxx',
        DATABASE_URL: 'postgres://localhost:5432/openclaw',
      },
      settings: { theme: 'dark', notifications: true },
    };

    const result = sanitizeOpenClawConfig(config);

    // Top-level sections pass through unchanged
    expect(result['identity']).toEqual(config.identity);
    expect(result['agent']).toEqual(config.agent);
    expect(result['channels']).toEqual(config.channels);
    expect(result['auth']).toEqual(config.auth);
    expect(result['session']).toEqual(config.session);
    expect(result['tools']).toEqual(config.tools);
    expect(result['models']).toEqual(config.models);
    expect(result['logging']).toEqual(config.logging);
    expect(result['gateway']).toEqual(config.gateway);
    expect(result['env']).toEqual(config.env);

    // Skills structure preserved except secrets
    const skills = result['skills'] as Record<string, unknown>;
    expect(skills['allowBundled']).toEqual(['gemini']);
    expect(skills['load']).toEqual({ extraDirs: ['/opt/skills'] });
    expect(skills['install']).toEqual({ nodeManager: 'pnpm' });

    const entries = skills['entries'] as Record<string, Record<string, unknown>>;

    // web-search: env + apiKey stripped, timeout kept
    expect(entries['web-search']).toEqual({ enabled: true, timeout: 15000 });

    // summarizer: env stripped, maxTokens kept
    expect(entries['summarizer']).toEqual({ enabled: true, maxTokens: 4096 });

    // translator: apiKey stripped, languages kept
    expect(entries['translator']).toEqual({ enabled: false, languages: ['en', 'es', 'fr'] });

    // code-runner: no secrets to strip, passes through intact
    expect(entries['code-runner']).toEqual({ enabled: true, sandbox: true });

    // Settings merged with skillWatcher
    expect(result['settings']).toEqual({
      theme: 'dark',
      notifications: true,
      skillWatcher: { enabled: true },
    });
  });
});
