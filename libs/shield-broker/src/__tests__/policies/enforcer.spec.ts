import * as fs from 'node:fs';
import { PolicyEnforcer, type PolicyConfig, type PolicyRule } from '../../policies/enforcer.js';
import { createHandlerContext } from '../helpers.js';

jest.mock('node:fs');

const mockedFs = fs as jest.Mocked<typeof fs>;

function makeRule(overrides: Partial<PolicyRule>): PolicyRule {
  return {
    id: 'test-rule',
    name: 'Test Rule',
    action: 'allow',
    target: 'url',
    operations: ['http_request'],
    patterns: ['*'],
    enabled: true,
    priority: 0,
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<PolicyConfig>): PolicyConfig {
  return {
    version: '1.0.0',
    defaultAction: 'deny',
    rules: [],
    ...overrides,
  };
}

function createEnforcer(
  config?: Partial<PolicyConfig>,
  opts?: { failOpen?: boolean }
): PolicyEnforcer {
  // Prevent loadPolicies from reading actual files
  mockedFs.existsSync.mockReturnValue(false);

  return new PolicyEnforcer({
    policiesPath: '/tmp/test-policies',
    defaultPolicies: makeConfig(config),
    failOpen: opts?.failOpen ?? false,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PolicyEnforcer', () => {
  describe('check() — rule evaluation', () => {
    const ctx = createHandlerContext();

    it('should allow when an allow rule matches', async () => {
      const enforcer = createEnforcer({
        rules: [makeRule({ action: 'allow', patterns: ['https://example.com'], operations: ['http_request'] })],
      });
      const result = await enforcer.check('http_request', { url: 'https://example.com' }, ctx);
      expect(result.allowed).toBe(true);
      expect(result.policyId).toBe('test-rule');
    });

    it('should deny when a deny rule matches', async () => {
      const enforcer = createEnforcer({
        rules: [makeRule({ action: 'deny', patterns: ['https://evil.com'], operations: ['http_request'] })],
      });
      const result = await enforcer.check('http_request', { url: 'https://evil.com' }, ctx);
      expect(result.allowed).toBe(false);
      expect(result.policyId).toBe('test-rule');
      expect(result.reason).toContain('Denied by policy');
    });

    it('should deny when an approval rule matches', async () => {
      const enforcer = createEnforcer({
        rules: [makeRule({ action: 'approval', patterns: ['*'], operations: ['http_request'] })],
      });
      const result = await enforcer.check('http_request', { url: 'https://foo.com' }, ctx);
      expect(result.allowed).toBe(false);
    });

    it('should skip disabled rules', async () => {
      const enforcer = createEnforcer({
        defaultAction: 'allow',
        rules: [makeRule({ action: 'deny', patterns: ['*'], enabled: false })],
      });
      const result = await enforcer.check('http_request', { url: 'https://anything.com' }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('should evaluate rules in priority order (higher first)', async () => {
      const enforcer = createEnforcer({ rules: [] });
      // Use '**' (globstar) because '*' only matches non-slash characters
      enforcer.addRule(makeRule({ id: 'low', action: 'deny', patterns: ['**'], priority: 10 }));
      enforcer.addRule(makeRule({ id: 'high', action: 'allow', patterns: ['**'], priority: 100 }));
      const result = await enforcer.check('http_request', { url: 'https://anything.com' }, ctx);
      expect(result.allowed).toBe(true);
      expect(result.policyId).toBe('high');
    });

    it('should stop at first matching rule', async () => {
      const enforcer = createEnforcer({ rules: [] });
      enforcer.addRule(makeRule({ id: 'first', action: 'allow', patterns: ['**'], priority: 100 }));
      enforcer.addRule(makeRule({ id: 'second', action: 'deny', patterns: ['**'], priority: 50 }));
      const result = await enforcer.check('http_request', { url: 'https://anything.com' }, ctx);
      expect(result.policyId).toBe('first');
    });

    it('should use default action when no rule matches', async () => {
      const enforcer = createEnforcer({ defaultAction: 'deny', rules: [] });
      const result = await enforcer.check('http_request', { url: 'https://anything.com' }, ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('No matching allow policy');
    });

    it('should use default allow when no rule matches and defaultAction is allow', async () => {
      const enforcer = createEnforcer({ defaultAction: 'allow', rules: [] });
      const result = await enforcer.check('http_request', { url: 'https://anything.com' }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('should skip rules with non-matching operations', async () => {
      const enforcer = createEnforcer({
        defaultAction: 'allow',
        rules: [makeRule({ action: 'deny', operations: ['exec'], patterns: ['*'] })],
      });
      const result = await enforcer.check('http_request', { url: 'https://example.com' }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('should match wildcard operations', async () => {
      const enforcer = createEnforcer({
        rules: [makeRule({ action: 'deny', operations: ['*'], patterns: ['https://example.com'] })],
      });
      const result = await enforcer.check('http_request', { url: 'https://example.com' }, ctx);
      expect(result.allowed).toBe(false);
    });
  });

  describe('check() — failOpen / failClosed', () => {
    const ctx = createHandlerContext();

    it('should return allowed=true with failOpen on internal error', async () => {
      const enforcer = createEnforcer({ rules: [] }, { failOpen: true });
      // Force an error by making extractTarget throw
      (enforcer as any).extractTarget = () => { throw new Error('boom'); };
      const result = await enforcer.check('http_request', { url: 'test' }, ctx);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('failing open');
    });

    it('should return allowed=false with failClosed on internal error', async () => {
      const enforcer = createEnforcer({ rules: [] }, { failOpen: false });
      (enforcer as any).extractTarget = () => { throw new Error('boom'); };
      const result = await enforcer.check('http_request', { url: 'test' }, ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Policy check failed');
    });
  });

  describe('extractTarget()', () => {
    const ctx = createHandlerContext();

    it.each([
      ['http_request', { url: 'https://example.com' }, 'https://example.com'],
      ['file_read', { path: '/tmp/file.txt' }, '/tmp/file.txt'],
      ['file_write', { path: '/tmp/out.txt' }, '/tmp/out.txt'],
      ['file_list', { path: '/tmp' }, '/tmp'],
      ['open_url', { url: 'https://google.com' }, 'https://google.com'],
      ['secret_inject', { name: 'API_KEY' }, 'API_KEY'],
    ])('for %s should extract target from params', async (operation, params, expected) => {
      const enforcer = createEnforcer({
        rules: [makeRule({ action: 'allow', operations: [operation], patterns: [expected] })],
      });
      const result = await enforcer.check(operation, params, ctx);
      expect(result.allowed).toBe(true);
    });

    it('should construct "command args" for exec', async () => {
      const enforcer = createEnforcer({
        rules: [makeRule({ action: 'allow', target: 'command', operations: ['exec'], patterns: ['node:*'] })],
      });
      const result = await enforcer.check('exec', { command: 'node', args: ['index.js'] }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('should return empty string for unknown operation', async () => {
      const enforcer = createEnforcer({ defaultAction: 'allow', rules: [] });
      const result = await enforcer.check('unknown_op', {}, ctx);
      expect(result.allowed).toBe(true);
    });
  });

  describe('matchPattern()', () => {
    const ctx = createHandlerContext();

    it('should match literal URL', async () => {
      const enforcer = createEnforcer({
        rules: [makeRule({ patterns: ['https://api.github.com'] })],
      });
      const result = await enforcer.check('http_request', { url: 'https://api.github.com' }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('should match * as non-slash wildcard', async () => {
      const enforcer = createEnforcer({
        rules: [makeRule({ patterns: ['http://localhost:*'] })],
      });
      const result = await enforcer.check('http_request', { url: 'http://localhost:5200' }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('should match ** as any-depth wildcard', async () => {
      const enforcer = createEnforcer({
        rules: [makeRule({ target: 'filesystem', operations: ['file_read'], patterns: ['/root/**'] })],
      });
      const result = await enforcer.check('file_read', { path: '/root/foo/bar' }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('should match ? as single character', async () => {
      const enforcer = createEnforcer({
        rules: [makeRule({ patterns: ['https://?.example.com'] })],
      });
      const result = await enforcer.check('http_request', { url: 'https://a.example.com' }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('should be case-insensitive', async () => {
      const enforcer = createEnforcer({
        rules: [makeRule({ patterns: ['https://API.GITHUB.COM'] })],
      });
      const result = await enforcer.check('http_request', { url: 'https://api.github.com' }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('should escape regex special chars', async () => {
      const enforcer = createEnforcer({
        rules: [makeRule({ patterns: ['https://api.example.com'] })],
      });
      // The dot should be escaped in the regex and not match any character
      const result = await enforcer.check('http_request', { url: 'https://apixexample.com' }, ctx);
      expect(result.allowed).toBe(false);
    });
  });

  describe('matchCommandPattern()', () => {
    const ctx = createHandlerContext();

    function execEnforcer(patterns: string[], action: 'allow' | 'deny' = 'allow') {
      return createEnforcer({
        defaultAction: action === 'allow' ? 'deny' : 'allow',
        rules: [makeRule({ target: 'command', operations: ['exec'], patterns, action })],
      });
    }

    it('* should match any command', async () => {
      const enforcer = execEnforcer(['*']);
      const result = await enforcer.check('exec', { command: 'anything', args: [] }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('node:* should match bare node', async () => {
      const enforcer = execEnforcer(['node:*']);
      const result = await enforcer.check('exec', { command: 'node', args: [] }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('node:* should match node with args', async () => {
      const enforcer = execEnforcer(['node:*']);
      const result = await enforcer.check('exec', { command: 'node', args: ['server.js'] }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('node:* should match full path /usr/bin/node', async () => {
      const enforcer = execEnforcer(['node:*']);
      const result = await enforcer.check('exec', { command: '/usr/bin/node', args: ['--version'] }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('exact pattern should match exactly', async () => {
      const enforcer = execEnforcer(['git pull']);
      const result = await enforcer.check('exec', { command: 'git', args: ['pull'] }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('exact pattern should not match different args', async () => {
      const enforcer = execEnforcer(['git pull']);
      const result = await enforcer.check('exec', { command: 'git', args: ['push'] }, ctx);
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkConstraints() — filesystem', () => {
    const ctx = createHandlerContext();

    it('should deny when path matches denied pattern', async () => {
      const enforcer = createEnforcer({
        defaultAction: 'allow',
        rules: [],
        fsConstraints: { allowedPaths: ['/tmp'], deniedPatterns: ['**/.env'] },
      });
      const result = await enforcer.check('file_read', { path: '/tmp/.env' }, ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('denied pattern');
    });

    it('should deny when path is outside allowed paths', async () => {
      const enforcer = createEnforcer({
        rules: [],
        fsConstraints: { allowedPaths: ['/home/user'], deniedPatterns: [] },
      });
      const result = await enforcer.check('file_read', { path: '/etc/passwd' }, ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not in allowed directories');
    });

    it('should allow when path is within allowed paths and no deny pattern matches', async () => {
      const enforcer = createEnforcer({
        rules: [],
        fsConstraints: { allowedPaths: ['/home/user'], deniedPatterns: [] },
      });
      const result = await enforcer.check('file_read', { path: '/home/user/code/file.ts' }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('denied patterns take precedence over allowed paths', async () => {
      const enforcer = createEnforcer({
        rules: [],
        fsConstraints: { allowedPaths: ['/home/user'], deniedPatterns: ['**/.env'] },
      });
      const result = await enforcer.check('file_read', { path: '/home/user/.env' }, ctx);
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkConstraints() — network', () => {
    const ctx = createHandlerContext();

    it('should deny when host matches denied pattern and not in allowed', async () => {
      const enforcer = createEnforcer({
        rules: [],
        networkConstraints: {
          allowedHosts: ['localhost'],
          deniedHosts: ['*'],
          allowedPorts: [80, 443],
        },
      });
      const result = await enforcer.check('http_request', { url: 'https://evil.com' }, ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not allowed');
    });

    it('should allow when host is in allowedHosts even with * in deniedHosts', async () => {
      const enforcer = createEnforcer({
        rules: [],
        networkConstraints: {
          allowedHosts: ['api.github.com'],
          deniedHosts: ['*'],
          allowedPorts: [443],
        },
      });
      const result = await enforcer.check('http_request', { url: 'https://api.github.com/repos' }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('should deny when port is not in allowed ports', async () => {
      const enforcer = createEnforcer({
        rules: [],
        networkConstraints: {
          allowedHosts: ['localhost'],
          deniedHosts: [],
          allowedPorts: [80, 443],
        },
      });
      const result = await enforcer.check('http_request', { url: 'http://localhost:9999' }, ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Port');
    });

    it('should handle invalid URL gracefully', async () => {
      const enforcer = createEnforcer({
        rules: [],
        networkConstraints: { allowedHosts: [], deniedHosts: ['*'], allowedPorts: [] },
      });
      const result = await enforcer.check('http_request', { url: 'not-a-url' }, ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Invalid URL');
    });

    it('should derive default port 443 for https', async () => {
      const enforcer = createEnforcer({
        rules: [],
        networkConstraints: {
          allowedHosts: ['example.com'],
          deniedHosts: [],
          allowedPorts: [443],
        },
      });
      const result = await enforcer.check('http_request', { url: 'https://example.com/path' }, ctx);
      expect(result.allowed).toBe(true);
    });

    it('should derive default port 80 for http', async () => {
      const enforcer = createEnforcer({
        rules: [],
        networkConstraints: {
          allowedHosts: ['example.com'],
          deniedHosts: [],
          allowedPorts: [80],
        },
      });
      const result = await enforcer.check('http_request', { url: 'http://example.com/path' }, ctx);
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkConstraints() — exec', () => {
    const ctx = createHandlerContext();

    it('should deny shell metacharacters in command', async () => {
      const enforcer = createEnforcer({ defaultAction: 'allow', rules: [] });
      const result = await enforcer.check('exec', { command: 'echo;rm', args: [] }, ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('metacharacters');
    });

    it.each([';', '|', '`', '$('])('should deny bare argument containing %s', async (char) => {
      const enforcer = createEnforcer({ defaultAction: 'allow', rules: [] });
      const result = await enforcer.check('exec', { command: 'echo', args: [`foo${char}bar`] }, ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Suspicious argument');
    });

    it('should allow flag arguments with special chars', async () => {
      const enforcer = createEnforcer({ defaultAction: 'allow', rules: [] });
      const result = await enforcer.check('exec', { command: 'curl', args: ['-H', 'Content-Type: application/json'] }, ctx);
      expect(result.allowed).toBe(true);
    });
  });

  describe('normalizeRule()', () => {
    it('should infer operations from target url', () => {
      const enforcer = createEnforcer({ rules: [] });
      const rule = makeRule({ target: 'url', operations: [] });
      const normalized = (enforcer as any).normalizeRule(rule);
      expect(normalized.operations).toEqual(['http_request', 'open_url']);
    });

    it('should infer operations from target command', () => {
      const enforcer = createEnforcer({ rules: [] });
      const rule = makeRule({ target: 'command', operations: [] });
      const normalized = (enforcer as any).normalizeRule(rule);
      expect(normalized.operations).toEqual(['exec']);
    });

    it('should infer operations from target skill', () => {
      const enforcer = createEnforcer({ rules: [] });
      const rule = makeRule({ target: 'skill', operations: [] });
      const normalized = (enforcer as any).normalizeRule(rule);
      expect(normalized.operations).toEqual(['skill_install', 'skill_uninstall']);
    });

    it('should infer operations from target filesystem', () => {
      const enforcer = createEnforcer({ rules: [] });
      const rule = makeRule({ target: 'filesystem', operations: [] });
      const normalized = (enforcer as any).normalizeRule(rule);
      expect(normalized.operations).toEqual(['file_read', 'file_write', 'file_list']);
    });

    it('should preserve existing operations', () => {
      const enforcer = createEnforcer({ rules: [] });
      const rule = makeRule({ operations: ['custom_op'] });
      const normalized = (enforcer as any).normalizeRule(rule);
      expect(normalized.operations).toEqual(['custom_op']);
    });

    it('should default priority to 0', () => {
      const enforcer = createEnforcer({ rules: [] });
      const rule = makeRule({ priority: undefined as any });
      const normalized = (enforcer as any).normalizeRule(rule);
      expect(normalized.priority).toBe(0);
    });

    it('should default operations to [\'*\'] for unknown target type', () => {
      const enforcer = createEnforcer({ rules: [] });
      const rule = makeRule({ target: 'unknown_target' as any, operations: [] });
      const normalized = (enforcer as any).normalizeRule(rule);
      expect(normalized.operations).toEqual(['*']);
    });
  });

  describe('addRule() / removeRule()', () => {
    it('should add a rule and re-sort by priority', () => {
      const enforcer = createEnforcer({
        rules: [makeRule({ id: 'existing', priority: 10 })],
      });
      enforcer.addRule(makeRule({ id: 'new', priority: 100 }));
      const policies = enforcer.getPolicies();
      expect(policies.rules[0].id).toBe('new');
    });

    it('should remove a rule by id', () => {
      const enforcer = createEnforcer({
        rules: [makeRule({ id: 'to-remove' })],
      });
      expect(enforcer.removeRule('to-remove')).toBe(true);
      expect(enforcer.getPolicies().rules.find((r) => r.id === 'to-remove')).toBeUndefined();
    });

    it('should return false for non-existent id', () => {
      const enforcer = createEnforcer({ rules: [] });
      expect(enforcer.removeRule('nope')).toBe(false);
    });
  });

  describe('loadPolicies()', () => {
    it('should load and merge rules from default.json', () => {
      const fileContent = JSON.stringify({
        rules: [{ id: 'loaded', name: 'Loaded', action: 'allow', target: 'url', operations: [], patterns: ['*'], enabled: true, priority: 5 }],
      });
      mockedFs.existsSync.mockImplementation((p: any) => {
        const s = String(p);
        return s.endsWith('default.json');
      });
      mockedFs.readFileSync.mockReturnValue(fileContent);

      const enforcer = new PolicyEnforcer({
        policiesPath: '/tmp/policies',
        defaultPolicies: makeConfig({ rules: [makeRule({ id: 'default' })] }),
        failOpen: false,
      });

      const policies = enforcer.getPolicies();
      expect(policies.rules.some((r) => r.id === 'default')).toBe(true);
      expect(policies.rules.some((r) => r.id === 'loaded')).toBe(true);
    });

    it('should handle missing default.json gracefully', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const enforcer = new PolicyEnforcer({
        policiesPath: '/tmp/missing',
        defaultPolicies: makeConfig({ rules: [makeRule({ id: 'default' })] }),
        failOpen: false,
      });
      expect(enforcer.getPolicies().rules).toHaveLength(1);
    });

    it('should handle malformed JSON gracefully', () => {
      mockedFs.existsSync.mockImplementation((p: any) => String(p).endsWith('default.json'));
      mockedFs.readFileSync.mockReturnValue('not json');

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const enforcer = new PolicyEnforcer({
        policiesPath: '/tmp/policies',
        defaultPolicies: makeConfig({ rules: [makeRule({ id: 'default' })] }),
        failOpen: false,
      });
      expect(enforcer.getPolicies().rules).toHaveLength(1);
      consoleSpy.mockRestore();
    });

    it('should load custom policies from custom/ directory', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s.endsWith('default.json')) return JSON.stringify({ rules: [] });
        if (s.endsWith('custom.json')) {
          return JSON.stringify({ rules: [{ id: 'custom', name: 'Custom', action: 'deny', target: 'url', operations: ['http_request'], patterns: ['*'], enabled: true, priority: 10 }] });
        }
        return '{}';
      });
      const origReaddirSync = fs.readdirSync;
      mockedFs.readdirSync.mockReturnValue(['custom.json'] as any);

      const enforcer = new PolicyEnforcer({
        policiesPath: '/tmp/policies',
        defaultPolicies: makeConfig(),
        failOpen: false,
      });
      expect(enforcer.getPolicies().rules.some((r) => r.id === 'custom')).toBe(true);
    });

    it('should sort rules by priority after load', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const enforcer = new PolicyEnforcer({
        policiesPath: '/tmp/policies',
        defaultPolicies: makeConfig({ rules: [] }),
        failOpen: false,
      });
      // Use addRule to add rules one at a time — addRule re-sorts
      enforcer.addRule(makeRule({ id: 'low', priority: 1 }));
      enforcer.addRule(makeRule({ id: 'high', priority: 100 }));
      enforcer.addRule(makeRule({ id: 'mid', priority: 50 }));
      const rules = enforcer.getPolicies().rules;
      expect(rules[0].id).toBe('high');
      expect(rules[1].id).toBe('mid');
      expect(rules[2].id).toBe('low');
    });

    it('should warn on custom directory read failure', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockImplementation((p: any) => {
        if (String(p).endsWith('default.json')) return JSON.stringify({ rules: [] });
        throw new Error('unexpected read');
      });
      mockedFs.readdirSync.mockImplementation(() => { throw new Error('EACCES'); });

      const enforcer = new PolicyEnforcer({
        policiesPath: '/tmp/policies',
        defaultPolicies: makeConfig(),
        failOpen: false,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load custom policies'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('maybeReload()', () => {
    it('should not reload within reloadInterval', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const enforcer = createEnforcer({ rules: [] });
      // Ensure lastLoad is recent so maybeReload won't fire
      (enforcer as any).lastLoad = Date.now();
      const loadSpy = jest.spyOn(enforcer as any, 'loadPolicies');
      loadSpy.mockClear();

      await enforcer.check('ping', {}, createHandlerContext());
      expect(loadSpy).not.toHaveBeenCalled();
    });

    it('should reload after reloadInterval expires', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const enforcer = createEnforcer({ rules: [] });
      // Force lastLoad to be in the past
      (enforcer as any).lastLoad = 0;
      const loadSpy = jest.spyOn(enforcer as any, 'loadPolicies');
      loadSpy.mockClear();

      await enforcer.check('ping', {}, createHandlerContext());
      expect(loadSpy).toHaveBeenCalled();
    });
  });

  describe('verbose logging', () => {
    const ctx = createHandlerContext();

    it('should log match and default-action when AGENSHIELD_BROKER_VERBOSE is true', async () => {
      const orig = process.env['AGENSHIELD_BROKER_VERBOSE'];
      process.env['AGENSHIELD_BROKER_VERBOSE'] = 'true';
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      try {
        const enforcer = createEnforcer({
          defaultAction: 'allow',
          rules: [makeRule({ id: 'v-rule', action: 'allow', patterns: ['**'], operations: ['http_request'] })],
        });
        // Need to re-set verbose since it's read in constructor
        (enforcer as any).verbose = true;

        await enforcer.check('http_request', { url: 'https://example.com' }, ctx);

        const messages = consoleSpy.mock.calls.map(c => c[0]);
        expect(messages.some((m: string) => m.includes('[broker:enforcer]') && m.includes('op=http_request'))).toBe(true);
        expect(messages.some((m: string) => m.includes('[broker:enforcer] MATCH'))).toBe(true);
      } finally {
        if (orig === undefined) delete process.env['AGENSHIELD_BROKER_VERBOSE'];
        else process.env['AGENSHIELD_BROKER_VERBOSE'] = orig;
        consoleSpy.mockRestore();
      }
    });

    it('should log default action when no rules match and verbose is true', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const enforcer = createEnforcer({ defaultAction: 'allow', rules: [] });
      (enforcer as any).verbose = true;

      await enforcer.check('http_request', { url: 'https://anything.com' }, ctx);

      const messages = consoleSpy.mock.calls.map(c => c[0]);
      expect(messages.some((m: string) => m.includes('[broker:enforcer] DEFAULT'))).toBe(true);
      consoleSpy.mockRestore();
    });
  });
});
