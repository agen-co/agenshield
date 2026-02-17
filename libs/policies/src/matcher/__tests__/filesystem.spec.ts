/**
 * Filesystem pattern matching — unit tests
 */

import { matchFilesystemPattern } from '../filesystem';

describe('matchFilesystemPattern', () => {
  describe('directory trailing slash', () => {
    it('auto-appends ** for directory patterns', () => {
      expect(matchFilesystemPattern('/tmp/', '/tmp/foo/bar.txt')).toBe(true);
    });

    it('matches immediate children', () => {
      expect(matchFilesystemPattern('/etc/', '/etc/passwd')).toBe(true);
    });

    it('does not match parent directory', () => {
      expect(matchFilesystemPattern('/tmp/', '/var/tmp')).toBe(false);
    });
  });

  describe('glob patterns', () => {
    it('matches **/.env anywhere in path', () => {
      expect(matchFilesystemPattern('**/.env', '/home/user/project/.env')).toBe(true);
    });

    it('matches *.txt extension', () => {
      expect(matchFilesystemPattern('/data/*.txt', '/data/report.txt')).toBe(true);
    });

    it('does not match wrong extension', () => {
      expect(matchFilesystemPattern('/data/*.txt', '/data/report.json')).toBe(false);
    });

    it('matches /etc/** deep paths', () => {
      expect(matchFilesystemPattern('/etc/**', '/etc/ssh/sshd_config')).toBe(true);
    });

    it('matches ? single character', () => {
      expect(matchFilesystemPattern('/tmp/file?.log', '/tmp/file1.log')).toBe(true);
      expect(matchFilesystemPattern('/tmp/file?.log', '/tmp/file12.log')).toBe(false);
    });
  });

  describe('case insensitivity', () => {
    it('matches case-insensitively', () => {
      expect(matchFilesystemPattern('/Data/Report.TXT', '/data/report.txt')).toBe(true);
    });

    it('matches mixed case glob', () => {
      expect(matchFilesystemPattern('/HOME/**', '/home/user/file')).toBe(true);
    });
  });

  describe('exact paths', () => {
    it('matches exact absolute path', () => {
      expect(matchFilesystemPattern('/etc/passwd', '/etc/passwd')).toBe(true);
    });

    it('does not match different path', () => {
      expect(matchFilesystemPattern('/etc/passwd', '/etc/shadow')).toBe(false);
    });

    it('does not match subpath of exact pattern', () => {
      expect(matchFilesystemPattern('/etc/passwd', '/etc/passwd/extra')).toBe(false);
    });
  });
});
