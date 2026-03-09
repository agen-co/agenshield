import * as path from 'node:path';
import {
  SENSITIVE_FILE_PATTERNS,
  SENSITIVE_HOME_PATHS,
  expandSensitiveHomePaths,
} from '../../policies/sensitive-patterns.js';

describe('SENSITIVE_FILE_PATTERNS', () => {
  it('should be non-empty', () => {
    expect(SENSITIVE_FILE_PATTERNS.length).toBeGreaterThan(0);
  });

  it.each([
    '**/.env',
    '**/.aws/credentials',
    '**/.ssh/*',
    '**/*.pem',
    '**/.npmrc',
    '**/.kube/config',
    '**/secrets.json',
    '**/.docker/config.json',
  ])('should contain pattern %s', (pattern) => {
    expect(SENSITIVE_FILE_PATTERNS).toContain(pattern);
  });
});

describe('SENSITIVE_HOME_PATHS', () => {
  it('should be non-empty', () => {
    expect(SENSITIVE_HOME_PATHS.length).toBeGreaterThan(0);
  });

  it.each([
    '.ssh/',
    '.aws/credentials',
    '.npmrc',
    '.kube/config',
    '.docker/config.json',
  ])('should contain path %s', (p) => {
    expect(SENSITIVE_HOME_PATHS).toContain(p);
  });

  it('should have directory entries ending with /', () => {
    const dirs = SENSITIVE_HOME_PATHS.filter((p) => p.endsWith('/'));
    expect(dirs.length).toBeGreaterThan(0);
    expect(dirs).toContain('.ssh/');
  });
});

describe('expandSensitiveHomePaths', () => {
  it('should produce absolute paths from home directory', () => {
    const expanded = expandSensitiveHomePaths('/home/testuser');
    expect(expanded.length).toBe(SENSITIVE_HOME_PATHS.length);
    for (const p of expanded) {
      expect(p.startsWith('/home/testuser')).toBe(true);
    }
  });

  it('should preserve directory trailing separator', () => {
    const expanded = expandSensitiveHomePaths('/home/testuser');
    const sshEntry = expanded.find((p) => p.includes('.ssh'));
    // path.join normalizes trailing slashes, so .ssh/ becomes .ssh
    expect(sshEntry).toBe(path.join('/home/testuser', '.ssh/'));
  });

  it('should produce correct file paths', () => {
    const expanded = expandSensitiveHomePaths('/Users/test');
    expect(expanded).toContain(path.join('/Users/test', '.aws/credentials'));
    expect(expanded).toContain(path.join('/Users/test', '.npmrc'));
  });
});
