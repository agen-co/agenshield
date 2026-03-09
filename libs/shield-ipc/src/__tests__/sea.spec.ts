/**
 * SEA utilities tests.
 *
 * Because isSEA() caches in module scope, we use jest.isolateModules()
 * to get fresh module state per scenario.
 */

describe('SEA utilities (non-SEA environment)', () => {
  let sea: typeof import('../sea');

  beforeEach(() => {
    jest.isolateModules(() => {
      sea = require('../sea');
    });
  });

  it('isSEA returns false when node:sea is unavailable', () => {
    expect(sea.isSEA()).toBe(false);
  });

  it('isSEA returns cached value on subsequent calls', () => {
    expect(sea.isSEA()).toBe(false);
    expect(sea.isSEA()).toBe(false);
  });

  it('getSEAVersion returns null when not SEA', () => {
    expect(sea.getSEAVersion()).toBeNull();
  });

  it('getSEAAssetString returns null when not SEA', () => {
    expect(sea.getSEAAssetString('VERSION')).toBeNull();
  });

  it('getSEALibDir returns null when not SEA', () => {
    expect(sea.getSEALibDir()).toBeNull();
  });

  it('isSEAExtracted returns false when not SEA', () => {
    expect(sea.isSEAExtracted()).toBe(false);
  });
});

describe('SEA utilities (mocked SEA environment)', () => {
  const MOCK_VERSION = '1.2.3';
  const MOCK_ASSETS: Record<string, string> = {
    VERSION: `  ${MOCK_VERSION}  `,
    'config.json': '{"key":"value"}',
  };

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function loadWithSEA() {
    jest.doMock('node:sea', () => ({
      isSea: () => true,
      getAsset: (name: string, _encoding: string) => {
        if (name in MOCK_ASSETS) return MOCK_ASSETS[name];
        throw new Error(`Asset not found: ${name}`);
      },
    }), { virtual: true });

    return require('../sea') as typeof import('../sea');
  }

  it('isSEA returns true when node:sea reports sea', () => {
    const sea = loadWithSEA();
    expect(sea.isSEA()).toBe(true);
  });

  it('getSEAVersion returns trimmed version', () => {
    const sea = loadWithSEA();
    expect(sea.getSEAVersion()).toBe(MOCK_VERSION);
  });

  it('getSEAAssetString returns asset content', () => {
    const sea = loadWithSEA();
    expect(sea.getSEAAssetString('config.json')).toBe('{"key":"value"}');
  });

  it('getSEAAssetString returns null for missing asset', () => {
    const sea = loadWithSEA();
    expect(sea.getSEAAssetString('nonexistent')).toBeNull();
  });

  it('getSEALibDir returns versioned lib path', () => {
    const sea = loadWithSEA();
    const libDir = sea.getSEALibDir();
    expect(libDir).not.toBeNull();
    expect(libDir).toContain(`.agenshield/lib/v${MOCK_VERSION}`);
  });

  it('isSEAExtracted returns true when stamp matches version', () => {
    const sea = loadWithSEA();
    const libDir = sea.getSEALibDir()!;

    jest.doMock('node:fs', () => ({
      ...jest.requireActual('node:fs'),
      readFileSync: (filePath: string, _encoding: string) => {
        if (filePath === `${libDir}/.extracted`) return `  ${MOCK_VERSION}  `;
        throw new Error('ENOENT');
      },
    }));

    // Need fresh module to pick up fs mock
    jest.resetModules();
    jest.doMock('node:sea', () => ({
      isSea: () => true,
      getAsset: (name: string, _encoding: string) => {
        if (name in MOCK_ASSETS) return MOCK_ASSETS[name];
        throw new Error(`Asset not found: ${name}`);
      },
    }), { virtual: true });
    jest.doMock('node:fs', () => {
      const actualFs = jest.requireActual('node:fs');
      return {
        ...actualFs,
        readFileSync: (p: string, enc: string) => {
          if (typeof p === 'string' && p.endsWith('.extracted')) return `  ${MOCK_VERSION}  `;
          return actualFs.readFileSync(p, enc);
        },
      };
    });
    const sea2 = require('../sea') as typeof import('../sea');
    expect(sea2.isSEAExtracted()).toBe(true);
  });

  it('isSEAExtracted returns false when stamp mismatches', () => {
    jest.resetModules();
    jest.doMock('node:sea', () => ({
      isSea: () => true,
      getAsset: (name: string, _encoding: string) => {
        if (name in MOCK_ASSETS) return MOCK_ASSETS[name];
        throw new Error(`Asset not found: ${name}`);
      },
    }), { virtual: true });
    jest.doMock('node:fs', () => {
      const actualFs = jest.requireActual('node:fs');
      return {
        ...actualFs,
        readFileSync: (p: string, enc: string) => {
          if (typeof p === 'string' && p.endsWith('.extracted')) return 'wrong-version';
          return actualFs.readFileSync(p, enc);
        },
      };
    });
    const sea2 = require('../sea') as typeof import('../sea');
    expect(sea2.isSEAExtracted()).toBe(false);
  });

  it('isSEAExtracted returns false when stamp file missing', () => {
    jest.resetModules();
    jest.doMock('node:sea', () => ({
      isSea: () => true,
      getAsset: (name: string, _encoding: string) => {
        if (name in MOCK_ASSETS) return MOCK_ASSETS[name];
        throw new Error(`Asset not found: ${name}`);
      },
    }), { virtual: true });
    jest.doMock('node:fs', () => {
      const actualFs = jest.requireActual('node:fs');
      return {
        ...actualFs,
        readFileSync: (p: string, enc: string) => {
          if (typeof p === 'string' && p.endsWith('.extracted')) throw new Error('ENOENT');
          return actualFs.readFileSync(p, enc);
        },
      };
    });
    const sea2 = require('../sea') as typeof import('../sea');
    expect(sea2.isSEAExtracted()).toBe(false);
  });
});

describe('SEA isSEA with non-function isSea', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns false when isSea is not a function', () => {
    jest.doMock('node:sea', () => ({
      isSea: 'not-a-function',
    }), { virtual: true });
    const sea = require('../sea') as typeof import('../sea');
    expect(sea.isSEA()).toBe(false);
  });
});
