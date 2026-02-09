import {
  parseVersion,
  compareVersions,
  versionGte,
  hasOpenClawFeature,
} from '../version-features';

describe('parseVersion', () => {
  it('parses major.minor.patch into 4 segments with build=0', () => {
    expect(parseVersion('2026.2.3')).toEqual([2026, 2, 3, 0]);
  });

  it('parses major.minor.patch-build into 4 segments', () => {
    expect(parseVersion('2026.2.3-3')).toEqual([2026, 2, 3, 3]);
  });

  it('parses a two-segment version', () => {
    expect(parseVersion('1.0')).toEqual([1, 0, 0, 0]);
  });
});

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('2026.2.3', '2026.2.3')).toBe(0);
  });

  it('treats missing build as 0', () => {
    expect(compareVersions('2026.2.3', '2026.2.3-0')).toBe(0);
  });

  it('version with build > version without build', () => {
    expect(compareVersions('2026.2.3-3', '2026.2.3')).toBe(1);
  });

  it('higher patch > lower patch regardless of build', () => {
    expect(compareVersions('2026.2.3', '2026.2.2-9')).toBe(1);
  });

  it('lower version < higher version', () => {
    expect(compareVersions('2026.2.2', '2026.2.3')).toBe(-1);
  });

  it('ordering: 2026.2.3-3 > 2026.2.3 > 2026.2.2-9', () => {
    expect(compareVersions('2026.2.3-3', '2026.2.3')).toBe(1);
    expect(compareVersions('2026.2.3', '2026.2.2-9')).toBe(1);
    expect(compareVersions('2026.2.3-3', '2026.2.2-9')).toBe(1);
  });
});

describe('versionGte', () => {
  it('returns false for null version', () => {
    expect(versionGte(null, '2026.2.3')).toBe(false);
  });

  it('returns false for undefined version', () => {
    expect(versionGte(undefined, '2026.2.3')).toBe(false);
  });

  it('returns true when version equals minimum', () => {
    expect(versionGte('2026.2.3', '2026.2.3')).toBe(true);
  });

  it('returns true when version exceeds minimum (build)', () => {
    expect(versionGte('2026.2.3-3', '2026.2.3')).toBe(true);
  });

  it('returns false when version is below minimum', () => {
    expect(versionGte('2026.2.2', '2026.2.3')).toBe(false);
  });
});

describe('hasOpenClawFeature', () => {
  it('returns false for null version', () => {
    expect(hasOpenClawFeature(null, 'hashTokenAuth')).toBe(false);
  });

  it('returns false for version below threshold', () => {
    expect(hasOpenClawFeature('2026.2.2', 'hashTokenAuth')).toBe(false);
  });

  it('returns true for exact threshold version', () => {
    expect(hasOpenClawFeature('2026.2.3', 'hashTokenAuth')).toBe(true);
  });

  it('returns true for version above threshold', () => {
    expect(hasOpenClawFeature('2026.3.0', 'hashTokenAuth')).toBe(true);
  });

  it('returns true for version with build above threshold', () => {
    expect(hasOpenClawFeature('2026.2.3-1', 'hashTokenAuth')).toBe(true);
  });
});
