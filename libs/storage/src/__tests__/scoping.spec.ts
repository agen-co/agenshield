import { buildScopeWhere, getConfigScopeLevels, buildPolicyScopeWhere, mergeConfigRows, resolveSecretScope } from '../scoping';

describe('scoping', () => {
  describe('buildScopeWhere', () => {
    it('returns 1=1 for no scope', () => {
      const { clause, params } = buildScopeWhere();
      expect(clause).toBe('1=1');
      expect(params).toEqual({});
    });

    it('filters by targetId', () => {
      const { clause, params } = buildScopeWhere({ targetId: 'openclaw' });
      expect(clause).toContain('target_id = @targetId');
      expect(params).toEqual({ targetId: 'openclaw' });
    });

    it('filters by null targetId', () => {
      const { clause } = buildScopeWhere({ targetId: null });
      expect(clause).toContain('target_id IS NULL');
    });

    it('filters by both targetId and userUsername', () => {
      const { clause, params } = buildScopeWhere({ targetId: 'oc', userUsername: 'agent' });
      expect(clause).toContain('target_id = @targetId');
      expect(clause).toContain('user_username = @userUsername');
      expect(params).toEqual({ targetId: 'oc', userUsername: 'agent' });
    });
  });

  describe('getConfigScopeLevels', () => {
    it('returns just base for no scope', () => {
      const levels = getConfigScopeLevels();
      expect(levels).toEqual([{ targetId: null, userUsername: null }]);
    });

    it('returns base + target for target scope', () => {
      const levels = getConfigScopeLevels({ targetId: 'oc' });
      expect(levels).toHaveLength(2);
      expect(levels[0]).toEqual({ targetId: null, userUsername: null });
      expect(levels[1]).toEqual({ targetId: 'oc', userUsername: null });
    });

    it('returns base + target + target+user for full scope', () => {
      const levels = getConfigScopeLevels({ targetId: 'oc', userUsername: 'agent' });
      expect(levels).toHaveLength(3);
      expect(levels[2]).toEqual({ targetId: 'oc', userUsername: 'agent' });
    });
  });

  describe('buildPolicyScopeWhere', () => {
    it('returns 1=1 for no scope', () => {
      const { clause } = buildPolicyScopeWhere();
      expect(clause).toBe('1=1');
    });

    it('includes base + target for target scope', () => {
      const { clause } = buildPolicyScopeWhere({ targetId: 'oc' });
      expect(clause).toContain('target_id IS NULL AND user_username IS NULL');
      expect(clause).toContain('target_id = @targetId AND user_username IS NULL');
    });
  });

  describe('mergeConfigRows', () => {
    it('returns null for empty array', () => {
      expect(mergeConfigRows([])).toBeNull();
    });

    it('returns single row as-is', () => {
      const row = { port: 5200, host: 'localhost', logLevel: null };
      expect(mergeConfigRows([row])).toEqual(row);
    });

    it('overrides non-null values from more specific scope', () => {
      const base = { port: 5200, host: 'localhost', logLevel: 'info' };
      const target = { port: 6969, host: null, logLevel: null };
      const merged = mergeConfigRows([base, target]);
      expect(merged).toEqual({ port: 6969, host: 'localhost', logLevel: 'info' });
    });

    it('three-level merge', () => {
      const base = { a: 1, b: 2, c: 3 };
      const target = { a: null, b: 20, c: null };
      const user = { a: null, b: null, c: 300 };
      const merged = mergeConfigRows([base, target, user]);
      expect(merged).toEqual({ a: 1, b: 20, c: 300 });
    });
  });

  describe('resolveSecretScope', () => {
    it('returns empty array for empty input', () => {
      expect(resolveSecretScope([])).toEqual([]);
    });

    it('most specific scope wins per name', () => {
      const rows = [
        { name: 'DB_URL', target_id: null, user_username: null, value: 'base' },
        { name: 'DB_URL', target_id: 'oc', user_username: null, value: 'target' },
        { name: 'API_KEY', target_id: null, user_username: null, value: 'global' },
      ];
      const resolved = resolveSecretScope(rows);
      expect(resolved).toHaveLength(2);
      const dbUrl = resolved.find((r) => r.name === 'DB_URL');
      expect(dbUrl?.value).toBe('target');
    });
  });
});
