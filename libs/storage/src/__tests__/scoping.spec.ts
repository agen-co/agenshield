import { buildScopeWhere, getConfigScopeLevels, buildPolicyScopeWhere, mergeConfigRows, resolveSecretScope } from '../scoping';

describe('scoping', () => {
  describe('buildScopeWhere', () => {
    it('returns 1=1 for no scope', () => {
      const { clause, params } = buildScopeWhere();
      expect(clause).toBe('1=1');
      expect(params).toEqual({});
    });

    it('filters by profileId', () => {
      const { clause, params } = buildScopeWhere({ profileId: 'openclaw' });
      expect(clause).toContain('profile_id = @profileId');
      expect(params).toEqual({ profileId: 'openclaw' });
    });

    it('filters by null profileId (global scope)', () => {
      const { clause } = buildScopeWhere({ profileId: null });
      expect(clause).toContain('profile_id IS NULL');
    });
  });

  describe('getConfigScopeLevels', () => {
    it('returns just base for no scope', () => {
      const levels = getConfigScopeLevels();
      expect(levels).toEqual([{ profileId: null }]);
    });

    it('returns base + profile for profile scope', () => {
      const levels = getConfigScopeLevels({ profileId: 'openclaw' });
      expect(levels).toHaveLength(2);
      expect(levels[0]).toEqual({ profileId: null });
      expect(levels[1]).toEqual({ profileId: 'openclaw' });
    });
  });

  describe('buildPolicyScopeWhere', () => {
    it('returns 1=1 for no scope', () => {
      const { clause } = buildPolicyScopeWhere();
      expect(clause).toBe('1=1');
    });

    it('includes base + profile for profile scope', () => {
      const { clause } = buildPolicyScopeWhere({ profileId: 'oc' });
      expect(clause).toContain('profile_id IS NULL');
      expect(clause).toContain('profile_id = @profileId');
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
      const profile = { port: 6969, host: null, logLevel: null };
      const merged = mergeConfigRows([base, profile]);
      expect(merged).toEqual({ port: 6969, host: 'localhost', logLevel: 'info' });
    });
  });

  describe('resolveSecretScope', () => {
    it('returns empty array for empty input', () => {
      expect(resolveSecretScope([])).toEqual([]);
    });

    it('most specific scope wins per name', () => {
      const rows = [
        { name: 'DB_URL', profile_id: null, value: 'base' },
        { name: 'DB_URL', profile_id: 'oc', value: 'profile' },
        { name: 'API_KEY', profile_id: null, value: 'global' },
      ];
      const resolved = resolveSecretScope(rows);
      expect(resolved).toHaveLength(2);
      const dbUrl = resolved.find((r) => r.name === 'DB_URL');
      expect(dbUrl?.value).toBe('profile');
    });
  });
});
