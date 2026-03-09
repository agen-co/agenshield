import * as fs from 'node:fs';
import { BuiltinPolicies, getDefaultPolicies } from '../../policies/builtin.js';
import { PolicyEnforcer, type PolicyConfig } from '../../policies/enforcer.js';
import { createHandlerContext } from '../helpers.js';

jest.mock('node:fs');
(fs as jest.Mocked<typeof fs>).existsSync.mockReturnValue(false);

const ctx = createHandlerContext();

describe('BuiltinPolicies', () => {
  it('should be a non-empty array', () => {
    expect(BuiltinPolicies.length).toBeGreaterThan(0);
  });

  it('should have valid structure for every rule', () => {
    for (const rule of BuiltinPolicies) {
      expect(rule.id).toBeTruthy();
      expect(rule.name).toBeTruthy();
      expect(['allow', 'deny', 'approval']).toContain(rule.action);
      expect(['skill', 'command', 'url', 'filesystem']).toContain(rule.target);
      expect(Array.isArray(rule.operations)).toBe(true);
      expect(Array.isArray(rule.patterns)).toBe(true);
      expect(typeof rule.enabled).toBe('boolean');
      expect(typeof rule.priority).toBe('number');
    }
  });

  it('should contain expected rule IDs', () => {
    const ids = BuiltinPolicies.map((r) => r.id);
    expect(ids).toContain('builtin-allow-ping');
    expect(ids).toContain('builtin-allow-policy-check');
    expect(ids).toContain('builtin-allow-events-batch');
    expect(ids).toContain('builtin-deny-secrets');
    expect(ids).toContain('builtin-deny-system');
    expect(ids).toContain('builtin-allow-essential-exec');
    expect(ids).toContain('builtin-deny-dangerous-commands');
    expect(ids).toContain('builtin-deny-network-bypass');
    expect(ids).toContain('builtin-allow-ai-apis');
    expect(ids).toContain('builtin-allow-registries');
    expect(ids).toContain('builtin-allow-github');
  });
});

describe('getDefaultPolicies()', () => {
  it('should return a valid PolicyConfig', () => {
    const config = getDefaultPolicies();
    expect(config.version).toBe('1.0.0');
    expect(config.defaultAction).toBe('deny');
    expect(Array.isArray(config.rules)).toBe(true);
    expect(config.fsConstraints).toBeDefined();
    expect(config.networkConstraints).toBeDefined();
  });

  it('should include agentHome in fsConstraints.allowedPaths', () => {
    const config = getDefaultPolicies({ agentHome: '/custom/home' });
    expect(config.fsConstraints!.allowedPaths).toContain('/custom/home');
    expect(config.fsConstraints!.allowedPaths).toContain('/tmp/agenshield');
  });

  it('should include workspacePaths', () => {
    const config = getDefaultPolicies({ workspacePaths: ['/projects/myapp'] });
    expect(config.fsConstraints!.allowedPaths).toContain('/projects/myapp');
  });

  it('should have deny-all networkConstraints with allowed overrides', () => {
    const config = getDefaultPolicies();
    expect(config.networkConstraints!.deniedHosts).toContain('*');
    expect(config.networkConstraints!.allowedHosts).toContain('localhost');
    expect(config.networkConstraints!.allowedHosts).toContain('api.anthropic.com');
    expect(config.networkConstraints!.allowedPorts).toEqual([80, 443, 5200]);
  });
});

describe('Builtin policies — integration with PolicyEnforcer', () => {
  function makeEnforcer() {
    return new PolicyEnforcer({
      policiesPath: '/tmp/test',
      defaultPolicies: getDefaultPolicies({ agentHome: '/home/agent' }),
      failOpen: false,
    });
  }

  it('should allow ping', async () => {
    const result = await makeEnforcer().check('ping', {}, ctx);
    expect(result.allowed).toBe(true);
  });

  it('should allow policy_check', async () => {
    const result = await makeEnforcer().check('policy_check', {}, ctx);
    expect(result.allowed).toBe(true);
  });

  it('should allow events_batch', async () => {
    const result = await makeEnforcer().check('events_batch', {}, ctx);
    expect(result.allowed).toBe(true);
  });

  it('should allow localhost HTTP', async () => {
    const result = await makeEnforcer().check('http_request', { url: 'http://localhost:5200/api' }, ctx);
    expect(result.allowed).toBe(true);
  });

  it('should allow known AI APIs', async () => {
    const result = await makeEnforcer().check('http_request', { url: 'https://api.anthropic.com/v1/messages' }, ctx);
    expect(result.allowed).toBe(true);
  });

  it('should allow npm registry', async () => {
    const result = await makeEnforcer().check('http_request', { url: 'https://registry.npmjs.org/@scope/package' }, ctx);
    expect(result.allowed).toBe(true);
  });

  it('should allow GitHub', async () => {
    const result = await makeEnforcer().check('http_request', { url: 'https://github.com/org/repo' }, ctx);
    expect(result.allowed).toBe(true);
  });

  it('should deny unknown hosts', async () => {
    const result = await makeEnforcer().check('http_request', { url: 'https://evil.example.com' }, ctx);
    expect(result.allowed).toBe(false);
  });

  it('should deny /etc/passwd', async () => {
    const result = await makeEnforcer().check('file_read', { path: '/etc/passwd' }, ctx);
    expect(result.allowed).toBe(false);
  });

  it('should deny .env files', async () => {
    const result = await makeEnforcer().check('file_read', { path: '/home/agent/project/.env' }, ctx);
    expect(result.allowed).toBe(false);
  });

  it('should allow node:* exec', async () => {
    const result = await makeEnforcer().check('exec', { command: 'node', args: ['index.js'] }, ctx);
    expect(result.allowed).toBe(true);
  });

  it('should deny nc (network bypass)', async () => {
    const result = await makeEnforcer().check('exec', { command: 'nc', args: ['evil.com', '4444'] }, ctx);
    expect(result.allowed).toBe(false);
  });
});
