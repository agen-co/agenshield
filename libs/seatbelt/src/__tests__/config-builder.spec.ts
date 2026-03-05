import { buildSandboxConfig } from '../config-builder';
import type { SeatbeltDeps, BuildSandboxInput, SharedCapabilities } from '../config-builder';
import type { GraphEffects } from '@agenshield/policies';

function createDeps(overrides?: Partial<SeatbeltDeps>): SeatbeltDeps {
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

describe('buildSandboxConfig', () => {
  it('builds a basic sandbox config', async () => {
    const result = await buildSandboxConfig(createDeps(), { target: 'echo hello' });
    expect(result.enabled).toBe(true);
    expect(result.envDeny).toContain('NODE_OPTIONS');
    expect(result.allowedWritePaths).toContain('/Users/test_agent');
  });

  it('injects trace env vars', async () => {
    const result = await buildSandboxConfig(createDeps(), {
      target: 'echo hello',
      traceId: 'trace-abc-123',
      depth: 3,
    });
    expect(result.envInjection['AGENSHIELD_TRACE_ID']).toBe('trace-abc-123');
    expect(result.envInjection['AGENSHIELD_DEPTH']).toBe('3');
  });

  it('merges graph-granted fs paths', async () => {
    const effects = emptyEffects();
    effects.grantedFsPaths.read = ['/data/read'];
    effects.grantedFsPaths.write = ['/data/write'];

    const result = await buildSandboxConfig(createDeps(), { effects });
    expect(result.allowedReadPaths).toContain('/data/read');
    expect(result.allowedWritePaths).toContain('/data/write');
  });

  it('injects graph-granted secrets', async () => {
    const effects = emptyEffects();
    effects.injectedSecrets = { GOG_TOKEN: 'secret-val' };

    const result = await buildSandboxConfig(createDeps(), { effects });
    expect(result.envInjection['GOG_TOKEN']).toBe('secret-val');
  });

  it('merges shared capabilities', async () => {
    const shared: SharedCapabilities = {
      networkPatterns: [],
      fsPaths: { read: ['/shared/data'], write: ['/shared/output'] },
      secretNames: ['WORKSPACE_TOKEN'],
    };

    const deps = createDeps({
      resolveSecrets: (names) => {
        const map: Record<string, string> = { WORKSPACE_TOKEN: 'ws-secret' };
        const result: Record<string, string> = {};
        for (const n of names) {
          if (map[n]) result[n] = map[n];
        }
        return result;
      },
    });

    const result = await buildSandboxConfig(deps, { sharedCapabilities: shared });
    expect(result.allowedReadPaths).toContain('/shared/data');
    expect(result.allowedWritePaths).toContain('/shared/output');
    expect(result.envInjection['WORKSPACE_TOKEN']).toBe('ws-secret');
  });

  it('forces proxy mode with shared network patterns', async () => {
    const shared: SharedCapabilities = {
      networkPatterns: ['api.example.com'],
      fsPaths: { read: [], write: [] },
      secretNames: [],
    };

    let acquiredPolicies: unknown[] = [];
    const deps = createDeps({
      acquireProxy: async (_execId, _cmd, policies) => {
        acquiredPolicies = policies;
        return { port: 12345 };
      },
    });

    const result = await buildSandboxConfig(deps, {
      target: 'echo hello',
      sharedCapabilities: shared,
    });
    expect(result.networkAllowed).toBe(true);
    expect(result.allowedHosts).toContain('localhost');
    // Synthetic policy should include shared patterns
    expect(acquiredPolicies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ patterns: ['api.example.com'] }),
      ]),
    );
  });

  it('does not allow network for non-network commands without graph grants', async () => {
    const result = await buildSandboxConfig(createDeps(), { target: 'echo hello' });
    expect(result.networkAllowed).toBe(false);
  });

  describe('determineNetworkAccess (via buildSandboxConfig)', () => {
    it('known network command "curl" → proxy mode', async () => {
      const deps = createDeps({
        acquireProxy: async () => ({ port: 9999 }),
      });
      const result = await buildSandboxConfig(deps, { target: 'curl https://example.com' });
      expect(result.networkAllowed).toBe(true);
      expect(result.envInjection['HTTP_PROXY']).toContain('9999');
    });

    it('known network command "git" → proxy mode', async () => {
      const deps = createDeps({
        acquireProxy: async () => ({ port: 8888 }),
      });
      const result = await buildSandboxConfig(deps, { target: 'git clone https://repo.com' });
      expect(result.networkAllowed).toBe(true);
      expect(result.envInjection['HTTPS_PROXY']).toContain('8888');
    });

    it('known network command "npm" → proxy mode', async () => {
      const deps = createDeps({
        acquireProxy: async () => ({ port: 7777 }),
      });
      const result = await buildSandboxConfig(deps, { target: 'npm install lodash' });
      expect(result.networkAllowed).toBe(true);
    });

    it('known network command with full path "/usr/bin/curl" → proxy mode', async () => {
      const deps = createDeps({
        acquireProxy: async () => ({ port: 5555 }),
      });
      const result = await buildSandboxConfig(deps, { target: '/usr/bin/curl https://x.com' });
      expect(result.networkAllowed).toBe(true);
    });

    it('"fork:" prefix stripped before network check → "fork:curl" = proxy', async () => {
      const deps = createDeps({
        acquireProxy: async () => ({ port: 4444 }),
      });
      const result = await buildSandboxConfig(deps, { target: 'fork:curl https://api.com' });
      expect(result.networkAllowed).toBe(true);
    });

    it('non-network command "echo" → network disabled', async () => {
      const result = await buildSandboxConfig(createDeps(), { target: 'echo hello' });
      expect(result.networkAllowed).toBe(false);
    });

    it('non-network command "ls" → network disabled', async () => {
      const result = await buildSandboxConfig(createDeps(), { target: 'ls -la' });
      expect(result.networkAllowed).toBe(false);
    });

    it('explicit policy.networkAccess = "direct" → direct mode', async () => {
      const result = await buildSandboxConfig(createDeps(), {
        target: 'echo test',
        matchedPolicy: {
          id: 'p1', name: 'Direct', target: 'command', action: 'allow',
          patterns: ['echo'], enabled: true, networkAccess: 'direct',
        },
      });
      expect(result.networkAllowed).toBe(true);
      // No proxy env vars in direct mode
      expect(result.envInjection['HTTP_PROXY']).toBeUndefined();
    });

    it('explicit policy.networkAccess = "none" → network disabled even for curl', async () => {
      const result = await buildSandboxConfig(createDeps(), {
        target: 'curl https://api.com',
        matchedPolicy: {
          id: 'p1', name: 'NoCurl', target: 'command', action: 'allow',
          patterns: ['curl'], enabled: true, networkAccess: 'none',
        },
      });
      expect(result.networkAllowed).toBe(false);
    });
  });

  describe('proxy acquisition', () => {
    it('acquires proxy and injects all proxy env vars', async () => {
      const deps = createDeps({
        acquireProxy: async () => ({ port: 12000 }),
      });
      const result = await buildSandboxConfig(deps, { target: 'curl https://x.com' });

      expect(result.envInjection['HTTP_PROXY']).toBe('http://127.0.0.1:12000');
      expect(result.envInjection['HTTPS_PROXY']).toBe('http://127.0.0.1:12000');
      expect(result.envInjection['ALL_PROXY']).toBe('http://127.0.0.1:12000');
      expect(result.envInjection['http_proxy']).toBe('http://127.0.0.1:12000');
      expect(result.envInjection['https_proxy']).toBe('http://127.0.0.1:12000');
      expect(result.envInjection['all_proxy']).toBe('http://127.0.0.1:12000');
      expect(result.envInjection['NO_PROXY']).toBe('localhost,127.0.0.1,::1,*.local,.local');
    });

    it('sets AGENSHIELD_EXEC_ID in env injection', async () => {
      const deps = createDeps({
        acquireProxy: async () => ({ port: 12000 }),
      });
      const result = await buildSandboxConfig(deps, { target: 'wget https://x.com' });
      expect(result.envInjection['AGENSHIELD_EXEC_ID']).toBeDefined();
      expect(typeof result.envInjection['AGENSHIELD_EXEC_ID']).toBe('string');
      expect(result.envInjection['AGENSHIELD_EXEC_ID'].length).toBeGreaterThan(0);
    });

    it('graph-granted network patterns create synthetic policy with priority 999', async () => {
      let capturedPolicies: unknown[] = [];
      const deps = createDeps({
        acquireProxy: async (_id, _cmd, policies) => {
          capturedPolicies = policies;
          return { port: 11111 };
        },
      });

      const effects = emptyEffects();
      effects.grantedNetworkPatterns = ['*.example.com'];

      await buildSandboxConfig(deps, { target: 'node app.js', effects });
      expect(capturedPolicies[0]).toEqual(expect.objectContaining({
        action: 'allow',
        priority: 999,
        patterns: ['*.example.com'],
      }));
    });

    it('merges graph-granted + shared network patterns into proxy policies', async () => {
      let capturedPolicies: unknown[] = [];
      const deps = createDeps({
        acquireProxy: async (_id, _cmd, policies) => {
          capturedPolicies = policies;
          return { port: 11111 };
        },
      });

      const effects = emptyEffects();
      effects.grantedNetworkPatterns = ['api.one.com'];

      const shared: SharedCapabilities = {
        networkPatterns: ['api.two.com'],
        fsPaths: { read: [], write: [] },
        secretNames: [],
      };

      await buildSandboxConfig(deps, { target: 'node app.js', effects, sharedCapabilities: shared });
      expect(capturedPolicies[0]).toEqual(expect.objectContaining({
        patterns: ['api.one.com', 'api.two.com'],
      }));
    });

    it('calls filterUrlPoliciesForCommand for base policy list', async () => {
      let capturedPolicies: unknown[] = [];
      const deps = createDeps({
        getPolicies: () => [
          { id: 'u1', name: 'URL policy', target: 'url' as const, action: 'allow' as const, patterns: ['https://allowed.com/*'], enabled: true },
          { id: 'c1', name: 'Command policy', target: 'command' as const, action: 'allow' as const, patterns: ['curl'], enabled: true },
        ],
        acquireProxy: async (_id, _cmd, policies) => {
          capturedPolicies = policies;
          return { port: 10000 };
        },
      });

      await buildSandboxConfig(deps, { target: 'curl https://allowed.com/api' });
      // Only URL policies should make it through filterUrlPoliciesForCommand
      const urlPolicies = (capturedPolicies as Array<{ target: string }>).filter(p => p.target === 'url');
      expect(urlPolicies.length).toBeGreaterThan(0);
    });

    it('proxy mode without acquireProxy dep → no proxy vars (graceful)', async () => {
      // curl is a network command, but no acquireProxy provided
      const deps = createDeps(); // no acquireProxy
      const result = await buildSandboxConfig(deps, { target: 'curl https://x.com' });
      // Network should NOT be allowed since proxy couldn't be acquired
      expect(result.envInjection['HTTP_PROXY']).toBeUndefined();
    });
  });

  describe('filesystem paths from policies', () => {
    it('deny policies produce deniedPaths in sandbox', async () => {
      const deps = createDeps({
        getPolicies: () => [
          { id: 'd1', name: 'Deny secrets', target: 'filesystem' as const, action: 'deny' as const, patterns: ['/etc/ssh'], enabled: true },
        ],
      });
      const result = await buildSandboxConfig(deps, { target: 'cat /etc/ssh/id_rsa' });
      expect(result.deniedPaths).toContain('/etc/ssh');
    });

    it('command-scoped deny policies filtered by target command', async () => {
      const deps = createDeps({
        getPolicies: () => [
          { id: 'd1', name: 'Deny for git', target: 'filesystem' as const, action: 'deny' as const, patterns: ['/home/private'], enabled: true, scope: 'command:git' },
        ],
      });
      // When target is "git push", the command-scoped deny should apply
      const result = await buildSandboxConfig(deps, { target: 'git push' });
      expect(result.deniedPaths).toContain('/home/private');
    });

    it('allow policies with file_read produce allowedReadPaths', async () => {
      const deps = createDeps({
        getPolicies: () => [
          { id: 'a1', name: 'Allow read data', target: 'filesystem' as const, action: 'allow' as const, patterns: ['/data/public'], enabled: true, operations: ['file_read'] },
        ],
      });
      const result = await buildSandboxConfig(deps, { target: 'cat /data/public/file' });
      expect(result.allowedReadPaths).toContain('/data/public');
    });

    it('allow policies with file_write produce allowedWritePaths', async () => {
      const deps = createDeps({
        getPolicies: () => [
          { id: 'a1', name: 'Allow write output', target: 'filesystem' as const, action: 'allow' as const, patterns: ['/output/logs'], enabled: true, operations: ['file_write'] },
        ],
      });
      const result = await buildSandboxConfig(deps, { target: 'tee /output/logs/out.txt' });
      expect(result.allowedWritePaths).toContain('/output/logs');
    });
  });

  describe('binary resolution', () => {
    it('absolute target path added to allowedBinaries', async () => {
      const result = await buildSandboxConfig(createDeps(), { target: '/usr/local/bin/myapp arg1' });
      expect(result.allowedBinaries).toContain('/usr/local/bin/myapp');
    });

    it('"fork:" prefix stripped for binary extraction', async () => {
      const result = await buildSandboxConfig(createDeps(), { target: 'fork:/usr/bin/node script.js' });
      expect(result.allowedBinaries).toContain('/usr/bin/node');
    });

    it('non-absolute target does NOT add to allowedBinaries directly', async () => {
      const result = await buildSandboxConfig(createDeps(), { target: 'node script.js' });
      // "node" is not absolute, so it shouldn't be in allowedBinaries
      // essential paths like agentHome/homebrew/ are still there
      expect(result.allowedBinaries).not.toContain('node');
    });

    it('essential agent home paths always added', async () => {
      const result = await buildSandboxConfig(createDeps(), { target: 'echo hi' });
      expect(result.allowedBinaries).toContain('/Users/test_agent/homebrew/');
      expect(result.allowedBinaries).toContain('/Users/test_agent/.nvm/');
      expect(result.allowedBinaries).toContain('/Users/test_agent/bin/');
    });
  });

  describe('denied binaries (wrapper-required)', () => {
    it('deniedBinaries contains wrapper-required system paths', async () => {
      const result = await buildSandboxConfig(createDeps(), { target: 'echo hi' });
      expect(result.deniedBinaries).toContain('/usr/bin/curl');
      expect(result.deniedBinaries).toContain('/usr/bin/wget');
      expect(result.deniedBinaries).toContain('/usr/bin/ssh');
      expect(result.deniedBinaries).toContain('/usr/bin/scp');
      expect(result.deniedBinaries).toContain('/usr/bin/rsync');
      expect(result.deniedBinaries).toContain('/usr/bin/git');
      expect(result.deniedBinaries).toContain('/usr/local/bin/git');
      expect(result.deniedBinaries).toContain('/usr/bin/npm');
      expect(result.deniedBinaries).toContain('/usr/local/bin/npm');
      expect(result.deniedBinaries).toContain('/usr/bin/npx');
      expect(result.deniedBinaries).toContain('/usr/local/bin/npx');
    });

    it('/usr/bin/curl target is NOT added to allowedBinaries', async () => {
      const result = await buildSandboxConfig(createDeps(), { target: '/usr/bin/curl https://example.com' });
      expect(result.allowedBinaries).not.toContain('/usr/bin/curl');
      expect(result.deniedBinaries).toContain('/usr/bin/curl');
    });

    it('/usr/bin/git target is NOT added to allowedBinaries', async () => {
      const result = await buildSandboxConfig(createDeps(), { target: '/usr/bin/git clone repo' });
      expect(result.allowedBinaries).not.toContain('/usr/bin/git');
      expect(result.deniedBinaries).toContain('/usr/bin/git');
    });

    it('non-denied absolute path IS added to allowedBinaries', async () => {
      const result = await buildSandboxConfig(createDeps(), { target: '/usr/local/bin/myapp arg1' });
      expect(result.allowedBinaries).toContain('/usr/local/bin/myapp');
    });

    it('fork:/usr/bin/curl is NOT added to allowedBinaries', async () => {
      const result = await buildSandboxConfig(createDeps(), { target: 'fork:/usr/bin/curl https://x.com' });
      expect(result.allowedBinaries).not.toContain('/usr/bin/curl');
    });
  });

  describe('agent home and OpenClaw', () => {
    it('agentHome added to allowedWritePaths', async () => {
      const result = await buildSandboxConfig(createDeps(), {});
      expect(result.allowedWritePaths).toContain('/Users/test_agent');
    });

    it('no legacy /opt/agenshield/bin/ in allowedBinaries', async () => {
      const result = await buildSandboxConfig(createDeps(), {});
      expect(result.allowedBinaries).not.toContain('/opt/agenshield/bin/');
    });

    it('agentHome/.openclaw in deniedPaths', async () => {
      const result = await buildSandboxConfig(createDeps(), {});
      expect(result.deniedPaths).toContain('/Users/test_agent/.openclaw');
    });

    it('agentHome/.openclaw/workspace in allowedReadPaths', async () => {
      const result = await buildSandboxConfig(createDeps(), {});
      expect(result.allowedReadPaths).toContain('/Users/test_agent/.openclaw/workspace');
    });

    it('agentHome/.agenshield-token in deniedPaths', async () => {
      const result = await buildSandboxConfig(createDeps(), {});
      expect(result.deniedPaths).toContain('/Users/test_agent/.agenshield-token');
    });
  });

  describe('trace injection edge cases', () => {
    it('depth=0 injected as string "0"', async () => {
      const result = await buildSandboxConfig(createDeps(), {
        target: 'echo hi',
        depth: 0,
      });
      expect(result.envInjection['AGENSHIELD_DEPTH']).toBe('0');
    });

    it('traceId undefined → no AGENSHIELD_TRACE_ID', async () => {
      const result = await buildSandboxConfig(createDeps(), {
        target: 'echo hi',
      });
      expect(result.envInjection['AGENSHIELD_TRACE_ID']).toBeUndefined();
    });

    it('depth undefined → no AGENSHIELD_DEPTH', async () => {
      const result = await buildSandboxConfig(createDeps(), {
        target: 'echo hi',
      });
      expect(result.envInjection['AGENSHIELD_DEPTH']).toBeUndefined();
    });
  });

  describe('shared capabilities edge cases', () => {
    it('resolveSecrets not provided → secrets not resolved (no crash)', async () => {
      const shared: SharedCapabilities = {
        networkPatterns: [],
        fsPaths: { read: [], write: [] },
        secretNames: ['MY_SECRET'],
      };
      // deps has no resolveSecrets
      const result = await buildSandboxConfig(createDeps(), { sharedCapabilities: shared });
      // Should not crash, and MY_SECRET should not appear
      expect(result.envInjection['MY_SECRET']).toBeUndefined();
    });

    it('empty secret names → resolveSecrets not called', async () => {
      let called = false;
      const deps = createDeps({
        resolveSecrets: () => {
          called = true;
          return {};
        },
      });
      const shared: SharedCapabilities = {
        networkPatterns: [],
        fsPaths: { read: [], write: [] },
        secretNames: [],
      };
      await buildSandboxConfig(deps, { sharedCapabilities: shared });
      expect(called).toBe(false);
    });

    it('empty fsPaths → no paths added from shared', async () => {
      const shared: SharedCapabilities = {
        networkPatterns: [],
        fsPaths: { read: [], write: [] },
        secretNames: [],
      };
      const result = await buildSandboxConfig(createDeps(), { sharedCapabilities: shared });
      // Only the standard paths should exist (agentHome, openclaw/workspace)
      expect(result.allowedReadPaths).toEqual(['/Users/test_agent/.openclaw/workspace']);
    });
  });

  describe('NODE_OPTIONS', () => {
    it('NODE_OPTIONS always in envDeny', async () => {
      const result = await buildSandboxConfig(createDeps(), {});
      expect(result.envDeny).toContain('NODE_OPTIONS');
    });
  });

  describe('empty/undefined inputs', () => {
    it('no target → no crash', async () => {
      const result = await buildSandboxConfig(createDeps(), {});
      expect(result.enabled).toBe(true);
    });

    it('no effects → no crash', async () => {
      const result = await buildSandboxConfig(createDeps(), { target: 'echo hi' });
      expect(result.enabled).toBe(true);
    });

    it('no sharedCapabilities → no crash', async () => {
      const result = await buildSandboxConfig(createDeps(), { target: 'echo hi' });
      expect(result.enabled).toBe(true);
    });
  });
});
