import {
  generateRouterWrapper,
  ROUTER_MARKER,
  pathRegistryPath,
  buildInstallRouterCommands,
  buildRemoveRouterCommands,
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

  it('falls back to legacy registry path', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('/etc/agenshield/path-registry.json');
  });

  it('handles single instance routing', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('EXEC:');
  });

  it('handles multi-instance selection', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('CHOOSE');
    expect(content).toContain('Select instance');
  });

  it('includes sudo delegation for agent user execution', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('sudo -H -u');
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
