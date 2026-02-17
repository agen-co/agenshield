/**
 * Command pattern matching — unit tests
 */

import { matchCommandPattern, extractCommandBasename } from '../command';

describe('matchCommandPattern', () => {
  describe('wildcard *', () => {
    it('matches any command', () => {
      expect(matchCommandPattern('*', 'git push')).toBe(true);
    });

    it('matches empty-ish command', () => {
      expect(matchCommandPattern('*', 'curl')).toBe(true);
    });
  });

  describe(':* suffix (prefix matching)', () => {
    it('matches exact command name without args', () => {
      expect(matchCommandPattern('git:*', 'git')).toBe(true);
    });

    it('matches command with args', () => {
      expect(matchCommandPattern('git:*', 'git push origin main')).toBe(true);
    });

    it('does not match different command', () => {
      expect(matchCommandPattern('git:*', 'curl https://example.com')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(matchCommandPattern('Git:*', 'git push')).toBe(true);
      expect(matchCommandPattern('git:*', 'GIT push')).toBe(true);
    });

    it('matches multi-word prefix', () => {
      expect(matchCommandPattern('git push:*', 'git push origin main')).toBe(true);
    });

    it('matches multi-word prefix exact', () => {
      expect(matchCommandPattern('git push:*', 'git push')).toBe(true);
    });
  });

  describe('exact match (no :*)', () => {
    it('matches exact command', () => {
      expect(matchCommandPattern('git', 'git')).toBe(true);
    });

    it('does not match command with args', () => {
      expect(matchCommandPattern('git', 'git push')).toBe(false);
    });

    it('matches multi-word exact', () => {
      expect(matchCommandPattern('git push', 'git push')).toBe(true);
    });

    it('does not match when target has extra args', () => {
      expect(matchCommandPattern('git push', 'git push origin')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(matchCommandPattern('Git', 'git')).toBe(true);
    });
  });

  describe('absolute path normalization', () => {
    it('normalizes pattern absolute path to basename', () => {
      expect(matchCommandPattern('/usr/bin/curl:*', 'curl https://example.com')).toBe(true);
    });

    it('normalizes target absolute path to basename', () => {
      expect(matchCommandPattern('curl:*', '/usr/bin/curl https://example.com')).toBe(true);
    });

    it('normalizes both pattern and target absolute paths', () => {
      expect(matchCommandPattern('/usr/bin/curl', '/usr/local/bin/curl')).toBe(true);
    });

    it('normalizes exact match with absolute path', () => {
      expect(matchCommandPattern('/usr/bin/node', 'node')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles leading/trailing whitespace in pattern', () => {
      expect(matchCommandPattern('  git:*  ', 'git push')).toBe(true);
    });

    it('handles empty pattern (does not match)', () => {
      expect(matchCommandPattern('', 'git')).toBe(false);
    });

    it('handles complex command with flags', () => {
      expect(matchCommandPattern('arp -a -n -l:*', 'arp -a -n -l extra')).toBe(true);
    });
  });
});

describe('extractCommandBasename (additional)', () => {
  it('handles empty string', () => {
    expect(extractCommandBasename('')).toBe('');
  });

  it('handles deeply nested path', () => {
    expect(extractCommandBasename('/usr/local/bin/python3 script.py')).toBe('python3');
  });
});
