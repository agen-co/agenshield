import { SecretResolver } from '../../secrets/resolver.js';

function createResolver(): SecretResolver {
  return new SecretResolver();
}

function pushSecrets(
  resolver: SecretResolver,
  globals: Record<string, string> = {},
  bindings: Array<{
    policyId: string;
    target: 'url' | 'command';
    patterns: string[];
    secrets: Record<string, string>;
  }> = []
): void {
  resolver.updateFromPush({
    version: '1.0.0',
    syncedAt: new Date().toISOString(),
    globalSecrets: globals,
    policyBindings: bindings,
  });
}

describe('SecretResolver', () => {
  describe('updateFromPush() / clear()', () => {
    it('should store and return global secrets', () => {
      const resolver = createResolver();
      pushSecrets(resolver, { API_KEY: 'abc123' });
      const result = resolver.getSecretsForExec('node', ['server.js']);
      expect(result).toEqual({ API_KEY: 'abc123' });
    });

    it('should return empty before any push', () => {
      const resolver = createResolver();
      expect(resolver.getSecretsForExec('node', [])).toEqual({});
    });

    it('should clear all secrets', () => {
      const resolver = createResolver();
      pushSecrets(resolver, { KEY: 'val' });
      resolver.clear();
      expect(resolver.getSecretsForExec('node', [])).toEqual({});
    });

    it('should replace data on second push', () => {
      const resolver = createResolver();
      pushSecrets(resolver, { OLD: 'old' });
      pushSecrets(resolver, { NEW: 'new' });
      const result = resolver.getSecretsForExec('node', []);
      expect(result).toEqual({ NEW: 'new' });
    });
  });

  describe('getSecretsForExec() — command bindings', () => {
    it('should match command binding with node:*', () => {
      const resolver = createResolver();
      pushSecrets(resolver, {}, [
        { policyId: 'p1', target: 'command', patterns: ['node:*'], secrets: { NODE_TOKEN: 'tok' } },
      ]);
      expect(resolver.getSecretsForExec('node', ['server.js'])).toEqual({ NODE_TOKEN: 'tok' });
    });

    it('should not match unrelated command', () => {
      const resolver = createResolver();
      pushSecrets(resolver, {}, [
        { policyId: 'p1', target: 'command', patterns: ['node:*'], secrets: { TOKEN: 'tok' } },
      ]);
      expect(resolver.getSecretsForExec('python', ['app.py'])).toEqual({});
    });

    it('should match exact command', () => {
      const resolver = createResolver();
      pushSecrets(resolver, {}, [
        { policyId: 'p1', target: 'command', patterns: ['git pull'], secrets: { GIT_TOKEN: 'tok' } },
      ]);
      expect(resolver.getSecretsForExec('git', ['pull'])).toEqual({ GIT_TOKEN: 'tok' });
    });

    it('should match wildcard * for any command', () => {
      const resolver = createResolver();
      pushSecrets(resolver, {}, [
        { policyId: 'p1', target: 'command', patterns: ['*'], secrets: { GLOBAL: 'g' } },
      ]);
      expect(resolver.getSecretsForExec('anything', ['args'])).toEqual({ GLOBAL: 'g' });
    });

    it('should merge policy secrets on top of global (policy wins)', () => {
      const resolver = createResolver();
      pushSecrets(
        resolver,
        { KEY: 'global', OTHER: 'keep' },
        [{ policyId: 'p1', target: 'command', patterns: ['*'], secrets: { KEY: 'policy' } }]
      );
      const result = resolver.getSecretsForExec('cmd', []);
      expect(result.KEY).toBe('policy');
      expect(result.OTHER).toBe('keep');
    });
  });

  describe('getSecretsForExec() — URL bindings', () => {
    it('should match URL binding for curl', () => {
      const resolver = createResolver();
      pushSecrets(resolver, {}, [
        { policyId: 'p1', target: 'url', patterns: ['https://api.example.com/**'], secrets: { API_KEY: 'key' } },
      ]);
      expect(resolver.getSecretsForExec('curl', ['https://api.example.com/v1/data'])).toEqual({ API_KEY: 'key' });
    });

    it('should match URL binding for wget', () => {
      const resolver = createResolver();
      pushSecrets(resolver, {}, [
        { policyId: 'p1', target: 'url', patterns: ['https://example.com'], secrets: { TOKEN: 'tok' } },
      ]);
      expect(resolver.getSecretsForExec('wget', ['https://example.com/path'])).toEqual({ TOKEN: 'tok' });
    });

    it('should NOT match URL binding for non-HTTP commands', () => {
      const resolver = createResolver();
      pushSecrets(resolver, {}, [
        { policyId: 'p1', target: 'url', patterns: ['https://example.com/**'], secrets: { KEY: 'k' } },
      ]);
      expect(resolver.getSecretsForExec('node', ['https://example.com/foo'])).toEqual({});
    });

    it('should skip flags when extracting URL from args', () => {
      const resolver = createResolver();
      pushSecrets(resolver, {}, [
        { policyId: 'p1', target: 'url', patterns: ['https://api.test.com/**'], secrets: { KEY: 'k' } },
      ]);
      const result = resolver.getSecretsForExec('curl', ['-H', 'Auth: Bearer tok', 'https://api.test.com/v1']);
      expect(result).toEqual({ KEY: 'k' });
    });

    it('should skip flag values (-o output.json)', () => {
      const resolver = createResolver();
      pushSecrets(resolver, {}, [
        { policyId: 'p1', target: 'url', patterns: ['https://api.test.com'], secrets: { KEY: 'k' } },
      ]);
      const result = resolver.getSecretsForExec('curl', ['-o', 'output.json', 'https://api.test.com']);
      expect(result).toEqual({ KEY: 'k' });
    });

    it('should match URL pattern without protocol prefix', () => {
      const resolver = createResolver();
      pushSecrets(resolver, {}, [
        { policyId: 'p1', target: 'url', patterns: ['api.example.com/**'], secrets: { API_KEY: 'key' } },
      ]);
      expect(resolver.getSecretsForExec('curl', ['https://api.example.com/v1'])).toEqual({ API_KEY: 'key' });
    });

    it('should handle no URL in curl args (only flags)', () => {
      const resolver = createResolver();
      pushSecrets(resolver, { GLOBAL: 'g' }, [
        { policyId: 'p1', target: 'url', patterns: ['https://api.example.com/**'], secrets: { API_KEY: 'key' } },
      ]);
      // Only flags, no URL → URL binding won't match, only global secrets
      const result = resolver.getSecretsForExec('curl', ['-X', 'POST']);
      expect(result).toEqual({ GLOBAL: 'g' });
    });
  });

  describe('normalizeUrlTarget()', () => {
    it('should return trimmed string without trailing slashes for invalid URL', () => {
      const resolver = createResolver();
      // Access private method
      const result = (resolver as any).normalizeUrlTarget('not a valid url///');
      expect(result).toBe('not a valid url');
    });
  });

  describe('getSecretNamesForExec()', () => {
    it('should return only keys, never values', () => {
      const resolver = createResolver();
      pushSecrets(resolver, { API_KEY: 'secret-value', TOKEN: 'secret-token' });
      const names = resolver.getSecretNamesForExec('node', []);
      expect(names).toEqual(expect.arrayContaining(['API_KEY', 'TOKEN']));
      expect(names).not.toContain('secret-value');
    });
  });
});
