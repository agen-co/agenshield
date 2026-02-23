jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
  accessSync: jest.fn(),
}));

jest.mock('../../detection/security', () => ({
  isSecretEnvVar: jest.fn((name: string) => {
    const patterns = [
      /^AWS_/i, /^OPENAI_/i, /_API_KEY$/i, /_SECRET$/i, /_TOKEN$/i,
    ];
    return patterns.some((p) => p.test(name));
  }),
}));

import { maskSecretValue, scanShellProfiles } from '../../detection/host-scanner';
import * as fs from 'node:fs';

const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockedReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;

describe('maskSecretValue', () => {
  it('fully masks short values (8 chars or fewer)', () => {
    expect(maskSecretValue('abc')).toBe('****');
    expect(maskSecretValue('12345678')).toBe('****');
  });

  it('shows first 3 and last 4 chars for longer values', () => {
    expect(maskSecretValue('sk-abc123xyz456')).toBe('sk-...z456');
  });

  it('handles exactly 9-char values (minimum for partial mask)', () => {
    const result = maskSecretValue('123456789');

    expect(result).toBe('123...6789');
  });

  it('handles very long values', () => {
    const longValue = 'a'.repeat(100);
    const result = maskSecretValue(longValue);

    expect(result).toBe('aaa...aaaa');
    expect(result.length).toBeLessThan(longValue.length);
  });

  it('masks empty-ish values', () => {
    expect(maskSecretValue('')).toBe('****');
    expect(maskSecretValue('a')).toBe('****');
  });
});

describe('scanShellProfiles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty arrays when no profiles exist', () => {
    mockedExistsSync.mockReturnValue(false);

    const result = scanShellProfiles('/Users/testuser');

    expect(result.envVars).toHaveLength(0);
    expect(result.scannedProfiles).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('scans .zshrc for exported secret env vars', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === '/Users/testuser/.zshrc';
    });
    mockedReadFileSync.mockReturnValue(
      'export AWS_SECRET_KEY="sk-test-123456789"\nexport PATH="/usr/bin"\nexport HOME="/Users/testuser"\n',
    );

    const result = scanShellProfiles('/Users/testuser');

    expect(result.scannedProfiles).toContain('/Users/testuser/.zshrc');
    const secretVars = result.envVars.filter((v) => v.isSecret);
    expect(secretVars.length).toBeGreaterThan(0);
  });

  it('skips variable references and command substitutions', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === '/Users/testuser/.zshrc';
    });
    mockedReadFileSync.mockReturnValue(
      'export AWS_TOKEN="$(get-token)"\nexport AWS_KEY=$OTHER_VAR\n',
    );

    const result = scanShellProfiles('/Users/testuser');

    // These should be skipped because they contain $( or start with $
    expect(result.envVars).toHaveLength(0);
  });

  it('records warnings for unreadable files', () => {
    mockedExistsSync.mockImplementation((p: unknown) => {
      return String(p) === '/Users/testuser/.bashrc';
    });
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = scanShellProfiles('/Users/testuser');

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('Could not read');
  });
});
