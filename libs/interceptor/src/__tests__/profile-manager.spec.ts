import { ProfileManager } from '@agenshield/seatbelt';
import type { SandboxConfig } from '@agenshield/ipc';

function makeConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
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

describe('ProfileManager.generateProfile', () => {
  let pm: ProfileManager;

  beforeEach(() => {
    pm = new ProfileManager('/tmp/agenshield-test-profiles');
  });

  it('generates valid SBPL header', () => {
    const profile = pm.generateProfile(makeConfig());
    expect(profile).toContain('(version 1)');
    expect(profile).toContain('(deny default)');
  });

  it('includes file-read* allow by default', () => {
    const profile = pm.generateProfile(makeConfig());
    expect(profile).toContain('(allow file-read*)');
  });

  it('includes default temp write paths', () => {
    const profile = pm.generateProfile(makeConfig());
    expect(profile).toContain('(subpath "/tmp")');
    expect(profile).toContain('(subpath "/private/tmp")');
    expect(profile).toContain('(subpath "/var/folders")');
  });

  it('includes custom allowedWritePaths', () => {
    const profile = pm.generateProfile(makeConfig({
      allowedWritePaths: ['/home/agent/workspace', '/opt/custom'],
    }));
    expect(profile).toContain('(subpath "/home/agent/workspace")');
    expect(profile).toContain('(subpath "/opt/custom")');
  });

  it('generates deny rules for deniedPaths', () => {
    const profile = pm.generateProfile(makeConfig({
      deniedPaths: ['/etc/passwd', '/root'],
    }));
    expect(profile).toContain('(deny file-read* file-write* (subpath "/etc/passwd"))');
    expect(profile).toContain('(deny file-read* file-write* (subpath "/root"))');
  });

  it('generates allow read exceptions within denied paths', () => {
    const profile = pm.generateProfile(makeConfig({
      deniedPaths: ['/home/agent/.openclaw'],
      allowedReadPaths: ['/home/agent/.openclaw/workspace'],
    }));
    expect(profile).toContain('(deny file-read* file-write* (subpath "/home/agent/.openclaw"))');
    expect(profile).toContain('(allow file-read* (subpath "/home/agent/.openclaw/workspace"))');
  });

  it('uses literal for file binaries and subpath for directory binaries', () => {
    const profile = pm.generateProfile(makeConfig({
      allowedBinaries: ['/opt/custom/mybin', '/opt/custom/libdir/'],
    }));
    expect(profile).toContain('(literal "/opt/custom/mybin")');
    expect(profile).toContain('(subpath "/opt/custom/libdir/")');
  });

  it('generates deny rules for denied binaries', () => {
    const profile = pm.generateProfile(makeConfig({
      deniedBinaries: ['/usr/bin/dangerous'],
    }));
    expect(profile).toContain('(deny process-exec (literal "/usr/bin/dangerous"))');
  });

  it('denies network when networkAllowed is false', () => {
    const profile = pm.generateProfile(makeConfig({ networkAllowed: false }));
    expect(profile).toContain('(deny network*)');
    expect(profile).not.toContain('(allow network*)');
  });

  it('allows all network when networkAllowed is true with no restrictions', () => {
    const profile = pm.generateProfile(makeConfig({
      networkAllowed: true,
      allowedHosts: [],
      allowedPorts: [],
    }));
    expect(profile).toContain('(allow network*)');
  });

  it('generates specific host restrictions', () => {
    const profile = pm.generateProfile(makeConfig({
      networkAllowed: true,
      allowedHosts: ['localhost'],
    }));
    expect(profile).toContain('(allow network-outbound (remote tcp "localhost:*"))');
    // Localhost-only should skip DNS
    expect(profile).not.toContain('(allow network-outbound (remote udp "*:53")');
  });

  it('includes DNS for non-localhost hosts', () => {
    const profile = pm.generateProfile(makeConfig({
      networkAllowed: true,
      allowedHosts: ['api.example.com'],
    }));
    expect(profile).toContain('(allow network-outbound (remote tcp "api.example.com:*"))');
    expect(profile).toContain('(allow network-outbound (remote udp "*:53") (remote tcp "*:53"))');
  });

  it('generates port-based restrictions', () => {
    const profile = pm.generateProfile(makeConfig({
      networkAllowed: true,
      allowedPorts: [80, 443],
    }));
    expect(profile).toContain('(allow network-outbound (remote tcp "*:80"))');
    expect(profile).toContain('(allow network-outbound (remote tcp "*:443"))');
  });

  it('escapes special characters in paths', () => {
    const profile = pm.generateProfile(makeConfig({
      deniedPaths: ['/path/with "quotes"', '/path/with\\backslash'],
    }));
    expect(profile).toContain('(subpath "/path/with \\"quotes\\"")');
    expect(profile).toContain('(subpath "/path/with\\\\backslash")');
  });

  it('uses profileContent override directly', () => {
    const customProfile = '(version 1)\n(deny default)\n(allow file-read*)';
    const profile = pm.generateProfile(makeConfig({ profileContent: customProfile }));
    expect(profile).toBe(customProfile);
  });

  it('includes broker unix socket rules', () => {
    const profile = pm.generateProfile(makeConfig());
    expect(profile).toContain('(allow network-outbound (remote unix))');
    expect(profile).toContain('(allow network-inbound (local unix))');
    const home = process.env['AGENSHIELD_USER_HOME'] || process.env['HOME'] || '';
    expect(profile).toContain(`(subpath "${home}/.agenshield/run")`);
    expect(profile).toContain(`(subpath "/private${home}/.agenshield/run")`);
  });

  it('includes process-fork, signal, sysctl-read', () => {
    const profile = pm.generateProfile(makeConfig());
    expect(profile).toContain('(allow process-fork)');
    expect(profile).toContain('(allow signal (target self))');
    expect(profile).toContain('(allow sysctl-read)');
  });

  it('includes mach-lookup', () => {
    const profile = pm.generateProfile(makeConfig());
    expect(profile).toContain('(allow mach-lookup)');
  });

  it('includes device file literals', () => {
    const profile = pm.generateProfile(makeConfig());
    expect(profile).toContain('(literal "/dev/null")');
    expect(profile).toContain('(literal "/dev/zero")');
    expect(profile).toContain('(literal "/dev/random")');
    expect(profile).toContain('(literal "/dev/urandom")');
  });

  it('includes only shell necessity literals, not system dir subpaths', () => {
    const profile = pm.generateProfile(makeConfig());
    // Shell necessities as literals
    expect(profile).toContain('(literal "/bin/sh")');
    expect(profile).toContain('(literal "/bin/bash")');
    expect(profile).toContain('(literal "/usr/bin/env")');
    // System dirs must NOT be subpath-allowed
    expect(profile).not.toContain('(subpath "/bin")');
    expect(profile).not.toContain('(subpath "/sbin")');
    expect(profile).not.toContain('(subpath "/usr/bin")');
    expect(profile).not.toContain('(subpath "/usr/sbin")');
    expect(profile).not.toContain('(subpath "/usr/local/bin")');
    expect(profile).not.toContain('(subpath "/opt/agenshield/bin")');
  });

  it('includes allowedBinaries as literals (no system dir subpath dedup)', () => {
    const profile = pm.generateProfile(makeConfig({
      allowedBinaries: ['/usr/bin/node', '/bin/cat'],
    }));
    // System dirs are no longer subpath-allowed, so these appear as literals
    expect(profile).toContain('(literal "/usr/bin/node")');
    expect(profile).toContain('(literal "/bin/cat")');
  });

  it('deduplicates allowed binaries', () => {
    const profile = pm.generateProfile(makeConfig({
      allowedBinaries: ['/opt/custom/bin', '/opt/custom/bin'],
    }));
    const matches = profile.match(/\/opt\/custom\/bin/g);
    expect(matches).toHaveLength(1);
  });

  it('deduplicates denied binaries', () => {
    const profile = pm.generateProfile(makeConfig({
      deniedBinaries: ['/opt/bad/bin', '/opt/bad/bin'],
    }));
    const matches = profile.match(/\/opt\/bad\/bin/g);
    expect(matches).toHaveLength(1);
  });
});
