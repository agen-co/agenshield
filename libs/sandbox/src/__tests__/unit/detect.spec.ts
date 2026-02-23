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

import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { detectOpenClaw, checkPrerequisites } from '../../detection/detect';

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
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
});

describe('checkPrerequisites', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
