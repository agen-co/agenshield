import { contextToScope } from '@agenshield/ipc';
import type { ShieldContext, ScopeFilter } from '@agenshield/ipc';

describe('contextToScope', () => {
  it('extracts profileId from context', () => {
    const ctx: ShieldContext = {
      traceId: 'trace-1',
      profileId: 'abc',
      requestedAt: '2026-01-01T00:00:00Z',
      source: 'ui',
    };
    const scope = contextToScope(ctx);
    expect(scope).toEqual({ profileId: 'abc' });
  });

  it('handles null profileId', () => {
    const ctx: ShieldContext = {
      traceId: 'trace-2',
      profileId: null,
      requestedAt: '2026-01-01T00:00:00Z',
      source: 'cli',
    };
    const scope = contextToScope(ctx);
    expect(scope).toEqual({ profileId: null });
  });

  it('returns ScopeFilter shape', () => {
    const ctx: ShieldContext = {
      traceId: 'trace-3',
      profileId: 'xyz',
      requestedAt: '2026-01-01T00:00:00Z',
      source: 'internal',
    };
    const scope: ScopeFilter = contextToScope(ctx);
    expect(scope).toHaveProperty('profileId');
  });
});
