import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  generateRouterWrapper,
  ROUTER_MARKER,
  pathRegistryPath,
  buildInstallRouterCommands,
  buildRemoveRouterCommands,
  readPathRegistry,
  writePathRegistry,
  updateRegistryHostPassthrough,
  updateAllRegistryHostPassthrough,
  type PathRegistry,
} from '../../wrappers/path-override';
import { PATH_REGISTRY_PATH } from '../../legacy';

describe('ROUTER_MARKER', () => {
  it('is defined as a non-empty string', () => {
    expect(ROUTER_MARKER).toBeDefined();
    expect(typeof ROUTER_MARKER).toBe('string');
    expect(ROUTER_MARKER.length).toBeGreaterThan(0);
    expect(ROUTER_MARKER).toBe('AGENSHIELD_ROUTER');
  });
});

describe('pathRegistryPath', () => {
  it('returns a path containing .agenshield', () => {
    const result = pathRegistryPath('/Users/testuser');

    expect(result).toBe('/Users/testuser/.agenshield/path-registry.json');
  });

  it('uses HOME env var when no hostHome provided', () => {
    const originalHome = process.env['HOME'];
    process.env['HOME'] = '/Users/envuser';

    const result = pathRegistryPath();

    expect(result).toContain('/Users/envuser/.agenshield/path-registry.json');

    process.env['HOME'] = originalHome;
  });
});

describe('PATH_REGISTRY_PATH (legacy)', () => {
  it('points to /etc/agenshield/path-registry.json', () => {
    expect(PATH_REGISTRY_PATH).toBe('/etc/agenshield/path-registry.json');
  });
});

describe('generateRouterWrapper', () => {
  it('returns script content with AGENSHIELD_ROUTER marker', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain(ROUTER_MARKER);
  });

  it('starts with #!/bin/bash shebang', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content.startsWith('#!/bin/bash')).toBe(true);
  });

  it('includes the binary name in the comment', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('Router for: openclaw');
  });

  it('reads registry from $HOME/.agenshield/', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('$HOME/.agenshield/path-registry.json');
  });

  it('does not reference legacy /etc/agenshield path', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).not.toContain('/etc/agenshield/path-registry.json');
  });

  it('uses structured META/INST awk output format', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('META:');
    expect(content).toContain('INST:');
  });

  it('handles multi-instance selection', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('Select instance');
  });

  it('includes allowHostPassthrough in awk parser', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('allowHostPassthrough');
  });

  it('includes _agenshield_exec_host helper for host passthrough', () => {
    const content = generateRouterWrapper('claude');

    expect(content).toContain('_agenshield_exec_host');
  });

  it('labels host option as "Host User (unshielded)"', () => {
    const content = generateRouterWrapper('claude');

    expect(content).toContain('Host User (unshielded)');
  });

  it('labels shielded instances with "(shielded)"', () => {
    const content = generateRouterWrapper('claude');

    expect(content).toContain('(shielded)');
  });

  it('includes sudo delegation for agent user execution', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('sudo -H -u');
  });

  it('passes HOME explicitly via env for guarded shell invocation', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('env "HOME=$AGENT_HOME"');
  });

  it('includes inline cd to AGENSHIELD_HOST_CWD in the -c command', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('cd "$AGENSHIELD_HOST_CWD"');
  });

  it('passes HOME via env in fallback path (no guarded shell)', () => {
    const content = generateRouterWrapper('openclaw');

    // The fallback exec also passes HOME
    const lines = content.split('\n');
    const fallbackLine = lines.find(
      (l) => l.includes('# Fallback if guarded shell not installed'),
    );
    expect(fallbackLine).toBeDefined();

    // Find the exec after the fallback comment
    const fallbackIdx = lines.indexOf(fallbackLine!);
    const fallbackExec = lines.slice(fallbackIdx + 1, fallbackIdx + 4).join('\n');
    expect(fallbackExec).toContain('env "HOME=$AGENT_HOME"');
  });
});

describe('buildInstallRouterCommands', () => {
  it('returns commands that install the wrapper', () => {
    const content = generateRouterWrapper('openclaw');
    const commands = buildInstallRouterCommands('openclaw', content);

    expect(commands).toContain('mkdir -p /usr/local/bin');
    expect(commands).toContain('/usr/local/bin/openclaw');
    expect(commands).toContain('chmod 755');
  });

  it('includes backup logic for existing non-wrapper files', () => {
    const content = generateRouterWrapper('openclaw');
    const commands = buildInstallRouterCommands('openclaw', content);

    expect(commands).toContain('.agenshield-backup');
    expect(commands).toContain(ROUTER_MARKER);
  });
});

describe('buildRemoveRouterCommands', () => {
  it('only removes if file contains AGENSHIELD_ROUTER marker', () => {
    const commands = buildRemoveRouterCommands('openclaw');

    expect(commands).toContain(ROUTER_MARKER);
    expect(commands).toContain('/usr/local/bin/openclaw');
  });

  it('restores backup if available', () => {
    const commands = buildRemoveRouterCommands('openclaw');

    expect(commands).toContain('.agenshield-backup');
    expect(commands).toContain('mv');
  });

  it('removes file if no backup exists', () => {
    const commands = buildRemoveRouterCommands('openclaw');

    expect(commands).toContain('rm -f');
  });
});

describe('updateRegistryHostPassthrough', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-override-test-'));
    const agenshieldDir = path.join(tmpDir, '.agenshield');
    fs.mkdirSync(agenshieldDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sets allowHostPassthrough on a specific binary entry', () => {
    const registry: PathRegistry = {
      claude: {
        originalBinary: '/usr/bin/claude',
        instances: [],
      },
    };
    writePathRegistry(registry, tmpDir);

    const result = updateRegistryHostPassthrough('claude', true, tmpDir);

    expect(result.claude.allowHostPassthrough).toBe(true);
  });

  it('does not modify entries for other binaries', () => {
    const registry: PathRegistry = {
      claude: {
        originalBinary: '/usr/bin/claude',
        instances: [],
      },
      openclaw: {
        originalBinary: '/usr/bin/openclaw',
        instances: [],
      },
    };
    writePathRegistry(registry, tmpDir);

    const result = updateRegistryHostPassthrough('claude', true, tmpDir);

    expect(result.claude.allowHostPassthrough).toBe(true);
    expect(result.openclaw.allowHostPassthrough).toBeUndefined();
  });

  it('returns unmodified registry when binName not found', () => {
    const registry: PathRegistry = {
      claude: {
        originalBinary: '/usr/bin/claude',
        instances: [],
      },
    };
    writePathRegistry(registry, tmpDir);

    const result = updateRegistryHostPassthrough('nonexistent', true, tmpDir);

    expect(result.claude.allowHostPassthrough).toBeUndefined();
  });
});

describe('updateAllRegistryHostPassthrough', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-override-test-'));
    const agenshieldDir = path.join(tmpDir, '.agenshield');
    fs.mkdirSync(agenshieldDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sets allowHostPassthrough on all entries', () => {
    const registry: PathRegistry = {
      claude: {
        originalBinary: '/usr/bin/claude',
        instances: [],
      },
      openclaw: {
        originalBinary: '/usr/bin/openclaw',
        instances: [],
      },
    };
    writePathRegistry(registry, tmpDir);

    const result = updateAllRegistryHostPassthrough(true, tmpDir);

    expect(result.claude.allowHostPassthrough).toBe(true);
    expect(result.openclaw.allowHostPassthrough).toBe(true);
  });

  it('can set allowHostPassthrough to false on all entries', () => {
    const registry: PathRegistry = {
      claude: {
        originalBinary: '/usr/bin/claude',
        instances: [],
        allowHostPassthrough: true,
      },
    };
    writePathRegistry(registry, tmpDir);

    const result = updateAllRegistryHostPassthrough(false, tmpDir);

    expect(result.claude.allowHostPassthrough).toBe(false);
  });

  it('returns empty registry when no entries exist', () => {
    writePathRegistry({}, tmpDir);

    const result = updateAllRegistryHostPassthrough(true, tmpDir);

    expect(Object.keys(result)).toHaveLength(0);
  });
});
