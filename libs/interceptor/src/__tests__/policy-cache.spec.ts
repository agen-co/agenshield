import { PolicyCache } from '../policy/cache';

describe('PolicyCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns undefined on cache miss', () => {
    const cache = new PolicyCache({ ttl: 5000 });
    expect(cache.get('missing')).toBeUndefined();
  });

  it('returns cached value on hit', () => {
    const cache = new PolicyCache({ ttl: 5000 });
    cache.set('key1', { allowed: true });
    expect(cache.get('key1')).toEqual({ allowed: true });
  });

  it('returns undefined for expired entries', () => {
    const cache = new PolicyCache({ ttl: 1000 });
    cache.set('key1', 'val');
    jest.advanceTimersByTime(1001);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('uses custom TTL per entry', () => {
    const cache = new PolicyCache({ ttl: 10000 });
    cache.set('short', 'data', 500);
    jest.advanceTimersByTime(501);
    expect(cache.get('short')).toBeUndefined();
  });

  it('evicts oldest entry when at maxSize', () => {
    const cache = new PolicyCache({ ttl: 10000, maxSize: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // should evict 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('has() returns true for valid entries and false for missing/expired', () => {
    const cache = new PolicyCache({ ttl: 1000 });
    expect(cache.has('x')).toBe(false);
    cache.set('x', 42);
    expect(cache.has('x')).toBe(true);
    jest.advanceTimersByTime(1001);
    expect(cache.has('x')).toBe(false);
  });

  it('delete() removes an entry', () => {
    const cache = new PolicyCache({ ttl: 5000 });
    cache.set('k', 'v');
    expect(cache.delete('k')).toBe(true);
    expect(cache.get('k')).toBeUndefined();
    expect(cache.delete('k')).toBe(false);
  });

  it('clear() removes all entries and resets stats', () => {
    const cache = new PolicyCache({ ttl: 5000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // hit
    cache.get('missing'); // miss
    cache.clear();
    expect(cache.getStats()).toEqual({ size: 0, hits: 0, misses: 0 });
  });

  it('prune() removes only expired entries', () => {
    const cache = new PolicyCache({ ttl: 1000 });
    cache.set('a', 1);
    cache.set('b', 2, 5000); // longer TTL
    jest.advanceTimersByTime(1001);
    const pruned = cache.prune();
    expect(pruned).toBe(1);
    expect(cache.get('b')).toBe(2);
    expect(cache.has('a')).toBe(false);
  });

  it('getStats() tracks hits and misses correctly', () => {
    const cache = new PolicyCache({ ttl: 5000 });
    cache.set('a', 1);
    cache.get('a'); // hit
    cache.get('a'); // hit
    cache.get('b'); // miss
    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.size).toBe(1);
  });

  it('uses default maxSize of 1000', () => {
    const cache = new PolicyCache({ ttl: 5000 });
    // Set 1001 entries, first should be evicted
    for (let i = 0; i < 1001; i++) {
      cache.set(`key-${i}`, i);
    }
    expect(cache.get('key-0')).toBeUndefined();
    expect(cache.get('key-1000')).toBe(1000);
  });

  it('tracks miss when entry is found but expired in get()', () => {
    const cache = new PolicyCache({ ttl: 100 });
    cache.set('x', 'val');
    jest.advanceTimersByTime(101);
    cache.get('x'); // expired → miss
    expect(cache.getStats().misses).toBe(1);
    expect(cache.getStats().hits).toBe(0);
  });
});
