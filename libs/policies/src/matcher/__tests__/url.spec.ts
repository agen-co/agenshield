/**
 * URL pattern matching — unit tests
 *
 * Ported from libs/shield-daemon/src/__tests__/url-matcher.spec.ts
 * with import paths updated to the extracted @agenshield/policies library.
 */

import type { PolicyConfig, PolicyExecutionContext } from '@agenshield/ipc';
import {
  globToRegex,
  normalizeUrlBase,
  normalizeUrlTarget,
  matchUrlPattern,
  checkUrlPolicy,
} from '../url';
import {
  policyScopeMatches,
  commandScopeMatches,
  filterUrlPoliciesForCommand,
} from '../scope';
import { extractCommandBasename } from '../command';
import { makePolicy } from '../../__tests__/helpers';

// ---------------------------------------------------------------------------
// globToRegex
// ---------------------------------------------------------------------------

describe('globToRegex', () => {
  it('matches exact strings', () => {
    expect(globToRegex('hello').test('hello')).toBe(true);
    expect(globToRegex('hello').test('Hello')).toBe(true); // case-insensitive
  });

  it('does not match different strings', () => {
    expect(globToRegex('hello').test('world')).toBe(false);
  });

  it('escapes special regex characters', () => {
    expect(globToRegex('example.com').test('example.com')).toBe(true);
    expect(globToRegex('example.com').test('exampleXcom')).toBe(false);
  });

  it('handles * (non-slash wildcard)', () => {
    expect(globToRegex('*.example.com').test('sub.example.com')).toBe(true);
    expect(globToRegex('*.example.com').test('deep/sub.example.com')).toBe(false);
  });

  it('handles ** (globstar)', () => {
    expect(globToRegex('https://example.com/**').test('https://example.com/any/deep/path')).toBe(true);
  });

  it('handles ? (single char)', () => {
    expect(globToRegex('file?.txt').test('file1.txt')).toBe(true);
    expect(globToRegex('file?.txt').test('file12.txt')).toBe(false);
  });

  it('anchors match to full string', () => {
    expect(globToRegex('hello').test('say hello world')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// policyScopeMatches
// ---------------------------------------------------------------------------

describe('policyScopeMatches', () => {
  describe('no scope (universal)', () => {
    it('matches when no scope set', () => {
      expect(policyScopeMatches(makePolicy({ scope: undefined }))).toBe(true);
    });

    it('matches with any context', () => {
      const ctx: PolicyExecutionContext = { callerType: 'agent', depth: 0 };
      expect(policyScopeMatches(makePolicy({ scope: undefined }), ctx)).toBe(true);
    });
  });

  describe('command: scope', () => {
    it('returns false regardless of context (command scopes only apply in proxy path)', () => {
      const ctx: PolicyExecutionContext = { callerType: 'agent', depth: 0 };
      expect(policyScopeMatches(makePolicy({ scope: 'command:curl' }), ctx)).toBe(false);
    });

    it('returns false when context is undefined', () => {
      expect(policyScopeMatches(makePolicy({ scope: 'command:curl' }), undefined)).toBe(false);
    });

    it('returns false for skill callerType too', () => {
      const ctx: PolicyExecutionContext = { callerType: 'skill', skillSlug: 'test', depth: 0 };
      expect(policyScopeMatches(makePolicy({ scope: 'command:git' }), ctx)).toBe(false);
    });

    it('returns false for any command name', () => {
      expect(policyScopeMatches(makePolicy({ scope: 'command:fb' }))).toBe(false);
      expect(policyScopeMatches(makePolicy({ scope: 'command:jr' }))).toBe(false);
      expect(policyScopeMatches(makePolicy({ scope: 'command:node' }))).toBe(false);
    });
  });

  describe('agent scope', () => {
    it('matches when callerType is agent', () => {
      const ctx: PolicyExecutionContext = { callerType: 'agent', depth: 0 };
      expect(policyScopeMatches(makePolicy({ scope: 'agent' }), ctx)).toBe(true);
    });

    it('does not match when callerType is skill', () => {
      const ctx: PolicyExecutionContext = { callerType: 'skill', skillSlug: 'test', depth: 0 };
      expect(policyScopeMatches(makePolicy({ scope: 'agent' }), ctx)).toBe(false);
    });

    it('matches when context is undefined (no context = allow)', () => {
      expect(policyScopeMatches(makePolicy({ scope: 'agent' }), undefined)).toBe(true);
    });
  });

  describe('skill scope', () => {
    it('matches when callerType is skill', () => {
      const ctx: PolicyExecutionContext = { callerType: 'skill', skillSlug: 'test', depth: 0 };
      expect(policyScopeMatches(makePolicy({ scope: 'skill' }), ctx)).toBe(true);
    });

    it('does not match when callerType is agent', () => {
      const ctx: PolicyExecutionContext = { callerType: 'agent', depth: 0 };
      expect(policyScopeMatches(makePolicy({ scope: 'skill' }), ctx)).toBe(false);
    });
  });

  describe('skill:<slug> scope', () => {
    it('matches when callerType is skill and slug matches', () => {
      const ctx: PolicyExecutionContext = { callerType: 'skill', skillSlug: 'agenco', depth: 0 };
      expect(policyScopeMatches(makePolicy({ scope: 'skill:agenco' }), ctx)).toBe(true);
    });

    it('does not match when slug differs', () => {
      const ctx: PolicyExecutionContext = { callerType: 'skill', skillSlug: 'other', depth: 0 };
      expect(policyScopeMatches(makePolicy({ scope: 'skill:agenco' }), ctx)).toBe(false);
    });

    it('does not match when callerType is agent', () => {
      const ctx: PolicyExecutionContext = { callerType: 'agent', depth: 0 };
      expect(policyScopeMatches(makePolicy({ scope: 'skill:agenco' }), ctx)).toBe(false);
    });
  });

  describe('unknown scope', () => {
    it('returns true for unrecognized scopes (permissive fallback)', () => {
      const ctx: PolicyExecutionContext = { callerType: 'agent', depth: 0 };
      expect(policyScopeMatches(makePolicy({ scope: 'future:scope' as string }), ctx)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// matchUrlPattern
// ---------------------------------------------------------------------------

describe('matchUrlPattern', () => {
  it('matches bare domain against HTTPS URL', () => {
    expect(matchUrlPattern('example.com', 'https://example.com')).toBe(true);
  });

  it('matches bare domain against sub-path', () => {
    expect(matchUrlPattern('example.com', 'https://example.com/path/to/page')).toBe(true);
  });

  it('matches with explicit https://', () => {
    expect(matchUrlPattern('https://example.com', 'https://example.com')).toBe(true);
  });

  it('matches www subdomain variant', () => {
    expect(matchUrlPattern('facebook.com', 'https://www.facebook.com')).toBe(true);
  });

  it('does not match different domains', () => {
    expect(matchUrlPattern('example.com', 'https://other.com')).toBe(false);
  });

  it('matches wildcard patterns', () => {
    expect(matchUrlPattern('*.example.com', 'https://sub.example.com')).toBe(true);
  });

  it('matches globstar patterns', () => {
    expect(matchUrlPattern('https://example.com/**', 'https://example.com/any/path')).toBe(true);
  });

  it('does not match HTTP when pattern is HTTPS', () => {
    expect(matchUrlPattern('https://example.com', 'http://example.com')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeUrlTarget
// ---------------------------------------------------------------------------

describe('normalizeUrlTarget', () => {
  it('keeps protocol and host', () => {
    expect(normalizeUrlTarget('https://example.com')).toBe('https://example.com/');
  });

  it('strips trailing slashes from paths', () => {
    expect(normalizeUrlTarget('https://example.com/path/')).toBe('https://example.com/path');
  });

  it('preserves query strings', () => {
    expect(normalizeUrlTarget('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });

  it('returns input for non-URL strings', () => {
    expect(normalizeUrlTarget('not-a-url')).toBe('not-a-url');
  });
});

// ---------------------------------------------------------------------------
// normalizeUrlBase
// ---------------------------------------------------------------------------

describe('normalizeUrlBase', () => {
  it('adds https:// to bare domain', () => {
    expect(normalizeUrlBase('example.com')).toBe('https://example.com');
  });

  it('preserves explicit http://', () => {
    expect(normalizeUrlBase('http://example.com')).toBe('http://example.com');
  });

  it('preserves explicit https://', () => {
    expect(normalizeUrlBase('https://example.com')).toBe('https://example.com');
  });

  it('strips trailing slashes', () => {
    expect(normalizeUrlBase('example.com/')).toBe('https://example.com');
  });

  it('preserves wildcard protocol', () => {
    expect(normalizeUrlBase('*://example.com')).toBe('*://example.com');
  });
});

// ---------------------------------------------------------------------------
// checkUrlPolicy
// ---------------------------------------------------------------------------

describe('checkUrlPolicy', () => {
  it('allows URL matching an allow policy', () => {
    const policies = [makePolicy({ action: 'allow', patterns: ['example.com'] })];
    expect(checkUrlPolicy(policies, 'https://example.com', 'deny')).toBe(true);
  });

  it('denies URL matching a deny policy', () => {
    const policies = [makePolicy({ action: 'deny', patterns: ['example.com'] })];
    expect(checkUrlPolicy(policies, 'https://example.com', 'allow')).toBe(false);
  });

  it('falls back to defaultAction when no policy matches', () => {
    const policies = [makePolicy({ action: 'deny', patterns: ['other.com'] })];
    expect(checkUrlPolicy(policies, 'https://example.com', 'allow')).toBe(true);
    expect(checkUrlPolicy(policies, 'https://example.com', 'deny')).toBe(false);
  });

  it('skips disabled policies', () => {
    const policies = [makePolicy({ action: 'allow', patterns: ['example.com'], enabled: false })];
    expect(checkUrlPolicy(policies, 'https://example.com', 'deny')).toBe(false);
  });

  it('respects priority ordering (higher priority wins)', () => {
    const policies = [
      makePolicy({ id: 'low', action: 'allow', patterns: ['example.com'], priority: 10 }),
      makePolicy({ id: 'high', action: 'deny', patterns: ['example.com'], priority: 100 }),
    ];
    expect(checkUrlPolicy(policies, 'https://example.com', 'allow')).toBe(false);
  });

  it('blocks plain HTTP to non-localhost by default', () => {
    const policies = [makePolicy({ action: 'allow', patterns: ['example.com'] })];
    expect(checkUrlPolicy(policies, 'http://example.com', 'allow')).toBe(false);
  });

  it('allows plain HTTP to localhost without explicit policy', () => {
    const policies: ReturnType<typeof makePolicy>[] = [];
    expect(checkUrlPolicy(policies, 'http://127.0.0.1:3000/api', 'allow')).toBe(true);
    expect(checkUrlPolicy(policies, 'http://localhost:8080/test', 'allow')).toBe(true);
  });

  it('allows plain HTTP with explicit http:// pattern', () => {
    const policies = [makePolicy({ action: 'allow', patterns: ['http://example.com'] })];
    expect(checkUrlPolicy(policies, 'http://example.com', 'deny')).toBe(true);
  });

  it('skips non-url target policies', () => {
    const policies = [makePolicy({ action: 'allow', target: 'command', patterns: ['example.com'] })];
    expect(checkUrlPolicy(policies, 'https://example.com', 'deny')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// commandScopeMatches
// ---------------------------------------------------------------------------

describe('commandScopeMatches', () => {
  it('matches universal (no scope) policies', () => {
    expect(commandScopeMatches(makePolicy({ scope: undefined }), 'curl')).toBe(true);
  });

  it('matches when command: scope matches basename', () => {
    expect(commandScopeMatches(makePolicy({ scope: 'command:curl' }), 'curl')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(commandScopeMatches(makePolicy({ scope: 'command:Curl' }), 'curl')).toBe(true);
  });

  it('does not match different command', () => {
    expect(commandScopeMatches(makePolicy({ scope: 'command:curl' }), 'wget')).toBe(false);
  });

  it('treats agent scope as universal for command filtering', () => {
    expect(commandScopeMatches(makePolicy({ scope: 'agent' }), 'curl')).toBe(true);
  });

  it('treats skill scope as universal for command filtering', () => {
    expect(commandScopeMatches(makePolicy({ scope: 'skill' }), 'curl')).toBe(true);
  });

  it('treats skill:<slug> scope as universal for command filtering', () => {
    expect(commandScopeMatches(makePolicy({ scope: 'skill:agenco' }), 'curl')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterUrlPoliciesForCommand
// ---------------------------------------------------------------------------

describe('filterUrlPoliciesForCommand', () => {
  it('includes universal URL policies', () => {
    const policies = [makePolicy({ scope: undefined })];
    expect(filterUrlPoliciesForCommand(policies, 'curl')).toHaveLength(1);
  });

  it('includes matching command-scoped URL policies', () => {
    const policies = [makePolicy({ scope: 'command:curl' })];
    expect(filterUrlPoliciesForCommand(policies, 'curl')).toHaveLength(1);
  });

  it('excludes non-matching command-scoped policies', () => {
    const policies = [makePolicy({ scope: 'command:wget' })];
    expect(filterUrlPoliciesForCommand(policies, 'curl')).toHaveLength(0);
  });

  it('excludes disabled policies', () => {
    const policies = [makePolicy({ scope: undefined, enabled: false })];
    expect(filterUrlPoliciesForCommand(policies, 'curl')).toHaveLength(0);
  });

  it('excludes non-url target policies', () => {
    const policies = [makePolicy({ scope: undefined, target: 'command' })];
    expect(filterUrlPoliciesForCommand(policies, 'curl')).toHaveLength(0);
  });

  it('combines global + command-specific policies', () => {
    const policies = [
      makePolicy({ id: 'global', scope: undefined, patterns: ['api.internal.com'] }),
      makePolicy({ id: 'curl-only', scope: 'command:curl', patterns: ['example.com'] }),
      makePolicy({ id: 'wget-only', scope: 'command:wget', patterns: ['other.com'] }),
    ];
    const filtered = filterUrlPoliciesForCommand(policies, 'curl');
    expect(filtered).toHaveLength(2);
    expect(filtered.map((p) => p.id)).toEqual(['global', 'curl-only']);
  });
});

// ---------------------------------------------------------------------------
// extractCommandBasename
// ---------------------------------------------------------------------------

describe('extractCommandBasename', () => {
  it('extracts basename from full path', () => {
    expect(extractCommandBasename('/usr/bin/curl -s https://x.com')).toBe('curl');
  });

  it('extracts from simple command', () => {
    expect(extractCommandBasename('node script.js')).toBe('node');
  });

  it('strips fork: prefix', () => {
    expect(extractCommandBasename('fork:git push')).toBe('git');
  });

  it('handles command without arguments', () => {
    expect(extractCommandBasename('curl')).toBe('curl');
  });
});

// ---------------------------------------------------------------------------
// Integration: policyScopeMatches vs filterUrlPoliciesForCommand consistency
// ---------------------------------------------------------------------------

describe('scope handling consistency between evaluation paths', () => {
  const commandPolicy = makePolicy({ scope: 'command:curl', action: 'allow', patterns: ['example.com'] });
  const globalPolicy = makePolicy({ id: 'global', scope: undefined, action: 'deny', patterns: ['example.com'] });

  it('command-scoped policy excluded from evaluatePolicyCheck path (via policyScopeMatches)', () => {
    const agentCtx: PolicyExecutionContext = { callerType: 'agent', depth: 0 };
    expect(policyScopeMatches(commandPolicy, agentCtx)).toBe(false);
    expect(policyScopeMatches(commandPolicy, undefined)).toBe(false);
  });

  it('command-scoped policy included in proxy path (via commandScopeMatches)', () => {
    expect(commandScopeMatches(commandPolicy, 'curl')).toBe(true);
    expect(commandScopeMatches(commandPolicy, 'wget')).toBe(false);
  });

  it('global policy included in both paths', () => {
    const agentCtx: PolicyExecutionContext = { callerType: 'agent', depth: 0 };
    expect(policyScopeMatches(globalPolicy, agentCtx)).toBe(true);
    expect(commandScopeMatches(globalPolicy, 'curl')).toBe(true);
  });
});
