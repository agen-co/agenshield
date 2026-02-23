import {
  WRAPPERS,
  WRAPPER_DEFINITIONS,
  getDefaultWrapperConfig,
  generateWrapperContent,
  getAvailableWrappers,
  wrapperUsesSeatbelt,
  wrapperUsesInterceptor,
} from '../../wrappers/wrappers';

describe('WRAPPERS', () => {
  it('is defined and non-empty', () => {
    expect(WRAPPERS).toBeDefined();
    expect(Object.keys(WRAPPERS).length).toBeGreaterThan(0);
  });

  it('each wrapper has description and content', () => {
    for (const [name, wrapper] of Object.entries(WRAPPERS)) {
      expect(wrapper.description).toBeDefined();
      expect(typeof wrapper.description).toBe('string');
      expect(wrapper.description.length).toBeGreaterThan(0);

      expect(wrapper.content).toBeDefined();
      expect(typeof wrapper.content).toBe('string');
      expect(wrapper.content.length).toBeGreaterThan(0);
    }
  });

  it('each wrapper content starts with #!/bin/bash', () => {
    for (const [name, wrapper] of Object.entries(WRAPPERS)) {
      expect(wrapper.content.startsWith('#!/bin/bash')).toBe(true);
    }
  });
});

describe('WRAPPER_DEFINITIONS', () => {
  it('includes key commands (git, npm, node)', () => {
    expect(WRAPPER_DEFINITIONS['git']).toBeDefined();
    expect(WRAPPER_DEFINITIONS['npm']).toBeDefined();
    expect(WRAPPER_DEFINITIONS['node']).toBeDefined();
  });

  it('includes curl and wget', () => {
    expect(WRAPPER_DEFINITIONS['curl']).toBeDefined();
    expect(WRAPPER_DEFINITIONS['wget']).toBeDefined();
  });

  it('includes python/pip wrappers', () => {
    expect(WRAPPER_DEFINITIONS['python']).toBeDefined();
    expect(WRAPPER_DEFINITIONS['pip']).toBeDefined();
  });

  it('includes brew wrapper', () => {
    expect(WRAPPER_DEFINITIONS['brew']).toBeDefined();
  });

  it('each definition has a description and generate function', () => {
    for (const [name, def] of Object.entries(WRAPPER_DEFINITIONS)) {
      expect(def.description).toBeDefined();
      expect(typeof def.description).toBe('string');
      expect(typeof def.generate).toBe('function');
    }
  });

  it('node wrapper uses interceptor', () => {
    expect(WRAPPER_DEFINITIONS['node'].usesInterceptor).toBe(true);
  });

  it('python wrapper uses seatbelt', () => {
    expect(WRAPPER_DEFINITIONS['python'].usesSeatbelt).toBe(true);
  });
});

describe('getDefaultWrapperConfig', () => {
  it('returns valid config object', () => {
    const config = getDefaultWrapperConfig();

    expect(config.agentHome).toBeDefined();
    expect(config.agentUsername).toBeDefined();
    expect(config.socketPath).toBeDefined();
    expect(config.httpPort).toBeDefined();
    expect(config.interceptorPath).toBeDefined();
    expect(config.seatbeltDir).toBeDefined();
    expect(config.nodePath).toBeDefined();
    expect(config.npmPath).toBeDefined();
    expect(config.brewPath).toBeDefined();
    expect(config.shieldClientPath).toBeDefined();
    expect(config.nodeBinPath).toBeDefined();
  });

  it('uses userConfig values when provided', () => {
    const config = getDefaultWrapperConfig({
      agentUser: {
        username: 'ash_custom_agent',
        uid: 5200,
        gid: 5100,
        home: '/Users/ash_custom_agent',
        shell: '/bin/bash',
        realname: 'Custom',
        groups: ['ash_custom'],
      },
      brokerUser: {
        username: 'ash_custom_broker',
        uid: 5201,
        gid: 5100,
        home: '/var/empty',
        shell: '/bin/bash',
        realname: 'Broker',
        groups: ['ash_custom'],
      },
      groups: {
        socket: { name: 'ash_custom', gid: 5100, description: 'Custom socket' },
      },
      prefix: '',
      baseName: 'custom',
      baseUid: 5200,
      baseGid: 5100,
    });

    expect(config.agentHome).toBe('/Users/ash_custom_agent');
    expect(config.agentUsername).toBe('ash_custom_agent');
    expect(config.socketPath).toContain('ash_custom_agent');
  });

  it('socket path points to .agenshield/run', () => {
    const config = getDefaultWrapperConfig();

    expect(config.socketPath).toContain('.agenshield/run/agenshield.sock');
  });
});

describe('generateWrapperContent', () => {
  it('returns content for known wrappers', () => {
    const content = generateWrapperContent('git');

    expect(content).toBeDefined();
    expect(typeof content).toBe('string');
    expect(content!.startsWith('#!/bin/bash')).toBe(true);
  });

  it('returns null for unknown wrapper', () => {
    const content = generateWrapperContent('nonexistent-wrapper');

    expect(content).toBeNull();
  });

  it('git wrapper distinguishes network vs local operations', () => {
    const content = generateWrapperContent('git');

    expect(content).toContain('clone|fetch|push|pull');
    expect(content).toContain('/usr/bin/git');
  });
});

describe('getAvailableWrappers', () => {
  it('returns array of wrapper names', () => {
    const names = getAvailableWrappers();

    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('git');
    expect(names).toContain('npm');
    expect(names).toContain('node');
  });
});

describe('wrapperUsesSeatbelt', () => {
  it('returns true for python', () => {
    expect(wrapperUsesSeatbelt('python')).toBe(true);
  });

  it('returns true for pip', () => {
    expect(wrapperUsesSeatbelt('pip')).toBe(true);
  });

  it('returns false for git', () => {
    expect(wrapperUsesSeatbelt('git')).toBe(false);
  });

  it('returns false for unknown wrapper', () => {
    expect(wrapperUsesSeatbelt('nonexistent')).toBe(false);
  });
});

describe('wrapperUsesInterceptor', () => {
  it('returns true for node', () => {
    expect(wrapperUsesInterceptor('node')).toBe(true);
  });

  it('returns false for git', () => {
    expect(wrapperUsesInterceptor('git')).toBe(false);
  });

  it('returns false for unknown wrapper', () => {
    expect(wrapperUsesInterceptor('nonexistent')).toBe(false);
  });
});
