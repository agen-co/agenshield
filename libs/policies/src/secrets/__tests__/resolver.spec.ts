/**
 * Secrets resolver — unit tests
 */

import { createSecretsResolver } from '../resolver';
import type { SecretsResolver } from '../../graph/effects';

describe('createSecretsResolver', () => {
  it('returns found secret value', () => {
    const repo = { getByName: jest.fn(() => ({ value: 'my-token-123' })) };
    const resolver = createSecretsResolver(repo);

    const result = resolver.getByName('API_KEY');

    expect(result).toEqual({ value: 'my-token-123' });
    expect(repo.getByName).toHaveBeenCalledWith('API_KEY');
  });

  it('returns null when not found', () => {
    const repo = { getByName: jest.fn(() => null) };
    const resolver = createSecretsResolver(repo);

    const result = resolver.getByName('MISSING');

    expect(result).toBeNull();
  });

  it('catches thrown errors and returns null', () => {
    const repo = { getByName: jest.fn(() => { throw new Error('Vault locked'); }) };
    const resolver = createSecretsResolver(repo);

    const result = resolver.getByName('LOCKED_SECRET');

    expect(result).toBeNull();
  });

  it('delegates to underlying repo', () => {
    const repo = { getByName: jest.fn(() => ({ value: 'v1' })) };
    const resolver = createSecretsResolver(repo);

    resolver.getByName('A');
    resolver.getByName('B');

    expect(repo.getByName).toHaveBeenCalledTimes(2);
    expect(repo.getByName).toHaveBeenCalledWith('A');
    expect(repo.getByName).toHaveBeenCalledWith('B');
  });

  it('satisfies SecretsResolver interface', () => {
    const repo = { getByName: jest.fn(() => null) };
    const resolver: SecretsResolver = createSecretsResolver(repo);

    expect(typeof resolver.getByName).toBe('function');
  });
});
