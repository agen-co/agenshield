import {
  resolveSourceOrigin,
  prefixSlug,
  stripSlugPrefix,
  sourceHasPrefix,
  SOURCE_SLUG_PREFIX,
} from '@agenshield/ipc';

describe('resolveSourceOrigin', () => {
  it.each([
    ['mcp', 'mcp'],
    ['registry', 'registry'],
    ['openclaw', 'openclaw'],
    ['clawhub', 'clawhub'],
    ['local', 'local'],
    ['manual', 'manual'],
  ] as const)('maps "%s" to "%s"', (input, expected) => {
    expect(resolveSourceOrigin(input)).toBe(expected);
  });

  it('returns "unknown" for unrecognized source', () => {
    expect(resolveSourceOrigin('something-else')).toBe('unknown');
  });
});

describe('deprecated no-ops', () => {
  it('prefixSlug returns rawSlug unchanged', () => {
    expect(prefixSlug('mcp', 'my-slug')).toBe('my-slug');
  });

  it('stripSlugPrefix always returns null', () => {
    expect(stripSlugPrefix('ag:my-slug')).toBeNull();
  });

  it('sourceHasPrefix always returns false', () => {
    expect(sourceHasPrefix('mcp')).toBe(false);
  });

  it('SOURCE_SLUG_PREFIX is defined', () => {
    expect(SOURCE_SLUG_PREFIX).toHaveProperty('mcp');
    expect(SOURCE_SLUG_PREFIX).toHaveProperty('registry');
  });
});
