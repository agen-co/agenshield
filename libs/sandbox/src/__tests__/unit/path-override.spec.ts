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

    expect(content).toContain('Select an instance');
  });

  it('contains the _agenshield_select function definition', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('_agenshield_select()');
    expect(content).toContain('_AGENSHIELD_SELECTION');
  });

  it('tries Node.js prompt helper before numbered fallback', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('agenshield-prompt');
    expect(content).toContain('PROMPT_HELPER');
  });

  it('includes numbered prompt fallback (no ANSI escape codes)', () => {
    const content = generateRouterWrapper('openclaw');

    // Numbered fallback exists
    expect(content).toContain('Select [1-');
    // No inline ANSI escape rendering (handled by prompt helper instead)
    expect(content).not.toContain('\\x1b');
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

  it('uses env -i for clean environment isolation', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('env -i');
    expect(content).toContain('ENV_ARGS=(env -i)');
  });

  it('passes HOME explicitly via env for guarded shell invocation', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('HOME=$AGENT_HOME');
  });

  it('execs $BIN directly and sets SHELL=$GUARDED_SHELL for subprocess enforcement', () => {
    const content = generateRouterWrapper('openclaw');

    // The router passes AGENSHIELD_HOST_CWD as an env var (app wrapper handles cd)
    expect(content).toContain('AGENSHIELD_HOST_CWD=$PWD');
    // $BIN is exec'd directly — NOT through guarded shell -c
    expect(content).not.toContain('GUARDED_SHELL" -c');
    expect(content).not.toContain('CMD_NAME="$(basename "$BIN")"');
    // SHELL=$GUARDED_SHELL set via ENV_ARGS so subshells are still guarded
    expect(content).toContain('SHELL=$GUARDED_SHELL');
    // Exec's the binary directly
    expect(content).toContain('"$BIN" "$@"');
  });

  it('does not leak SUDO_* variables in generated script', () => {
    const content = generateRouterWrapper('openclaw');

    // env -i ensures clean env — script should not reference SUDO_ vars
    expect(content).not.toContain('SUDO_USER');
    expect(content).not.toContain('SUDO_UID');
    expect(content).not.toContain('SUDO_GID');
  });

  it('builds safe PATH without host HOME references', () => {
    const content = generateRouterWrapper('openclaw');

    // PATH is built from known safe locations
    expect(content).toContain('SAFE_PATH=');
    expect(content).toContain('/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin');
    expect(content).toContain('$AGENT_HOME/bin');
    // No $HOME in PATH (uses $AGENT_HOME explicitly)
    expect(content).not.toContain('PATH="$HOME');
  });

  it('forwards proxy vars when set', () => {
    const content = generateRouterWrapper('openclaw');

    expect(content).toContain('HTTP_PROXY=$HTTP_PROXY');
    expect(content).toContain('HTTPS_PROXY=$HTTPS_PROXY');
    expect(content).toContain('NO_PROXY=$NO_PROXY');
  });

  it('does not use local keyword outside of function definitions', () => {
    const content = generateRouterWrapper('openclaw');

    // Split into function bodies and main body
    // The _agenshield_exec, _agenshield_exec_host, _agenshield_select,
    // _check_cwd_access, and _check_cwd_perms functions use local legitimately.
    // The main body (after all function defs) should NOT use local.
    const mainBodyStart = content.lastIndexOf('PARSED=$(awk');
    const mainBody = content.slice(mainBodyStart);
    expect(mainBody).not.toMatch(/\blocal\b/);
  });

  it('uses daemon endpoint for permission verification instead of sudo test', () => {
    const content = generateRouterWrapper('openclaw');

    // Should call daemon verify-permissions endpoint
    expect(content).toContain('workspace-paths/verify-permissions');
    // Should NOT use sudo -n test for permission checking
    expect(content).not.toContain('sudo -n -u "$AGENT_USER" test');
  });

  it('skips perm check when _check_cwd_access just granted access (return 2)', () => {
    const content = generateRouterWrapper('openclaw');

    // _check_cwd_access returns 2 when it just granted
    expect(content).toContain('return 2');
    // Call sites capture return code and skip perm check when rc=2
    expect(content).toContain('_CWD_RC=$?');
    expect(content).toContain('_CWD_RC -eq 0');
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
