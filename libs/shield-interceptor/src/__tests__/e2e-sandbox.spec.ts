/**
 * E2E sandbox-exec tests
 *
 * These tests generate real seatbelt profiles via ProfileManager and execute
 * them with `sandbox-exec` on macOS. Skipped on non-macOS platforms.
 */

import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { ProfileManager } from '../seatbelt/profile-manager';
import type { SandboxConfig } from '@agenshield/ipc';

// Mock debugLog to suppress output during tests
jest.mock('../debug-log', () => ({
  debugLog: jest.fn(),
}));

const IS_MACOS = os.platform() === 'darwin';
const describeOnMac = IS_MACOS ? describe : describe.skip;

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

describeOnMac('E2E sandbox-exec', () => {
  let tmpDir: string;
  let profileDir: string;
  let pm: ProfileManager;

  beforeEach(() => {
    // Resolve real paths — macOS /var/folders is a symlink to /private/var/folders
    // and sandbox-exec uses resolved paths for access checks
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agenshield-e2e-')));
    profileDir = path.join(tmpDir, 'profiles');
    fs.mkdirSync(profileDir, { recursive: true });
    pm = new ProfileManager(profileDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('blocks writes to denied paths', () => {
    const restrictedDir = path.join(tmpDir, 'restricted');
    fs.mkdirSync(restrictedDir, { recursive: true });

    const config = makeConfig({
      deniedPaths: [restrictedDir],
      allowedWritePaths: [tmpDir],
    });

    const profile = pm.generateProfile(config);
    const profilePath = pm.getOrCreateProfile(profile);
    const targetFile = path.join(restrictedDir, 'secret.txt');

    // sandbox-exec should deny writing to the restricted directory
    expect(() => {
      execSync(`sandbox-exec -f "${profilePath}" /bin/sh -c 'echo test > "${targetFile}"'`, {
        stdio: 'pipe',
        timeout: 10000,
      });
    }).toThrow();

    // Verify the file was NOT created
    expect(fs.existsSync(targetFile)).toBe(false);
  });

  it('allows writes to allowed paths', () => {
    const allowedDir = path.join(tmpDir, 'allowed');
    fs.mkdirSync(allowedDir, { recursive: true });

    const config = makeConfig({
      allowedWritePaths: [allowedDir],
    });

    const profile = pm.generateProfile(config);
    const profilePath = pm.getOrCreateProfile(profile);
    const targetFile = path.join(allowedDir, 'ok.txt');

    // sandbox-exec should allow writing to the allowed directory
    execSync(`sandbox-exec -f "${profilePath}" /bin/sh -c 'echo hello > "${targetFile}"'`, {
      stdio: 'pipe',
      timeout: 10000,
    });

    expect(fs.existsSync(targetFile)).toBe(true);
    expect(fs.readFileSync(targetFile, 'utf-8').trim()).toBe('hello');
  });

  it('blocks network access when networkAllowed is false', () => {
    const config = makeConfig({
      networkAllowed: false,
      allowedWritePaths: [tmpDir],
    });

    const profile = pm.generateProfile(config);
    const profilePath = pm.getOrCreateProfile(profile);

    // curl should fail under sandbox with network denied
    expect(() => {
      execSync(
        `sandbox-exec -f "${profilePath}" /usr/bin/curl -s --max-time 5 https://example.com`,
        { stdio: 'pipe', timeout: 15000 }
      );
    }).toThrow();
  });
});
