import type { PolicyConfig } from '@agenshield/ipc';
import { shouldAllowHostPassthrough, syncRouterHostPassthrough } from '../services/router-sync';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const makePolicy = (overrides: Partial<PolicyConfig>): PolicyConfig => ({
  id: 'test',
  name: 'Test Policy',
  action: 'allow',
  target: 'router',
  patterns: ['host-passthrough'],
  enabled: true,
  ...overrides,
});

describe('shouldAllowHostPassthrough', () => {
  it('returns false when no policies exist', () => {
    expect(shouldAllowHostPassthrough([])).toBe(false);
  });

  it('returns false when no router policies exist', () => {
    const policies = [
      makePolicy({ target: 'command', patterns: ['*'] }),
      makePolicy({ target: 'skill', patterns: ['*'] }),
    ];
    expect(shouldAllowHostPassthrough(policies)).toBe(false);
  });

  it('returns true when an enabled allow router policy with host-passthrough pattern exists', () => {
    const policies = [
      makePolicy({
        action: 'allow',
        target: 'router',
        patterns: ['host-passthrough'],
        enabled: true,
      }),
    ];
    expect(shouldAllowHostPassthrough(policies)).toBe(true);
  });

  it('returns false when the allow policy is disabled', () => {
    const policies = [
      makePolicy({
        action: 'allow',
        target: 'router',
        patterns: ['host-passthrough'],
        enabled: false,
      }),
    ];
    expect(shouldAllowHostPassthrough(policies)).toBe(false);
  });

  it('returns false when the policy action is deny', () => {
    const policies = [
      makePolicy({
        action: 'deny',
        target: 'router',
        patterns: ['host-passthrough'],
        enabled: true,
      }),
    ];
    expect(shouldAllowHostPassthrough(policies)).toBe(false);
  });

  it('returns false when the pattern does not include host-passthrough', () => {
    const policies = [
      makePolicy({
        action: 'allow',
        target: 'router',
        patterns: ['something-else'],
        enabled: true,
      }),
    ];
    expect(shouldAllowHostPassthrough(policies)).toBe(false);
  });

  it('returns true when at least one matching policy exists among many', () => {
    const policies = [
      makePolicy({ id: '1', action: 'deny', target: 'router', patterns: ['host-passthrough'] }),
      makePolicy({ id: '2', action: 'allow', target: 'command', patterns: ['*'] }),
      makePolicy({ id: '3', action: 'allow', target: 'router', patterns: ['host-passthrough'], enabled: true }),
    ];
    expect(shouldAllowHostPassthrough(policies)).toBe(true);
  });
});

describe('syncRouterHostPassthrough', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-sync-test-'));
    const agenshieldDir = path.join(tmpDir, '.agenshield');
    fs.mkdirSync(agenshieldDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeRegistry(registry: Record<string, unknown>) {
    const regPath = path.join(tmpDir, '.agenshield', 'path-registry.json');
    fs.writeFileSync(regPath, JSON.stringify(registry, null, 2), 'utf-8');
  }

  it('sets allowHostPassthrough to true when an allow policy exists', () => {
    writeRegistry({
      claude: {
        originalBinary: '/usr/bin/claude',
        instances: [],
      },
    });

    const policies = [
      makePolicy({ action: 'allow', target: 'router', patterns: ['host-passthrough'], enabled: true }),
    ];
    const result = syncRouterHostPassthrough(policies, tmpDir);

    expect(result.updated).toBe(true);
    expect(result.registry.claude.allowHostPassthrough).toBe(true);
  });

  it('sets allowHostPassthrough to false when only deny policies exist', () => {
    writeRegistry({
      claude: {
        originalBinary: '/usr/bin/claude',
        instances: [],
        allowHostPassthrough: true,
      },
    });

    const policies = [
      makePolicy({ action: 'deny', target: 'router', patterns: ['host-passthrough'], enabled: true }),
    ];
    const result = syncRouterHostPassthrough(policies, tmpDir);

    expect(result.updated).toBe(true);
    expect(result.registry.claude.allowHostPassthrough).toBe(false);
  });

  it('returns updated=false when flag already matches', () => {
    writeRegistry({
      claude: {
        originalBinary: '/usr/bin/claude',
        instances: [],
        allowHostPassthrough: false,
      },
    });

    const policies: PolicyConfig[] = [];
    const result = syncRouterHostPassthrough(policies, tmpDir);

    expect(result.updated).toBe(false);
  });

  it('updates all entries in the registry', () => {
    writeRegistry({
      claude: {
        originalBinary: '/usr/bin/claude',
        instances: [],
      },
      openclaw: {
        originalBinary: '/usr/bin/openclaw',
        instances: [],
      },
    });

    const policies = [
      makePolicy({ action: 'allow', target: 'router', patterns: ['host-passthrough'], enabled: true }),
    ];
    const result = syncRouterHostPassthrough(policies, tmpDir);

    expect(result.updated).toBe(true);
    expect(result.registry.claude.allowHostPassthrough).toBe(true);
    expect(result.registry.openclaw.allowHostPassthrough).toBe(true);
  });

  it('handles empty registry gracefully', () => {
    writeRegistry({});

    const policies = [
      makePolicy({ action: 'allow', target: 'router', patterns: ['host-passthrough'], enabled: true }),
    ];
    const result = syncRouterHostPassthrough(policies, tmpDir);

    expect(result.updated).toBe(false);
    expect(Object.keys(result.registry)).toHaveLength(0);
  });
});
