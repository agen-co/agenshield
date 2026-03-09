// Use `var` to avoid TDZ issues with SWC/Jest hoisting
var mockSudoUser: string | undefined = undefined;

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}));

jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  accessSync: jest.fn(),
  readFileSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
}));

jest.mock('node:os', () => ({
  homedir: jest.fn().mockReturnValue('/Users/testuser'),
}));

// Intercept process.env for SUDO_USER
const originalEnv = process.env;

import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { detectOpenClaw, checkPrerequisites } from '../../detection/detect';

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockedAccessSync = fs.accessSync as jest.MockedFunction<typeof fs.accessSync>;
const mockedReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;

describe('detectOpenClaw', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
  });

  it('returns detection result structure', () => {
    const result = detectOpenClaw();

    expect(result).toHaveProperty('installation');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('returns found=false when no installation detected', () => {
    const result = detectOpenClaw();

    expect(result.installation.found).toBe(false);
    expect(result.installation.method).toBe('unknown');
  });

  it('detects npm installation when package exists', () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('npm root -g')) return '/usr/local/lib/node_modules\n';
      if (typeof cmd === 'string' && cmd.includes('npm prefix -g')) return '/usr/local\n';
      if (typeof cmd === 'string' && cmd.includes('openclaw --version')) return '1.0.0\n';
      throw new Error('not found');
    });

    mockedExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === '/usr/local/lib/node_modules/openclaw') return true;
      if (path === '/usr/local/lib/node_modules/openclaw/package.json') return true;
      if (path === '/usr/local/bin/openclaw') return true;
      return false;
    });

    mockedReadFileSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path.includes('package.json')) {
        return JSON.stringify({ version: '1.0.0' });
      }
      return '';
    });

    const result = detectOpenClaw();

    expect(result.installation.found).toBe(true);
    expect(result.installation.method).toBe('npm');
    expect(result.installation.version).toBe('1.0.0');
  });

  it('includes config path when .openclaw directory exists', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path === '/Users/testuser/.openclaw') return true;
      return false;
    });

    const result = detectOpenClaw();

    expect(result.installation.configPath).toBe('/Users/testuser/.openclaw');
  });

  it('detects git installation when repo exists', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/Users/testuser/openclaw') return true;
      if (s === '/Users/testuser/openclaw/.git') return true;
      if (s === '/Users/testuser/openclaw/package.json') return true;
      return false;
    });

    // accessSync should succeed for valid paths and throw for invalid ones
    mockedAccessSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/Users/testuser/openclaw') return undefined;
      if (s === '/Users/testuser/openclaw/.git') return undefined;
      if (s === '/Users/testuser/openclaw/package.json') return undefined;
      throw new Error('not found');
    });

    mockedReadFileSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/Users/testuser/openclaw/package.json') {
        return JSON.stringify({ name: 'openclaw', version: '2.0.0' });
      }
      return '';
    });

    const result = detectOpenClaw();

    expect(result.installation.found).toBe(true);
    expect(result.installation.method).toBe('git');
    expect(result.installation.version).toBe('2.0.0');
    expect(result.installation.gitRepoPath).toBe('/Users/testuser/openclaw');
  });

  it('detects git installation with wrapper script in .local/bin', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/Users/testuser/openclaw') return true;
      if (s === '/Users/testuser/openclaw/.git') return true;
      if (s === '/Users/testuser/openclaw/package.json') return true;
      if (s === '/Users/testuser/.local/bin/openclaw') return true;
      return false;
    });

    mockedAccessSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/Users/testuser/openclaw') return undefined;
      if (s === '/Users/testuser/openclaw/.git') return undefined;
      if (s === '/Users/testuser/openclaw/package.json') return undefined;
      if (s === '/Users/testuser/.local/bin/openclaw') return undefined;
      throw new Error('not found');
    });

    mockedReadFileSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/Users/testuser/openclaw/package.json') {
        return JSON.stringify({ name: 'openclaw', version: '2.0.0' });
      }
      return '';
    });

    const result = detectOpenClaw();

    expect(result.installation.found).toBe(true);
    expect(result.installation.method).toBe('git');
    expect(result.installation.binaryPath).toBe('/Users/testuser/.local/bin/openclaw');
  });

  it('detects git install via wrapper script parsing (exec node pattern)', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    // No known repo paths exist, but the wrapper script does
    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/Users/testuser/.local/bin/openclaw') return true;
      // The parsed repo path from wrapper
      if (s === '/opt/openclaw-build') return true;
      if (s === '/opt/openclaw-build/package.json') return true;
      return false;
    });

    mockedAccessSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/Users/testuser/.local/bin/openclaw') return undefined;
      if (s === '/opt/openclaw-build') return undefined;
      if (s === '/opt/openclaw-build/package.json') return undefined;
      throw new Error('not found');
    });

    mockedReadFileSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/Users/testuser/.local/bin/openclaw') {
        return '#!/bin/bash\nexec node "/opt/openclaw-build/dist/entry.js" "$@"';
      }
      if (s === '/opt/openclaw-build/package.json') {
        return JSON.stringify({ version: '3.0.0' });
      }
      return '';
    });

    const result = detectOpenClaw();

    expect(result.installation.found).toBe(true);
    expect(result.installation.method).toBe('git');
    expect(result.installation.packagePath).toBe('/opt/openclaw-build');
    expect(result.installation.binaryPath).toBe('/Users/testuser/.local/bin/openclaw');
    expect(result.installation.version).toBe('3.0.0');
  });

  it('warns when both npm and git installations are found', () => {
    // Set up npm install
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('npm root -g')) return '/usr/local/lib/node_modules\n';
      if (typeof cmd === 'string' && cmd.includes('npm prefix -g')) return '/usr/local\n';
      if (typeof cmd === 'string' && cmd.includes('openclaw --version')) return '1.0.0\n';
      throw new Error('not found');
    });

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      // npm paths
      if (s === '/usr/local/lib/node_modules/openclaw') return true;
      if (s === '/usr/local/lib/node_modules/openclaw/package.json') return true;
      if (s === '/usr/local/bin/openclaw') return true;
      // git paths
      if (s === '/Users/testuser/openclaw') return true;
      if (s === '/Users/testuser/openclaw/.git') return true;
      if (s === '/Users/testuser/openclaw/package.json') return true;
      return false;
    });

    mockedAccessSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/usr/local/lib/node_modules/openclaw') return undefined;
      if (s === '/usr/local/lib/node_modules/openclaw/package.json') return undefined;
      if (s === '/usr/local/bin/openclaw') return undefined;
      if (s === '/Users/testuser/openclaw') return undefined;
      if (s === '/Users/testuser/openclaw/.git') return undefined;
      if (s === '/Users/testuser/openclaw/package.json') return undefined;
      throw new Error('not found');
    });

    mockedReadFileSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.includes('node_modules/openclaw/package.json')) {
        return JSON.stringify({ version: '1.0.0' });
      }
      if (s === '/Users/testuser/openclaw/package.json') {
        return JSON.stringify({ name: 'openclaw', version: '2.0.0' });
      }
      return '';
    });

    const result = detectOpenClaw();

    expect(result.installation.found).toBe(true);
    expect(result.installation.method).toBe('npm');
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Both npm and git installations found')]),
    );
  });

  it('falls back to CLI version when package version is missing', () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('npm root -g')) return '/usr/local/lib/node_modules\n';
      if (typeof cmd === 'string' && cmd.includes('npm prefix -g')) return '/usr/local\n';
      if (typeof cmd === 'string' && cmd.includes('openclaw --version')) return '1.2.3\n';
      throw new Error('not found');
    });

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/usr/local/lib/node_modules/openclaw') return true;
      if (s === '/usr/local/bin/openclaw') return true;
      // No package.json exists
      return false;
    });

    mockedAccessSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/usr/local/lib/node_modules/openclaw') return undefined;
      if (s === '/usr/local/bin/openclaw') return undefined;
      throw new Error('not found');
    });

    const result = detectOpenClaw();

    expect(result.installation.found).toBe(true);
    expect(result.installation.version).toBe('1.2.3');
  });

  it('warns when CLI version output is not a valid version string', () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('npm root -g')) return '/usr/local/lib/node_modules\n';
      if (typeof cmd === 'string' && cmd.includes('npm prefix -g')) return '/usr/local\n';
      if (typeof cmd === 'string' && cmd.includes('openclaw --version')) return 'OpenClaw CLI v1.0.0-beta\n';
      throw new Error('not found');
    });

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/usr/local/lib/node_modules/openclaw') return true;
      if (s === '/usr/local/bin/openclaw') return true;
      return false;
    });

    mockedAccessSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/usr/local/lib/node_modules/openclaw') return undefined;
      if (s === '/usr/local/bin/openclaw') return undefined;
      throw new Error('not found');
    });

    const result = detectOpenClaw();

    expect(result.installation.found).toBe(true);
    expect(result.installation.version).toBeUndefined();
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Version could not be identified')]),
    );
  });

  it('warns when CLI version returns empty output', () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('npm root -g')) return '/usr/local/lib/node_modules\n';
      if (typeof cmd === 'string' && cmd.includes('npm prefix -g')) return '/usr/local\n';
      if (typeof cmd === 'string' && cmd.includes('openclaw --version')) return '\n';
      throw new Error('not found');
    });

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/usr/local/lib/node_modules/openclaw') return true;
      if (s === '/usr/local/bin/openclaw') return true;
      return false;
    });

    mockedAccessSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/usr/local/lib/node_modules/openclaw') return undefined;
      if (s === '/usr/local/bin/openclaw') return undefined;
      throw new Error('not found');
    });

    const result = detectOpenClaw();

    expect(result.installation.found).toBe(true);
    expect(result.installation.version).toBeUndefined();
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Version could not be identified')]),
    );
  });

  it('adds error when packagePath becomes inaccessible at validation time', () => {
    // Use the git wrapper detection path where we can control path accessibility
    // between detection and validation phases
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('openclaw --version')) return '1.0.0\n';
      throw new Error('not found');
    });

    // Track which paths exist so we can flip the package path between phases
    var validationPhase = false;
    const repoPath = '/opt/openclaw-build';

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/Users/testuser/.local/bin/openclaw') return true;
      if (s === repoPath && !validationPhase) return true;
      if (s === repoPath + '/package.json' && !validationPhase) return true;
      return false;
    });

    mockedAccessSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/Users/testuser/.local/bin/openclaw') return undefined;
      if (s === repoPath && !validationPhase) return undefined;
      if (s === (repoPath + '/package.json') && !validationPhase) return undefined;
      throw new Error('ENOENT');
    });

    mockedReadFileSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/Users/testuser/.local/bin/openclaw') {
        return '#!/bin/bash\nexec node "/opt/openclaw-build/dist/entry.js" "$@"';
      }
      if (s === repoPath + '/package.json') {
        // After reading, mark validation phase so next pathExists check fails
        validationPhase = true;
        return JSON.stringify({ version: '3.0.0' });
      }
      return '';
    });

    const result = detectOpenClaw();

    expect(result.installation.found).toBe(true);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Package path not found')]),
    );
  });

  it('adds warning about binary path when binary is not found', () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('npm root -g')) return '/usr/local/lib/node_modules\n';
      if (typeof cmd === 'string' && cmd.includes('npm prefix -g')) return '/usr/local\n';
      if (typeof cmd === 'string' && cmd.includes('openclaw --version')) return '1.0.0\n';
      throw new Error('not found');
    });

    mockedExistsSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/usr/local/lib/node_modules/openclaw') return true;
      if (s === '/usr/local/lib/node_modules/openclaw/package.json') return true;
      return false;
    });

    mockedAccessSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s === '/usr/local/lib/node_modules/openclaw') return undefined;
      if (s === '/usr/local/lib/node_modules/openclaw/package.json') return undefined;
      // Binary not found
      throw new Error('ENOENT');
    });

    mockedReadFileSync.mockImplementation((p: unknown) => {
      if (String(p).includes('package.json')) {
        return JSON.stringify({ version: '1.0.0' });
      }
      return '';
    });

    const result = detectOpenClaw();

    expect(result.installation.found).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Binary path not found')]),
    );
  });
});

describe('checkPrerequisites', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
  });

  it('returns ok=true on macOS with Node 22+', () => {
    mockedExecSync.mockReturnValue('/usr/sbin/dscl\n');

    const result = checkPrerequisites();

    // Running in test environment on macOS with Node 22+
    if (process.platform === 'darwin') {
      const majorVersion = parseInt(process.version.slice(1).split('.')[0], 10);
      if (majorVersion >= 22) {
        expect(result.ok).toBe(true);
        expect(result.missing).toHaveLength(0);
      }
    }
  });

  it('returns missing items array', () => {
    const result = checkPrerequisites();

    expect(result).toHaveProperty('ok');
    expect(result).toHaveProperty('missing');
    expect(Array.isArray(result.missing)).toBe(true);
  });

  it('reports missing dscl command', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const result = checkPrerequisites();

    // dscl command not found because execSync throws
    expect(result.missing).toEqual(
      expect.arrayContaining([expect.stringContaining('dscl')]),
    );
  });
});
