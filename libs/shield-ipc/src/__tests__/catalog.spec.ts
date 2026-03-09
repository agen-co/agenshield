import { searchCatalog, COMMAND_CATALOG } from '@agenshield/ipc';

describe('COMMAND_CATALOG', () => {
  it('is a non-empty object', () => {
    expect(Object.keys(COMMAND_CATALOG).length).toBeGreaterThan(0);
  });

  it('entries have required fields', () => {
    for (const [, entry] of Object.entries(COMMAND_CATALOG)) {
      expect(entry).toHaveProperty('description');
      expect(entry).toHaveProperty('category');
      expect(entry).toHaveProperty('risk');
      expect(entry).toHaveProperty('tags');
      expect(Array.isArray(entry.tags)).toBe(true);
    }
  });
});

describe('searchCatalog', () => {
  it('returns first N items with score 0 for empty query', () => {
    const results = searchCatalog('');
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(20);
    results.forEach((r) => expect(r.score).toBe(0));
  });

  it('returns first N items for whitespace-only query', () => {
    const results = searchCatalog('   ');
    expect(results.length).toBeGreaterThan(0);
    results.forEach((r) => expect(r.score).toBe(0));
  });

  it('scores exact name match at 100', () => {
    const results = searchCatalog('curl');
    expect(results[0].name).toBe('curl');
    expect(results[0].score).toBe(100);
  });

  it('scores prefix match at 60', () => {
    const results = searchCatalog('cur');
    const curlResult = results.find((r) => r.name === 'curl');
    expect(curlResult).toBeDefined();
    expect(curlResult!.score).toBe(60);
  });

  it('scores substring match at 40', () => {
    const results = searchCatalog('rl');
    const curlResult = results.find((r) => r.name === 'curl');
    expect(curlResult).toBeDefined();
    expect(curlResult!.score).toBe(40);
  });

  it('matches by tag', () => {
    const results = searchCatalog('http');
    const names = results.map((r) => r.name);
    expect(names).toContain('curl');
    expect(names).toContain('wget');
  });

  it('matches by description', () => {
    const results = searchCatalog('superuser');
    const sudoResult = results.find((r) => r.name === 'sudo');
    expect(sudoResult).toBeDefined();
    expect(sudoResult!.score).toBeGreaterThan(0);
  });

  it('sums token scores for multi-word query', () => {
    const results = searchCatalog('package manager');
    expect(results.length).toBeGreaterThan(0);
    // multi-word should match package managers
    const npmResult = results.find((r) => r.name === 'npm');
    expect(npmResult).toBeDefined();
  });

  it('respects limit parameter', () => {
    const results = searchCatalog('', COMMAND_CATALOG, 3);
    expect(results.length).toBe(3);
  });

  it('returns results sorted by score descending', () => {
    const results = searchCatalog('node');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('accepts custom entries parameter', () => {
    const custom = {
      mytool: {
        description: 'My custom tool',
        category: 'system' as const,
        risk: 'low' as const,
        riskReason: 'Safe',
        tags: ['custom'],
      },
    };
    const results = searchCatalog('mytool', custom);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('mytool');
    expect(results[0].score).toBe(100);
  });

  it('returns no results for unmatched query', () => {
    const results = searchCatalog('zzzznonexistent');
    expect(results).toHaveLength(0);
  });

  it('tag exact match scores 30', () => {
    // 'download' is an exact tag on curl; curl name doesn't match 'download'
    const results = searchCatalog('download');
    const curlResult = results.find((r) => r.name === 'curl');
    expect(curlResult).toBeDefined();
    expect(curlResult!.score).toBe(30);
  });

  it('tag substring match scores 15', () => {
    // 'ownloa' is a substring of the 'download' tag, doesn't match name
    const results = searchCatalog('ownloa');
    const curlResult = results.find((r) => r.name === 'curl');
    expect(curlResult).toBeDefined();
    expect(curlResult!.score).toBe(15);
  });
});
