/**
 * Integration tests for @agenshield/seatbelt
 *
 * Use-case-driven tests that wire the full pipeline together:
 * buildSandboxConfig → generateProfile → getOrCreateProfile → filterEnvByAllowlist + env injection/deny
 *
 * macOS-only tests use real `sandbox-exec` enforcement where applicable.
 */

import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { buildSandboxConfig } from '../config-builder';
import type { SeatbeltDeps, BuildSandboxInput, SharedCapabilities } from '../config-builder';
import { ProfileManager } from '../profile-manager';
import { filterEnvByAllowlist } from '../env-allowlist';
import type { GraphEffects } from '@agenshield/policies';
import type { SandboxConfig } from '@agenshield/ipc';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IS_MACOS = os.platform() === 'darwin';
const describeOnMac = IS_MACOS ? describe : describe.skip;

function makeDeps(overrides?: Partial<SeatbeltDeps>): SeatbeltDeps {
  return {
    getPolicies: () => [],
    defaultAction: 'deny',
    agentHome: '/Users/test_agent',
    brokerHttpPort: 5201,
    ...overrides,
  };
}

function emptyEffects(): GraphEffects {
  return {
    grantedNetworkPatterns: [],
    grantedFsPaths: { read: [], write: [] },
    injectedSecrets: {},
    activatedPolicyIds: [],
    denied: false,
    deferredActivations: [],
  };
}

/**
 * Replicate the exact env pipeline from ChildProcessInterceptor.wrapWithSeatbelt:
 * filter → inject → deny
 */
function applyEnvPipeline(
  sandbox: SandboxConfig,
  sourceEnv: Record<string, string>,
): Record<string, string> {
  const env = filterEnvByAllowlist(sourceEnv, sandbox.envAllow);
  if (sandbox.envInjection) {
    Object.assign(env, sandbox.envInjection);
  }
  if (sandbox.envDeny) {
    for (const key of sandbox.envDeny) {
      delete env[key];
    }
  }
  return env;
}

// ---------------------------------------------------------------------------
// 1. Simple non-network command (`ls`)
// ---------------------------------------------------------------------------

describe('Integration: simple non-network command (ls)', () => {
  let tmpDir: string;
  let pm: ProfileManager;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-int-')));
    pm = new ProfileManager(path.join(tmpDir, 'profiles'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('config → profile pipeline: produces valid SBPL with (deny network*)', async () => {
    const sandbox = await buildSandboxConfig(makeDeps(), { target: 'ls -la' });
    const profile = pm.generateProfile(sandbox);
    const profilePath = pm.getOrCreateProfile(profile);

    expect(sandbox.networkAllowed).toBe(false);
    expect(profile).toContain('(deny network*)');
    expect(profile).toContain('(version 1)');
    expect(fs.existsSync(profilePath)).toBe(true);
  });

  it('profile written to disk with hash filename', async () => {
    const sandbox = await buildSandboxConfig(makeDeps(), { target: 'ls -la' });
    const profile = pm.generateProfile(sandbox);
    const profilePath = pm.getOrCreateProfile(profile);

    expect(path.basename(profilePath)).toMatch(/^sb-[a-f0-9]{16}\.sb$/);
    const content = fs.readFileSync(profilePath, 'utf-8');
    expect(content).toBe(profile);
  });

  it('env pipeline: HOME/PATH pass, AWS_SECRET_ACCESS_KEY stripped', async () => {
    const sandbox = await buildSandboxConfig(makeDeps(), { target: 'ls -la' });
    const sourceEnv: Record<string, string> = {
      HOME: '/Users/test',
      PATH: '/usr/bin',
      AWS_SECRET_ACCESS_KEY: 'supersecret',
      SHELL: '/bin/zsh',
    };
    const env = applyEnvPipeline(sandbox, sourceEnv);

    expect(env['HOME']).toBe('/Users/test');
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
  });

  it('NODE_OPTIONS: base allowlist permits it, but envDeny strips it', async () => {
    const sandbox = await buildSandboxConfig(makeDeps(), { target: 'ls -la' });
    const sourceEnv: Record<string, string> = {
      HOME: '/Users/test',
      PATH: '/usr/bin',
      NODE_OPTIONS: '--max-old-space-size=4096',
    };

    // filterEnvByAllowlist passes NODE_OPTIONS (it's in the allowlist)
    const filtered = filterEnvByAllowlist(sourceEnv);
    expect(filtered['NODE_OPTIONS']).toBe('--max-old-space-size=4096');

    // But the full pipeline strips it via envDeny
    const env = applyEnvPipeline(sandbox, sourceEnv);
    expect(env['NODE_OPTIONS']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Proxied network command (`curl`)
// ---------------------------------------------------------------------------

describe('Integration: proxied network command (curl)', () => {
  it('config → profile: network allowed only to localhost, no DNS rules', async () => {
    const deps = makeDeps({
      acquireProxy: async () => ({ port: 12345 }),
    });
    const sandbox = await buildSandboxConfig(deps, { target: 'curl https://example.com' });
    const pm = new ProfileManager(os.tmpdir());
    const profile = pm.generateProfile(sandbox);

    expect(sandbox.networkAllowed).toBe(true);
    expect(sandbox.allowedHosts).toContain('localhost');
    expect(profile).toContain('(allow network-outbound (remote tcp "localhost:*"))');
    // Localhost-only → no DNS rules
    expect(profile).not.toContain('(allow network-outbound (remote udp "*:53")');
  });

  it('all 6 proxy env vars injected and survive env pipeline', async () => {
    const deps = makeDeps({
      acquireProxy: async () => ({ port: 9090 }),
    });
    const sandbox = await buildSandboxConfig(deps, { target: 'curl https://api.com' });
    const env = applyEnvPipeline(sandbox, { HOME: '/Users/test', PATH: '/usr/bin' });

    const proxyUrl = 'http://127.0.0.1:9090';
    expect(env['HTTP_PROXY']).toBe(proxyUrl);
    expect(env['HTTPS_PROXY']).toBe(proxyUrl);
    expect(env['ALL_PROXY']).toBe(proxyUrl);
    expect(env['http_proxy']).toBe(proxyUrl);
    expect(env['https_proxy']).toBe(proxyUrl);
    expect(env['all_proxy']).toBe(proxyUrl);
  });

  it('trace IDs survive the full env pipeline (AGENSHIELD_* prefix match)', async () => {
    const deps = makeDeps({
      acquireProxy: async () => ({ port: 8888 }),
    });
    const sandbox = await buildSandboxConfig(deps, {
      target: 'curl https://api.com',
      traceId: 'trace-xyz-789',
      depth: 2,
    });
    const env = applyEnvPipeline(sandbox, { HOME: '/Users/test', PATH: '/usr/bin' });

    expect(env['AGENSHIELD_TRACE_ID']).toBe('trace-xyz-789');
    expect(env['AGENSHIELD_DEPTH']).toBe('2');
    expect(env['AGENSHIELD_EXEC_ID']).toBeDefined();
  });

  it('graph-granted network patterns elevate non-network command to proxy', async () => {
    let acquireCalled = false;
    const deps = makeDeps({
      acquireProxy: async () => {
        acquireCalled = true;
        return { port: 7777 };
      },
    });
    const effects = emptyEffects();
    effects.grantedNetworkPatterns = ['api.internal.com'];

    // python3 is not in NETWORK_COMMANDS, but graph grant forces proxy
    const sandbox = await buildSandboxConfig(deps, { target: 'python3 script.py', effects });
    expect(acquireCalled).toBe(true);
    expect(sandbox.networkAllowed).toBe(true);
    expect(sandbox.allowedHosts).toContain('localhost');
  });

  it('shared network patterns from parent elevate non-network command to proxy', async () => {
    let acquireCalled = false;
    const deps = makeDeps({
      acquireProxy: async () => {
        acquireCalled = true;
        return { port: 6666 };
      },
    });
    const shared: SharedCapabilities = {
      networkPatterns: ['api.parent.com'],
      fsPaths: { read: [], write: [] },
      secretNames: [],
    };

    const sandbox = await buildSandboxConfig(deps, {
      target: 'echo hello',
      sharedCapabilities: shared,
    });
    expect(acquireCalled).toBe(true);
    expect(sandbox.networkAllowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Policy-denied path blocked by sandbox-exec (macOS)
// ---------------------------------------------------------------------------

describe('Integration: policy-denied paths', () => {
  let tmpDir: string;
  let pm: ProfileManager;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-int-')));
    pm = new ProfileManager(path.join(tmpDir, 'profiles'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deny policy → deniedPaths in sandbox → deny rule in profile', async () => {
    const restrictedDir = path.join(tmpDir, 'restricted');
    fs.mkdirSync(restrictedDir, { recursive: true });

    const deps = makeDeps({
      getPolicies: () => [{
        id: 'd1', name: 'Deny SSH', target: 'filesystem' as const,
        action: 'deny' as const, patterns: [restrictedDir], enabled: true,
      }],
    });
    const sandbox = await buildSandboxConfig(deps, { target: 'cat secret' });
    expect(sandbox.deniedPaths).toContain(restrictedDir);

    const profile = pm.generateProfile(sandbox);
    expect(profile).toContain(`(deny file-read* file-write* (subpath "${restrictedDir}"))`);
  });

  it('graph-granted write path appears in SBPL profile', async () => {
    const writePath = path.join(tmpDir, 'output');
    fs.mkdirSync(writePath, { recursive: true });

    const effects = emptyEffects();
    effects.grantedFsPaths.write = [writePath];

    const sandbox = await buildSandboxConfig(makeDeps(), { effects });
    expect(sandbox.allowedWritePaths).toContain(writePath);

    const profile = pm.generateProfile(sandbox);
    expect(profile).toContain(`(subpath "${writePath}")`);
  });

  describeOnMac('sandbox-exec enforcement', () => {
    it('deny policy → sandbox-exec blocks read', async () => {
      const restrictedDir = path.join(tmpDir, 'restricted');
      fs.mkdirSync(restrictedDir, { recursive: true });
      fs.writeFileSync(path.join(restrictedDir, 'secret.txt'), 'top-secret');

      const deps = makeDeps({
        agentHome: tmpDir,
        getPolicies: () => [{
          id: 'd1', name: 'Deny restricted', target: 'filesystem' as const,
          action: 'deny' as const, patterns: [restrictedDir], enabled: true,
        }],
      });
      const sandbox = await buildSandboxConfig(deps, { target: 'cat secret.txt' });
      const profile = pm.generateProfile(sandbox);
      const profilePath = pm.getOrCreateProfile(profile);

      expect(() => {
        execSync(
          `sandbox-exec -f "${profilePath}" /bin/cat "${path.join(restrictedDir, 'secret.txt')}"`,
          { stdio: 'pipe', timeout: 10000 },
        );
      }).toThrow();
    });

    it('graph-granted write path → sandbox-exec permits write', async () => {
      const writeDir = path.join(tmpDir, 'writable');
      fs.mkdirSync(writeDir, { recursive: true });

      const effects = emptyEffects();
      effects.grantedFsPaths.write = [writeDir];

      const deps = makeDeps({ agentHome: tmpDir });
      const sandbox = await buildSandboxConfig(deps, { effects });
      const profile = pm.generateProfile(sandbox);
      const profilePath = pm.getOrCreateProfile(profile);
      const targetFile = path.join(writeDir, 'ok.txt');

      execSync(
        `sandbox-exec -f "${profilePath}" /bin/sh -c 'echo hello > "${targetFile}"'`,
        { stdio: 'pipe', timeout: 10000 },
      );

      expect(fs.existsSync(targetFile)).toBe(true);
      expect(fs.readFileSync(targetFile, 'utf-8').trim()).toBe('hello');
    });

    it('non-network command profile blocks curl', async () => {
      const deps = makeDeps({ agentHome: tmpDir });
      const sandbox = await buildSandboxConfig(deps, { target: 'ls' });
      const profile = pm.generateProfile(sandbox);
      const profilePath = pm.getOrCreateProfile(profile);

      expect(() => {
        execSync(
          `sandbox-exec -f "${profilePath}" /usr/bin/curl -s --max-time 5 https://example.com`,
          { stdio: 'pipe', timeout: 15000 },
        );
      }).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Shared secrets injected, sensitive vars stripped
// ---------------------------------------------------------------------------

describe('Integration: shared secrets and sensitive vars', () => {
  it('shared secret names resolved → appear in child env after pipeline', async () => {
    const shared: SharedCapabilities = {
      networkPatterns: [],
      fsPaths: { read: [], write: [] },
      secretNames: ['DB_PASSWORD', 'API_KEY'],
    };
    const deps = makeDeps({
      resolveSecrets: (names) => {
        const vault: Record<string, string> = { DB_PASSWORD: 'pass123', API_KEY: 'key-abc' };
        const result: Record<string, string> = {};
        for (const n of names) {
          if (vault[n]) result[n] = vault[n];
        }
        return result;
      },
    });
    const sandbox = await buildSandboxConfig(deps, { sharedCapabilities: shared, target: 'echo hi' });
    const env = applyEnvPipeline(sandbox, { HOME: '/Users/test', PATH: '/usr/bin' });

    expect(env['DB_PASSWORD']).toBe('pass123');
    expect(env['API_KEY']).toBe('key-abc');
  });

  it('graph-injected secrets override pre-existing parent env vars', async () => {
    const effects = emptyEffects();
    effects.injectedSecrets = { MY_TOKEN: 'graph-override' };

    const sandbox = await buildSandboxConfig(makeDeps(), { effects, target: 'echo hi' });
    const env = applyEnvPipeline(sandbox, {
      HOME: '/Users/test',
      PATH: '/usr/bin',
      MY_TOKEN: 'parent-value',
    });

    // envInjection overrides (Object.assign after filter)
    expect(env['MY_TOKEN']).toBe('graph-override');
  });

  it('sensitive parent vars stripped by allowlist filtering', async () => {
    const sandbox = await buildSandboxConfig(makeDeps(), { target: 'echo hi' });
    const env = applyEnvPipeline(sandbox, {
      HOME: '/Users/test',
      PATH: '/usr/bin',
      AWS_SECRET_ACCESS_KEY: 'AKIA...',
      DATABASE_URL: 'postgres://user:pass@host/db',
      GITHUB_TOKEN: 'ghp_xxxx',
    });

    expect(env['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    expect(env['DATABASE_URL']).toBeUndefined();
    expect(env['GITHUB_TOKEN']).toBeUndefined();
    expect(env['HOME']).toBe('/Users/test');
  });

  it('envAllow extension from policy permits custom vars (MY_APP_*)', async () => {
    const sandbox = await buildSandboxConfig(makeDeps(), { target: 'echo hi' });
    sandbox.envAllow = ['MY_APP_*'];

    const env = applyEnvPipeline(sandbox, {
      HOME: '/Users/test',
      PATH: '/usr/bin',
      MY_APP_DEBUG: 'true',
      MY_APP_PORT: '3000',
      RANDOM_VAR: 'nope',
    });

    expect(env['MY_APP_DEBUG']).toBe('true');
    expect(env['MY_APP_PORT']).toBe('3000');
    expect(env['RANDOM_VAR']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Fork command env pipeline
// ---------------------------------------------------------------------------

describe('Integration: fork command env pipeline', () => {
  it('fork:node strips prefix for network heuristic → network command', async () => {
    const deps = makeDeps({
      acquireProxy: async () => ({ port: 11111 }),
    });
    const sandbox = await buildSandboxConfig(deps, { target: 'fork:node script.js' });

    // node is a known network command → proxy mode
    expect(sandbox.networkAllowed).toBe(true);
    expect(sandbox.allowedHosts).toContain('localhost');
  });

  it('fork:/usr/bin/node — absolute binary added to allowedBinaries', async () => {
    const sandbox = await buildSandboxConfig(makeDeps({
      acquireProxy: async () => ({ port: 22222 }),
    }), { target: 'fork:/usr/bin/node app.js' });

    expect(sandbox.allowedBinaries).toContain('/usr/bin/node');
  });

  it('full env pipeline for fork: NODE_OPTIONS denied, trace IDs injected', async () => {
    const deps = makeDeps({
      acquireProxy: async () => ({ port: 33333 }),
    });
    const sandbox = await buildSandboxConfig(deps, {
      target: 'fork:node index.js',
      traceId: 'fork-trace-001',
      depth: 1,
    });
    const env = applyEnvPipeline(sandbox, {
      HOME: '/Users/test',
      PATH: '/usr/bin',
      NODE_OPTIONS: '--inspect',
    });

    expect(env['NODE_OPTIONS']).toBeUndefined();
    expect(env['AGENSHIELD_TRACE_ID']).toBe('fork-trace-001');
    expect(env['AGENSHIELD_DEPTH']).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// 6. Fail-open restrictive sandbox
// ---------------------------------------------------------------------------

describe('Integration: fail-open restrictive sandbox', () => {
  let tmpDir: string;
  let pm: ProfileManager;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-int-')));
    pm = new ProfileManager(path.join(tmpDir, 'profiles'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fail-open config → valid SBPL with no network', async () => {
    // Fail-open: no acquireProxy, non-network command
    const sandbox = await buildSandboxConfig(makeDeps(), { target: 'echo test' });
    const profile = pm.generateProfile(sandbox);

    expect(profile).toContain('(version 1)');
    expect(profile).toContain('(deny network*)');
    expect(sandbox.networkAllowed).toBe(false);
  });

  it('fail-open env pipeline: only base allowlist vars, no injection', async () => {
    const sandbox = await buildSandboxConfig(makeDeps(), { target: 'echo test' });
    const env = applyEnvPipeline(sandbox, {
      HOME: '/Users/test',
      PATH: '/usr/bin',
      SHELL: '/bin/zsh',
      SECRET_KEY: 'should-not-pass',
    });

    expect(env['HOME']).toBe('/Users/test');
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['SHELL']).toBe('/bin/zsh');
    expect(env['SECRET_KEY']).toBeUndefined();
    // No proxy vars injected
    expect(env['HTTP_PROXY']).toBeUndefined();
  });

  describeOnMac('sandbox-exec enforcement', () => {
    it('fail-open profile allows basic execution but blocks network', async () => {
      const deps = makeDeps({ agentHome: tmpDir });
      const sandbox = await buildSandboxConfig(deps, { target: 'echo test' });
      const profile = pm.generateProfile(sandbox);
      const profilePath = pm.getOrCreateProfile(profile);

      // echo should work
      const result = execSync(
        `sandbox-exec -f "${profilePath}" /bin/echo "hello from sandbox"`,
        { stdio: 'pipe', timeout: 10000 },
      );
      expect(result.toString().trim()).toBe('hello from sandbox');

      // curl should fail
      expect(() => {
        execSync(
          `sandbox-exec -f "${profilePath}" /usr/bin/curl -s --max-time 5 https://example.com`,
          { stdio: 'pipe', timeout: 15000 },
        );
      }).toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Profile caching and lifecycle
// ---------------------------------------------------------------------------

describe('Integration: profile caching and lifecycle', () => {
  let tmpDir: string;
  let pm: ProfileManager;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-int-')));
    pm = new ProfileManager(path.join(tmpDir, 'profiles'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('same config → same profile path (idempotent through full pipeline)', async () => {
    const sandbox = await buildSandboxConfig(makeDeps(), { target: 'ls -la' });
    const profile = pm.generateProfile(sandbox);
    const path1 = pm.getOrCreateProfile(profile);
    const path2 = pm.getOrCreateProfile(profile);

    expect(path1).toBe(path2);
  });

  it('different policy set → different profile file', async () => {
    const sandbox1 = await buildSandboxConfig(makeDeps(), { target: 'ls -la' });
    const profile1 = pm.generateProfile(sandbox1);
    const path1 = pm.getOrCreateProfile(profile1);

    const deps2 = makeDeps({
      getPolicies: () => [{
        id: 'd1', name: 'Extra deny', target: 'filesystem' as const,
        action: 'deny' as const, patterns: ['/secret/dir'], enabled: true,
      }],
    });
    const sandbox2 = await buildSandboxConfig(deps2, { target: 'ls -la' });
    const profile2 = pm.generateProfile(sandbox2);
    const path2 = pm.getOrCreateProfile(profile2);

    expect(path1).not.toBe(path2);
    expect(profile1).not.toBe(profile2);
  });

  it('cleanup removes old profiles, keeps recent ones, skips non-.sb files', async () => {
    const profileDir = path.join(tmpDir, 'profiles');

    // Create profiles through the pipeline
    const sandbox = await buildSandboxConfig(makeDeps(), { target: 'ls' });
    const profile = pm.generateProfile(sandbox);
    const recentPath = pm.getOrCreateProfile(profile);

    // Create an old profile by backdating its mtime
    const oldProfile = ';; old profile\n(version 1)\n(deny default)\n(allow file-read*)';
    const oldPath = pm.getOrCreateProfile(oldProfile);
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    fs.utimesSync(oldPath, oldTime, oldTime);

    // Create a non-.sb file that should be ignored
    const nonSbFile = path.join(profileDir, 'config.json');
    fs.writeFileSync(nonSbFile, '{}');

    // Cleanup with 1 hour maxAge
    pm.cleanup(60 * 60 * 1000);

    expect(fs.existsSync(recentPath)).toBe(true);
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(nonSbFile)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. OpenClaw deny + workspace read exception
// ---------------------------------------------------------------------------

describe('Integration: OpenClaw deny + workspace read exception', () => {
  let tmpDir: string;
  let pm: ProfileManager;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-int-')));
    pm = new ProfileManager(path.join(tmpDir, 'profiles'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('buildSandboxConfig produces deny for .openclaw, read-allow for .openclaw/workspace', async () => {
    const deps = makeDeps({ agentHome: '/Users/test_agent' });
    const sandbox = await buildSandboxConfig(deps, { target: 'cat file.txt' });

    expect(sandbox.deniedPaths).toContain('/Users/test_agent/.openclaw');
    expect(sandbox.allowedReadPaths).toContain('/Users/test_agent/.openclaw/workspace');
  });

  it('profile has deny before allow-read (SBPL ordering)', async () => {
    const deps = makeDeps({ agentHome: '/Users/test_agent' });
    const sandbox = await buildSandboxConfig(deps, { target: 'cat file.txt' });
    const profile = pm.generateProfile(sandbox);

    const denyIdx = profile.indexOf('(deny file-read* file-write* (subpath "/Users/test_agent/.openclaw"))');
    const allowIdx = profile.indexOf('(allow file-read* (subpath "/Users/test_agent/.openclaw/workspace"))');
    expect(denyIdx).toBeGreaterThan(-1);
    expect(allowIdx).toBeGreaterThan(-1);
    expect(denyIdx).toBeLessThan(allowIdx);
  });

  describeOnMac('sandbox-exec enforcement', () => {
    it('sandbox-exec blocks .openclaw/secret.txt, allows .openclaw/workspace/readme.txt', async () => {
      const agentHome = tmpDir;
      const openclawDir = path.join(agentHome, '.openclaw');
      const workspaceDir = path.join(openclawDir, 'workspace');
      fs.mkdirSync(workspaceDir, { recursive: true });
      fs.writeFileSync(path.join(openclawDir, 'secret.txt'), 'secret-data');
      fs.writeFileSync(path.join(workspaceDir, 'readme.txt'), 'workspace-data');

      const deps = makeDeps({ agentHome });
      const sandbox = await buildSandboxConfig(deps, { target: 'cat file' });
      const profile = pm.generateProfile(sandbox);
      const profilePath = pm.getOrCreateProfile(profile);

      // Should block reading secret.txt
      expect(() => {
        execSync(
          `sandbox-exec -f "${profilePath}" /bin/cat "${path.join(openclawDir, 'secret.txt')}"`,
          { stdio: 'pipe', timeout: 10000 },
        );
      }).toThrow();

      // Should allow reading workspace/readme.txt
      const result = execSync(
        `sandbox-exec -f "${profilePath}" /bin/cat "${path.join(workspaceDir, 'readme.txt')}"`,
        { stdio: 'pipe', timeout: 10000 },
      );
      expect(result.toString().trim()).toBe('workspace-data');
    });
  });
});

// ---------------------------------------------------------------------------
// 9. Multi-source path merging
// ---------------------------------------------------------------------------

describe('Integration: multi-source path merging', () => {
  let tmpDir: string;
  let pm: ProfileManager;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-int-')));
    pm = new ProfileManager(path.join(tmpDir, 'profiles'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('paths from policies + graph effects + shared caps all appear in final config', async () => {
    const effects = emptyEffects();
    effects.grantedFsPaths.read = ['/graph/read'];
    effects.grantedFsPaths.write = ['/graph/write'];

    const shared: SharedCapabilities = {
      networkPatterns: [],
      fsPaths: { read: ['/shared/read'], write: ['/shared/write'] },
      secretNames: [],
    };

    const deps = makeDeps({
      getPolicies: () => [{
        id: 'a1', name: 'Allow read', target: 'filesystem' as const,
        action: 'allow' as const, patterns: ['/policy/data'],
        enabled: true, operations: ['file_read'],
      }],
    });

    const sandbox = await buildSandboxConfig(deps, {
      target: 'cat /policy/data/file',
      effects,
      sharedCapabilities: shared,
    });

    // Policy path
    expect(sandbox.allowedReadPaths).toContain('/policy/data');
    // Graph paths
    expect(sandbox.allowedReadPaths).toContain('/graph/read');
    expect(sandbox.allowedWritePaths).toContain('/graph/write');
    // Shared paths
    expect(sandbox.allowedReadPaths).toContain('/shared/read');
    expect(sandbox.allowedWritePaths).toContain('/shared/write');
  });

  it('all sources produce SBPL rules in generated profile', async () => {
    const effects = emptyEffects();
    effects.grantedFsPaths.write = ['/graph/output'];

    const shared: SharedCapabilities = {
      networkPatterns: [],
      fsPaths: { read: [], write: ['/shared/output'] },
      secretNames: [],
    };

    const deps = makeDeps({
      getPolicies: () => [{
        id: 'd1', name: 'Deny secrets', target: 'filesystem' as const,
        action: 'deny' as const, patterns: ['/secrets/vault'], enabled: true,
      }],
    });

    const sandbox = await buildSandboxConfig(deps, {
      target: 'echo hi',
      effects,
      sharedCapabilities: shared,
    });
    const profile = pm.generateProfile(sandbox);

    expect(profile).toContain('(subpath "/graph/output")');
    expect(profile).toContain('(subpath "/shared/output")');
    expect(profile).toContain('(deny file-read* file-write* (subpath "/secrets/vault"))');
  });

  it('command-scoped policy only contributes when target command matches scope', async () => {
    const deps = makeDeps({
      getPolicies: () => [
        {
          id: 'd1', name: 'Deny for git only', target: 'filesystem' as const,
          action: 'deny' as const, patterns: ['/home/private'],
          enabled: true, scope: 'command:git',
        },
      ],
    });

    // Matching command
    const sandbox1 = await buildSandboxConfig(deps, { target: 'git push' });
    expect(sandbox1.deniedPaths).toContain('/home/private');

    // Non-matching command
    const sandbox2 = await buildSandboxConfig(deps, { target: 'ls -la' });
    expect(sandbox2.deniedPaths).not.toContain('/home/private');
  });
});

// ---------------------------------------------------------------------------
// 10. Proxy policy filtering
// ---------------------------------------------------------------------------

describe('Integration: proxy policy filtering', () => {
  it('only URL policies forwarded to acquireProxy (not filesystem/command policies)', async () => {
    let capturedPolicies: unknown[] = [];
    const deps = makeDeps({
      getPolicies: () => [
        {
          id: 'u1', name: 'URL Allow', target: 'url' as const,
          action: 'allow' as const, patterns: ['https://api.com/*'], enabled: true,
        },
        {
          id: 'f1', name: 'FS Deny', target: 'filesystem' as const,
          action: 'deny' as const, patterns: ['/etc/ssh'], enabled: true,
        },
        {
          id: 'c1', name: 'CMD Allow', target: 'command' as const,
          action: 'allow' as const, patterns: ['curl'], enabled: true,
        },
      ],
      acquireProxy: async (_id, _cmd, policies) => {
        capturedPolicies = policies;
        return { port: 55555 };
      },
    });

    await buildSandboxConfig(deps, { target: 'curl https://api.com/v1' });

    // Only URL policies should be forwarded
    const targets = (capturedPolicies as Array<{ target: string }>).map(p => p.target);
    expect(targets).toContain('url');
    expect(targets).not.toContain('filesystem');
    expect(targets).not.toContain('command');
  });

  it('graph-granted patterns prepended as synthetic policy with priority 999', async () => {
    let capturedPolicies: unknown[] = [];
    const deps = makeDeps({
      acquireProxy: async (_id, _cmd, policies) => {
        capturedPolicies = policies;
        return { port: 44444 };
      },
    });

    const effects = emptyEffects();
    effects.grantedNetworkPatterns = ['*.internal.com', 'api.example.com'];

    await buildSandboxConfig(deps, { target: 'curl https://api.com', effects });

    const first = capturedPolicies[0] as { priority: number; patterns: string[]; action: string };
    expect(first.priority).toBe(999);
    expect(first.action).toBe('allow');
    expect(first.patterns).toEqual(['*.internal.com', 'api.example.com']);
  });

  it('graph + shared network patterns merged into single synthetic policy', async () => {
    let capturedPolicies: unknown[] = [];
    const deps = makeDeps({
      acquireProxy: async (_id, _cmd, policies) => {
        capturedPolicies = policies;
        return { port: 33333 };
      },
    });

    const effects = emptyEffects();
    effects.grantedNetworkPatterns = ['graph.example.com'];

    const shared: SharedCapabilities = {
      networkPatterns: ['shared.example.com'],
      fsPaths: { read: [], write: [] },
      secretNames: [],
    };

    await buildSandboxConfig(deps, {
      target: 'node app.js',
      effects,
      sharedCapabilities: shared,
    });

    const first = capturedPolicies[0] as { patterns: string[] };
    expect(first.patterns).toContain('graph.example.com');
    expect(first.patterns).toContain('shared.example.com');
    // Should be merged into a single synthetic policy
    expect(first.patterns).toHaveLength(2);
  });
});
