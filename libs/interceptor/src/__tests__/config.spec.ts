/* eslint-disable @typescript-eslint/no-explicit-any */

describe('createConfig', () => {
  const originalEnv = process.env;
  const originalPlatform = process.platform;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Clear all AGENSHIELD_ vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AGENSHIELD_')) delete process.env[key];
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  async function loadCreateConfig() {
    const mod = await import('../config');
    return mod.createConfig;
  }

  it('returns defaults when no env vars are set', async () => {
    const createConfig = await loadCreateConfig();
    const config = createConfig();

    expect(config.httpHost).toBe('localhost');
    expect(config.httpPort).toBe(5201);
    expect(config.failOpen).toBe(false);
    expect(config.logLevel).toBe('warn');
    expect(config.interceptFetch).toBe(true);
    expect(config.interceptHttp).toBe(true);
    expect(config.interceptWs).toBe(true);
    expect(config.interceptFs).toBe(false);
    expect(config.interceptExec).toBe(true);
    expect(config.timeout).toBe(5000);
    expect(config.contextType).toBe('agent');
    expect(config.seatbeltProfileDir).toBe('/tmp/agenshield-profiles');
    expect(config.enableResourceMonitoring).toBe(true);
    expect(config.defaultResourceLimits).toBeUndefined();
  });

  it('reads AGENSHIELD_HOST', async () => {
    process.env['AGENSHIELD_HOST'] = '10.0.0.1';
    const createConfig = await loadCreateConfig();
    expect(createConfig().httpHost).toBe('10.0.0.1');
  });

  it('reads AGENSHIELD_PORT', async () => {
    process.env['AGENSHIELD_PORT'] = '9999';
    const createConfig = await loadCreateConfig();
    expect(createConfig().httpPort).toBe(9999);
  });

  it('reads AGENSHIELD_FAIL_OPEN', async () => {
    process.env['AGENSHIELD_FAIL_OPEN'] = 'true';
    const createConfig = await loadCreateConfig();
    expect(createConfig().failOpen).toBe(true);
  });

  it('reads AGENSHIELD_LOG_LEVEL', async () => {
    process.env['AGENSHIELD_LOG_LEVEL'] = 'debug';
    const createConfig = await loadCreateConfig();
    expect(createConfig().logLevel).toBe('debug');
  });

  it('reads AGENSHIELD_INTERCEPT_FETCH=false', async () => {
    process.env['AGENSHIELD_INTERCEPT_FETCH'] = 'false';
    const createConfig = await loadCreateConfig();
    expect(createConfig().interceptFetch).toBe(false);
  });

  it('reads AGENSHIELD_INTERCEPT_HTTP=false', async () => {
    process.env['AGENSHIELD_INTERCEPT_HTTP'] = 'false';
    const createConfig = await loadCreateConfig();
    expect(createConfig().interceptHttp).toBe(false);
  });

  it('reads AGENSHIELD_INTERCEPT_WS=false', async () => {
    process.env['AGENSHIELD_INTERCEPT_WS'] = 'false';
    const createConfig = await loadCreateConfig();
    expect(createConfig().interceptWs).toBe(false);
  });

  it('reads AGENSHIELD_INTERCEPT_EXEC=false', async () => {
    process.env['AGENSHIELD_INTERCEPT_EXEC'] = 'false';
    const createConfig = await loadCreateConfig();
    expect(createConfig().interceptExec).toBe(false);
  });

  it('reads AGENSHIELD_TIMEOUT', async () => {
    process.env['AGENSHIELD_TIMEOUT'] = '15000';
    const createConfig = await loadCreateConfig();
    expect(createConfig().timeout).toBe(15000);
  });

  it('reads AGENSHIELD_CONTEXT_TYPE', async () => {
    process.env['AGENSHIELD_CONTEXT_TYPE'] = 'skill';
    const createConfig = await loadCreateConfig();
    expect(createConfig().contextType).toBe('skill');
  });

  it('reads AGENSHIELD_SKILL_SLUG', async () => {
    process.env['AGENSHIELD_SKILL_SLUG'] = 'my-skill';
    const createConfig = await loadCreateConfig();
    expect(createConfig().contextSkillSlug).toBe('my-skill');
  });

  it('reads AGENSHIELD_AGENT_ID', async () => {
    process.env['AGENSHIELD_AGENT_ID'] = 'agent-42';
    const createConfig = await loadCreateConfig();
    expect(createConfig().contextAgentId).toBe('agent-42');
  });

  it('reads AGENSHIELD_SOCKET', async () => {
    process.env['AGENSHIELD_SOCKET'] = '/custom/path.sock';
    const createConfig = await loadCreateConfig();
    expect(createConfig().socketPath).toBe('/custom/path.sock');
  });

  it('reads AGENSHIELD_SEATBELT_DIR', async () => {
    process.env['AGENSHIELD_SEATBELT_DIR'] = '/custom/profiles';
    const createConfig = await loadCreateConfig();
    expect(createConfig().seatbeltProfileDir).toBe('/custom/profiles');
  });

  it('reads AGENSHIELD_RESOURCE_MONITORING=false', async () => {
    process.env['AGENSHIELD_RESOURCE_MONITORING'] = 'false';
    const createConfig = await loadCreateConfig();
    expect(createConfig().enableResourceMonitoring).toBe(false);
  });

  it('reads AGENSHIELD_RESOURCE_LIMITS as JSON', async () => {
    const limits = { memoryMb: { warn: 256, kill: 512 } };
    process.env['AGENSHIELD_RESOURCE_LIMITS'] = JSON.stringify(limits);
    const createConfig = await loadCreateConfig();
    expect(createConfig().defaultResourceLimits).toEqual(limits);
  });

  it('uses HOME for socket path when AGENSHIELD_SOCKET is not set', async () => {
    process.env['HOME'] = '/home/testuser';
    const createConfig = await loadCreateConfig();
    expect(createConfig().socketPath).toContain('/home/testuser/.agenshield/run/agenshield.sock');
  });

  it('applies overrides over env vars', async () => {
    process.env['AGENSHIELD_HOST'] = 'envhost';
    const createConfig = await loadCreateConfig();
    const config = createConfig({ httpHost: 'override' });
    expect(config.httpHost).toBe('override');
  });
});
