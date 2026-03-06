import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ProfileManager } from '../profile-manager';
import type { SandboxConfig } from '@agenshield/ipc';

function createSandbox(overrides?: Partial<SandboxConfig>): SandboxConfig {
  return {
    enabled: true,
    allowedReadPaths: [],
    allowedWritePaths: [],
    deniedPaths: [],
    networkAllowed: false,
    allowedHosts: [],
    allowedPorts: [],
    allowedBinaries: [],
    deniedBinaries: [],
    envInjection: {},
    envDeny: [],
    envAllow: [],
    ...overrides,
  };
}

describe('ProfileManager', () => {
  describe('generateProfile', () => {
    const pm = new ProfileManager('/tmp/test-profiles');

    it('generates a valid SBPL profile', () => {
      const profile = pm.generateProfile(createSandbox());
      expect(profile).toContain('(version 1)');
      expect(profile).toContain('(deny default)');
      expect(profile).toContain('(allow file-read*)');
    });

    it('uses profileContent if provided', () => {
      const sandbox = createSandbox({ profileContent: '(version 1)\n(deny default)' });
      expect(pm.generateProfile(sandbox)).toBe('(version 1)\n(deny default)');
    });

    it('includes denied paths', () => {
      const sandbox = createSandbox({ deniedPaths: ['/etc/secrets'] });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('(deny file-read* file-write* (subpath "/etc/secrets"))');
    });

    it('includes allowed read paths', () => {
      const sandbox = createSandbox({ allowedReadPaths: ['/data/public'] });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('(allow file-read* (subpath "/data/public"))');
    });

    it('denies network when networkAllowed is false', () => {
      const profile = pm.generateProfile(createSandbox({ networkAllowed: false }));
      expect(profile).toContain('(deny network*)');
    });

    it('allows specific hosts when networkAllowed with hosts', () => {
      const sandbox = createSandbox({
        networkAllowed: true,
        allowedHosts: ['localhost'],
      });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('(allow network-outbound (remote tcp "localhost:*"))');
    });

    it('allows full network when no host/port restrictions', () => {
      const sandbox = createSandbox({ networkAllowed: true });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('(allow network*)');
    });

    it('includes broker socket access', () => {
      const profile = pm.generateProfile(createSandbox({ brokerHttpPort: 5201 }));
      expect(profile).toContain('(allow network-outbound (remote tcp "localhost:5201"))');
    });

    it('includes denied binaries', () => {
      const sandbox = createSandbox({ deniedBinaries: ['/usr/bin/rm'] });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('(deny process-exec (literal "/usr/bin/rm"))');
    });
  });

  describe('getOrCreateProfile', () => {
    let tempDir: string;
    let pm: ProfileManager;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-test-'));
      pm = new ProfileManager(tempDir);
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('creates file with content-hash name (sb-{hash}.sb)', () => {
      const profilePath = pm.getOrCreateProfile('(version 1)');
      expect(path.basename(profilePath)).toMatch(/^sb-[0-9a-f]{16}\.sb$/);
      expect(fs.existsSync(profilePath)).toBe(true);
      expect(fs.readFileSync(profilePath, 'utf-8')).toBe('(version 1)');
    });

    it('returns same path for identical content (idempotent)', () => {
      const path1 = pm.getOrCreateProfile('(version 1)\n(deny default)');
      const path2 = pm.getOrCreateProfile('(version 1)\n(deny default)');
      expect(path1).toBe(path2);
    });

    it('returns different path for different content', () => {
      const path1 = pm.getOrCreateProfile('content-a');
      const path2 = pm.getOrCreateProfile('content-b');
      expect(path1).not.toBe(path2);
    });

    it('creates profile directory if not exists', () => {
      const nestedDir = path.join(tempDir, 'nested', 'profiles');
      const nestedPm = new ProfileManager(nestedDir);
      const profilePath = nestedPm.getOrCreateProfile('test content');
      expect(fs.existsSync(nestedDir)).toBe(true);
      expect(fs.existsSync(profilePath)).toBe(true);
    });
  });

  describe('cleanup', () => {
    let tempDir: string;
    let pm: ProfileManager;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-cleanup-'));
      pm = new ProfileManager(tempDir);
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('removes .sb files older than maxAgeMs', () => {
      const filePath = path.join(tempDir, 'sb-old.sb');
      fs.writeFileSync(filePath, 'old profile');
      // Set mtime to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(filePath, twoHoursAgo, twoHoursAgo);

      pm.cleanup(60 * 60 * 1000); // 1 hour max age
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('keeps .sb files newer than maxAgeMs', () => {
      const filePath = path.join(tempDir, 'sb-recent.sb');
      fs.writeFileSync(filePath, 'recent profile');

      pm.cleanup(60 * 60 * 1000); // 1 hour max age
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('skips non-.sb files', () => {
      const filePath = path.join(tempDir, 'readme.txt');
      fs.writeFileSync(filePath, 'not a profile');
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(filePath, twoHoursAgo, twoHoursAgo);

      pm.cleanup(60 * 60 * 1000);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('no-op when profileDir does not exist', () => {
      const nonExistent = new ProfileManager('/tmp/does-not-exist-seatbelt-test');
      expect(() => nonExistent.cleanup(60 * 60 * 1000)).not.toThrow();
    });

    it('resilient to stat errors on individual files', () => {
      // Create a valid .sb file so cleanup has something to iterate
      const validFile = path.join(tempDir, 'sb-valid.sb');
      fs.writeFileSync(validFile, 'valid');

      // Cleanup should not throw even if individual stat calls fail
      expect(() => pm.cleanup(60 * 60 * 1000)).not.toThrow();
    });
  });

  describe('generateProfile — write paths', () => {
    const pm = new ProfileManager('/tmp/test-profiles');

    it('always includes /tmp, /private/tmp, /var/folders', () => {
      const profile = pm.generateProfile(createSandbox());
      expect(profile).toContain('(subpath "/tmp")');
      expect(profile).toContain('(subpath "/private/tmp")');
      expect(profile).toContain('(subpath "/var/folders")');
    });

    it('includes custom allowedWritePaths', () => {
      const sandbox = createSandbox({ allowedWritePaths: ['/custom/output', '/data/logs'] });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('(subpath "/custom/output")');
      expect(profile).toContain('(subpath "/data/logs")');
    });

    it('device files as literal (not subpath)', () => {
      const profile = pm.generateProfile(createSandbox());
      expect(profile).toContain('(literal "/dev/null")');
      expect(profile).toContain('(literal "/dev/zero")');
      expect(profile).toContain('(literal "/dev/random")');
      expect(profile).toContain('(literal "/dev/urandom")');
    });
  });

  describe('generateProfile — binary execution', () => {
    const pm = new ProfileManager('/tmp/test-profiles');

    it('includes system dirs (/bin, /sbin, /usr/bin, etc.)', () => {
      const profile = pm.generateProfile(createSandbox());
      expect(profile).toContain('(subpath "/bin")');
      expect(profile).toContain('(subpath "/sbin")');
      expect(profile).toContain('(subpath "/usr/bin")');
      expect(profile).toContain('(subpath "/usr/sbin")');
      expect(profile).toContain('(subpath "/usr/local/bin")');
    });

    it('includes HOME-based paths when HOME env is set', () => {
      const origHome = process.env['HOME'];
      process.env['HOME'] = '/Users/testuser';
      try {
        const profile = pm.generateProfile(createSandbox());
        expect(profile).toContain('(subpath "/Users/testuser/bin")');
        expect(profile).toContain('(subpath "/Users/testuser/homebrew")');
      } finally {
        process.env['HOME'] = origHome;
      }
    });

    it('includes NVM_DIR from env', () => {
      const origNvm = process.env['NVM_DIR'];
      const origHome = process.env['HOME'];
      process.env['NVM_DIR'] = '/custom/nvm';
      process.env['HOME'] = '/Users/testuser';
      try {
        const profile = pm.generateProfile(createSandbox());
        expect(profile).toContain('(subpath "/custom/nvm")');
      } finally {
        process.env['NVM_DIR'] = origNvm;
        process.env['HOME'] = origHome;
      }
    });

    it('includes HOMEBREW_PREFIX when set and not under HOME', () => {
      const origBrew = process.env['HOMEBREW_PREFIX'];
      const origHome = process.env['HOME'];
      process.env['HOME'] = '/Users/testuser';
      process.env['HOMEBREW_PREFIX'] = '/opt/homebrew';
      try {
        const profile = pm.generateProfile(createSandbox());
        expect(profile).toContain('(subpath "/opt/homebrew/bin")');
        expect(profile).toContain('(subpath "/opt/homebrew/lib")');
      } finally {
        process.env['HOMEBREW_PREFIX'] = origBrew;
        process.env['HOME'] = origHome;
      }
    });

    it('skips HOMEBREW_PREFIX when it is under HOME (already covered)', () => {
      const origBrew = process.env['HOMEBREW_PREFIX'];
      const origHome = process.env['HOME'];
      process.env['HOME'] = '/Users/testuser';
      process.env['HOMEBREW_PREFIX'] = '/Users/testuser/homebrew';
      try {
        const profile = pm.generateProfile(createSandbox());
        // Should NOT contain homebrew/bin as separate entry since HOME covers it
        expect(profile).not.toContain('(subpath "/Users/testuser/homebrew/bin")');
      } finally {
        process.env['HOMEBREW_PREFIX'] = origBrew;
        process.env['HOME'] = origHome;
      }
    });

    it('deduplicates binaries already covered by system dirs', () => {
      const sandbox = createSandbox({
        allowedBinaries: ['/usr/bin/git', '/usr/local/bin/node'],
      });
      const profile = pm.generateProfile(sandbox);
      // These should be skipped since /usr/bin and /usr/local/bin are already subpaths
      // The profile should NOT contain literal entries for these
      const lines = profile.split('\n');
      const literalGit = lines.filter(l => l.includes('(literal "/usr/bin/git")'));
      const literalNode = lines.filter(l => l.includes('(literal "/usr/local/bin/node")'));
      expect(literalGit.length).toBe(0);
      expect(literalNode.length).toBe(0);
    });

    it('trailing-slash binary → subpath rule', () => {
      const sandbox = createSandbox({
        allowedBinaries: ['/custom/tools/'],
      });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('(subpath "/custom/tools/")');
    });

    it('non-slash binary → literal rule', () => {
      const sandbox = createSandbox({
        allowedBinaries: ['/custom/tools/mytool'],
      });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('(literal "/custom/tools/mytool")');
    });
  });

  describe('generateProfile — network', () => {
    const pm = new ProfileManager('/tmp/test-profiles');

    it('port-only rules (no hosts)', () => {
      const sandbox = createSandbox({
        networkAllowed: true,
        allowedPorts: [8080, 3000],
      });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('(allow network-outbound (remote tcp "*:8080"))');
      expect(profile).toContain('(allow network-outbound (remote tcp "*:3000"))');
    });

    it('mixed hosts + ports', () => {
      const sandbox = createSandbox({
        networkAllowed: true,
        allowedHosts: ['api.example.com'],
        allowedPorts: [443],
      });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('(allow network-outbound (remote tcp "api.example.com:*"))');
      expect(profile).toContain('(allow network-outbound (remote tcp "*:443"))');
    });

    it('localhost-only → no DNS rules', () => {
      const sandbox = createSandbox({
        networkAllowed: true,
        allowedHosts: ['localhost'],
      });
      const profile = pm.generateProfile(sandbox);
      expect(profile).not.toContain('(allow network-outbound (remote udp "*:53")');
    });

    it('non-localhost hosts → includes DNS rules', () => {
      const sandbox = createSandbox({
        networkAllowed: true,
        allowedHosts: ['api.example.com'],
      });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('(allow network-outbound (remote udp "*:53") (remote tcp "*:53"))');
    });

    it('127.0.0.1 normalized to "localhost" in SBPL', () => {
      const sandbox = createSandbox({
        networkAllowed: true,
        allowedHosts: ['127.0.0.1'],
      });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('(allow network-outbound (remote tcp "localhost:*"))');
      expect(profile).not.toContain('127.0.0.1');
    });

    it('::1 normalized to "localhost" in SBPL', () => {
      const sandbox = createSandbox({
        networkAllowed: true,
        allowedHosts: ['::1'],
      });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('(allow network-outbound (remote tcp "localhost:*"))');
      expect(profile).not.toContain('::1');
    });
  });

  describe('generateProfile — broker', () => {
    const pm = new ProfileManager('/tmp/test-profiles');

    it('default broker port (5201) used when not specified', () => {
      const profile = pm.generateProfile(createSandbox());
      expect(profile).toContain('(allow network-outbound (remote tcp "localhost:5201"))');
    });

    it('custom brokerHttpPort used', () => {
      const profile = pm.generateProfile(createSandbox({ brokerHttpPort: 7777 }));
      expect(profile).toContain('(allow network-outbound (remote tcp "localhost:7777"))');
    });

    it('Unix socket rules always present', () => {
      const profile = pm.generateProfile(createSandbox());
      expect(profile).toContain('(allow network-outbound (remote unix))');
      expect(profile).toContain('(allow network-inbound (local unix))');
    });

    it('~/.agenshield/run paths always present', () => {
      const home = process.env['AGENSHIELD_USER_HOME'] || process.env['HOME'] || '';
      const profile = pm.generateProfile(createSandbox());
      expect(profile).toContain(`(subpath "${home}/.agenshield/run")`);
      expect(profile).toContain(`(subpath "/private${home}/.agenshield/run")`);
    });
  });

  describe('generateProfile — process management', () => {
    const pm = new ProfileManager('/tmp/test-profiles');

    it('includes process-fork, signal, sysctl-read, mach-lookup', () => {
      const profile = pm.generateProfile(createSandbox());
      expect(profile).toContain('(allow process-fork)');
      expect(profile).toContain('(allow signal (target self))');
      expect(profile).toContain('(allow sysctl-read)');
      expect(profile).toContain('(allow mach-lookup)');
    });
  });

  describe('escapeSbpl (via generateProfile)', () => {
    const pm = new ProfileManager('/tmp/test-profiles');

    it('escapes backslashes', () => {
      const sandbox = createSandbox({
        allowedWritePaths: ['/path/with\\backslash'],
      });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('/path/with\\\\backslash');
    });

    it('escapes double quotes', () => {
      const sandbox = createSandbox({
        allowedWritePaths: ['/path/with"quote'],
      });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('/path/with\\"quote');
    });

    it('paths with special chars in SBPL output', () => {
      const sandbox = createSandbox({
        deniedPaths: ['/dir/with "quotes" and \\slashes'],
      });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('/dir/with \\"quotes\\" and \\\\slashes');
    });
  });

  describe('generateProfile — multiple denied/allowed paths', () => {
    const pm = new ProfileManager('/tmp/test-profiles');

    it('handles multiple denied paths', () => {
      const sandbox = createSandbox({
        deniedPaths: ['/secret/a', '/secret/b', '/private/keys'],
      });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('(deny file-read* file-write* (subpath "/secret/a"))');
      expect(profile).toContain('(deny file-read* file-write* (subpath "/secret/b"))');
      expect(profile).toContain('(deny file-read* file-write* (subpath "/private/keys"))');
    });

    it('handles multiple allowed read paths', () => {
      const sandbox = createSandbox({
        allowedReadPaths: ['/data/a', '/data/b'],
      });
      const profile = pm.generateProfile(sandbox);
      expect(profile).toContain('(allow file-read* (subpath "/data/a"))');
      expect(profile).toContain('(allow file-read* (subpath "/data/b"))');
    });
  });

  describe('generateProfile — env-dependent branches', () => {
    const pm = new ProfileManager('/tmp/test-profiles');

    it('skips HOME-based paths when HOME is not set', () => {
      const origHome = process.env['HOME'];
      const origNvm = process.env['NVM_DIR'];
      const origBrew = process.env['HOMEBREW_PREFIX'];
      delete process.env['HOME'];
      delete process.env['NVM_DIR'];
      delete process.env['HOMEBREW_PREFIX'];
      try {
        const profile = pm.generateProfile(createSandbox());
        // Should still have system paths
        expect(profile).toContain('(subpath "/usr/bin")');
        // No HOME-derived ~/bin or ~/homebrew paths (only system /bin is present)
        const lines = profile.split('\n');
        const homeBinLines = lines.filter(l =>
          l.includes('/bin")') &&
          !l.includes('/usr/') &&
          !l.includes('/sbin') &&
          !l.includes('/opt/') &&
          !l.includes('"/bin"'),  // system /bin
        );
        expect(homeBinLines.length).toBe(0);
        // NVM_DIR fallback requires HOME — with both unset, no .nvm subpath
        expect(profile).not.toContain('.nvm');
      } finally {
        process.env['HOME'] = origHome;
        if (origNvm !== undefined) process.env['NVM_DIR'] = origNvm;
        if (origBrew !== undefined) process.env['HOMEBREW_PREFIX'] = origBrew;
      }
    });

    it('NVM_DIR falls back to HOME/.nvm when NVM_DIR not set', () => {
      const origHome = process.env['HOME'];
      const origNvm = process.env['NVM_DIR'];
      process.env['HOME'] = '/Users/testfallback';
      delete process.env['NVM_DIR'];
      try {
        const profile = pm.generateProfile(createSandbox());
        expect(profile).toContain('(subpath "/Users/testfallback/.nvm")');
      } finally {
        process.env['HOME'] = origHome;
        if (origNvm !== undefined) process.env['NVM_DIR'] = origNvm;
      }
    });

    it('HOMEBREW_PREFIX skipped when HOME is not set', () => {
      const origHome = process.env['HOME'];
      const origBrew = process.env['HOMEBREW_PREFIX'];
      delete process.env['HOME'];
      process.env['HOMEBREW_PREFIX'] = '/opt/homebrew';
      try {
        const profile = pm.generateProfile(createSandbox());
        // With no HOME, the condition `!home || !brewPrefix.startsWith(home)` → true
        expect(profile).toContain('(subpath "/opt/homebrew/bin")');
        expect(profile).toContain('(subpath "/opt/homebrew/lib")');
      } finally {
        process.env['HOME'] = origHome;
        if (origBrew !== undefined) {
          process.env['HOMEBREW_PREFIX'] = origBrew;
        } else {
          delete process.env['HOMEBREW_PREFIX'];
        }
      }
    });

    it('brokerHttpPort defaults to 5201 when 0', () => {
      const profile = pm.generateProfile(createSandbox({ brokerHttpPort: 0 }));
      expect(profile).toContain('(allow network-outbound (remote tcp "localhost:5201"))');
    });
  });

  describe('getOrCreateProfileAsync', () => {
    let tempDir: string;
    let pm: ProfileManager;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-async-'));
      pm = new ProfileManager(tempDir);
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('creates file with content-hash name (sb-{hash}.sb)', async () => {
      const profilePath = await pm.getOrCreateProfileAsync('(version 1)');
      expect(path.basename(profilePath)).toMatch(/^sb-[0-9a-f]{16}\.sb$/);
      expect(fs.existsSync(profilePath)).toBe(true);
      expect(fs.readFileSync(profilePath, 'utf-8')).toBe('(version 1)');
    });

    it('returns same path for identical content (idempotent)', async () => {
      const path1 = await pm.getOrCreateProfileAsync('(version 1)\n(deny default)');
      const path2 = await pm.getOrCreateProfileAsync('(version 1)\n(deny default)');
      expect(path1).toBe(path2);
    });

    it('returns different path for different content', async () => {
      const path1 = await pm.getOrCreateProfileAsync('content-a');
      const path2 = await pm.getOrCreateProfileAsync('content-b');
      expect(path1).not.toBe(path2);
    });

    it('creates profile directory if not exists', async () => {
      const nestedDir = path.join(tempDir, 'nested', 'async-profiles');
      const nestedPm = new ProfileManager(nestedDir);
      const profilePath = await nestedPm.getOrCreateProfileAsync('test content');
      expect(fs.existsSync(nestedDir)).toBe(true);
      expect(fs.existsSync(profilePath)).toBe(true);
    });
  });

  describe('cleanupAsync', () => {
    let tempDir: string;
    let pm: ProfileManager;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-cleanup-async-'));
      pm = new ProfileManager(tempDir);
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('removes .sb files older than maxAgeMs', async () => {
      const filePath = path.join(tempDir, 'sb-old.sb');
      fs.writeFileSync(filePath, 'old profile');
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(filePath, twoHoursAgo, twoHoursAgo);

      await pm.cleanupAsync(60 * 60 * 1000);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('keeps .sb files newer than maxAgeMs', async () => {
      const filePath = path.join(tempDir, 'sb-recent.sb');
      fs.writeFileSync(filePath, 'recent profile');

      await pm.cleanupAsync(60 * 60 * 1000);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('skips non-.sb files', async () => {
      const filePath = path.join(tempDir, 'readme.txt');
      fs.writeFileSync(filePath, 'not a profile');
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(filePath, twoHoursAgo, twoHoursAgo);

      await pm.cleanupAsync(60 * 60 * 1000);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('no-op when profileDir does not exist', async () => {
      const nonExistent = new ProfileManager('/tmp/does-not-exist-seatbelt-async-test');
      await expect(nonExistent.cleanupAsync(60 * 60 * 1000)).resolves.toBeUndefined();
    });
  });

  describe('ensureDirAsync — chmod branch', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-chmod-async-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('chmod applied when dir exists with restrictive permissions', async () => {
      const profileDir = path.join(tempDir, 'profiles');
      fs.mkdirSync(profileDir, { mode: 0o755 });

      const pm = new ProfileManager(profileDir);
      await pm.getOrCreateProfileAsync('(version 1)');

      const stat = fs.statSync(profileDir);
      expect(stat.mode & 0o7777).toBe(0o1777);
    });

    it('no chmod when dir already has 0o777 permissions', async () => {
      const profileDir = path.join(tempDir, 'profiles');
      fs.mkdirSync(profileDir);
      fs.chmodSync(profileDir, 0o1777);

      const pm = new ProfileManager(profileDir);
      await pm.getOrCreateProfileAsync('(version 1)');

      const stat = fs.statSync(profileDir);
      expect(stat.mode & 0o7777).toBe(0o1777);
    });

    it('creates directory when it does not exist', async () => {
      const profileDir = path.join(tempDir, 'new-async-dir');

      const pm = new ProfileManager(profileDir);
      await pm.getOrCreateProfileAsync('(version 1)');

      expect(fs.existsSync(profileDir)).toBe(true);
    });
  });

  describe('ensureDir — chmod branch', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-chmod-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('chmod applied when dir exists with restrictive permissions', () => {
      // Create dir with restrictive perms
      const profileDir = path.join(tempDir, 'profiles');
      fs.mkdirSync(profileDir, { mode: 0o755 });

      const pm = new ProfileManager(profileDir);
      // getOrCreateProfile triggers ensureDir
      pm.getOrCreateProfile('(version 1)');

      const stat = fs.statSync(profileDir);
      // Should have been chmod'd to 0o1777 (sticky + rwxrwxrwx)
      expect(stat.mode & 0o7777).toBe(0o1777);
    });

    it('no chmod when dir already has 0o777 permissions', () => {
      const profileDir = path.join(tempDir, 'profiles');
      fs.mkdirSync(profileDir);
      // Explicitly chmod to 0o1777 after creation (mkdirSync respects umask)
      fs.chmodSync(profileDir, 0o1777);

      const pm = new ProfileManager(profileDir);
      pm.getOrCreateProfile('(version 1)');

      // Verify the dir still has the expected permissions (wasn't changed)
      const stat = fs.statSync(profileDir);
      expect(stat.mode & 0o7777).toBe(0o1777);
    });
  });
});
