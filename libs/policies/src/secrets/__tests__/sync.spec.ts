/**
 * Secret sync — unit tests
 */

import type { PolicyConfig, VaultSecret, SyncedSecrets } from '@agenshield/ipc';
import { buildSyncPayload, syncSecrets } from '../sync';
import type { PushSecretsFn } from '../sync';
import { makePolicy } from '../../__tests__/helpers';

function makeSecret(overrides: Partial<VaultSecret> = {}): VaultSecret {
  return {
    id: 'secret-1',
    name: 'API_KEY',
    value: 'secret-value',
    policyIds: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildSyncPayload', () => {
  describe('empty secrets', () => {
    it('returns empty payload when no secrets', () => {
      const result = buildSyncPayload([], []);
      expect(result.globalSecrets).toEqual({});
      expect(result.policyBindings).toEqual([]);
      expect(result.version).toBe('1.0.0');
      expect(result.syncedAt).toBeTruthy();
    });

    it('returns empty payload even with policies present', () => {
      const policies = [makePolicy({ id: 'p1' })];
      const result = buildSyncPayload(policies, []);
      expect(result.globalSecrets).toEqual({});
      expect(result.policyBindings).toEqual([]);
    });
  });

  describe('global secrets', () => {
    it('includes secrets with empty policyIds as global', () => {
      const secrets = [makeSecret({ name: 'GLOBAL_TOKEN', value: 'tok-123', policyIds: [] })];
      const result = buildSyncPayload([], secrets);
      expect(result.globalSecrets).toEqual({ GLOBAL_TOKEN: 'tok-123' });
    });

    it('includes multiple global secrets', () => {
      const secrets = [
        makeSecret({ id: 's1', name: 'TOKEN_A', value: 'a', policyIds: [] }),
        makeSecret({ id: 's2', name: 'TOKEN_B', value: 'b', policyIds: [] }),
      ];
      const result = buildSyncPayload([], secrets);
      expect(result.globalSecrets).toEqual({ TOKEN_A: 'a', TOKEN_B: 'b' });
    });

    it('separates global from policy-linked', () => {
      const policies = [makePolicy({ id: 'p1', target: 'url', action: 'allow' })];
      const secrets = [
        makeSecret({ id: 's1', name: 'GLOBAL', value: 'g', policyIds: [] }),
        makeSecret({ id: 's2', name: 'LINKED', value: 'l', policyIds: ['p1'] }),
      ];
      const result = buildSyncPayload(policies, secrets);
      expect(result.globalSecrets).toEqual({ GLOBAL: 'g' });
      expect(result.policyBindings).toHaveLength(1);
    });
  });

  describe('policy-linked secrets', () => {
    it('includes url policies in bindings', () => {
      const policies = [makePolicy({ id: 'p1', target: 'url', action: 'allow', patterns: ['api.com'] })];
      const secrets = [makeSecret({ name: 'API_KEY', value: 'key', policyIds: ['p1'] })];
      const result = buildSyncPayload(policies, secrets);
      expect(result.policyBindings).toHaveLength(1);
      expect(result.policyBindings[0].policyId).toBe('p1');
      expect(result.policyBindings[0].target).toBe('url');
      expect(result.policyBindings[0].secrets).toEqual({ API_KEY: 'key' });
    });

    it('includes command policies in bindings', () => {
      const policies = [makePolicy({ id: 'p1', target: 'command', action: 'allow', patterns: ['git:*'] })];
      const secrets = [makeSecret({ name: 'GIT_TOKEN', value: 'tok', policyIds: ['p1'] })];
      const result = buildSyncPayload(policies, secrets);
      expect(result.policyBindings).toHaveLength(1);
      expect(result.policyBindings[0].target).toBe('command');
    });

    it('skips filesystem policies', () => {
      const policies = [makePolicy({ id: 'p1', target: 'filesystem', action: 'allow', patterns: ['/etc/**'] })];
      const secrets = [makeSecret({ name: 'FS_KEY', value: 'val', policyIds: ['p1'] })];
      const result = buildSyncPayload(policies, secrets);
      expect(result.policyBindings).toHaveLength(0);
    });

    it('skips disabled policies', () => {
      const policies = [makePolicy({ id: 'p1', target: 'url', action: 'allow', patterns: ['api.com'], enabled: false })];
      const secrets = [makeSecret({ name: 'KEY', value: 'val', policyIds: ['p1'] })];
      const result = buildSyncPayload(policies, secrets);
      expect(result.policyBindings).toHaveLength(0);
    });
  });

  describe('standalone scope', () => {
    it('skips standalone-scoped secrets', () => {
      const secrets = [makeSecret({ name: 'STANDALONE', value: 'val', policyIds: [], scope: 'standalone' })];
      const result = buildSyncPayload([], secrets);
      expect(result.globalSecrets).toEqual({});
    });

    it('still includes non-standalone secrets', () => {
      const secrets = [
        makeSecret({ id: 's1', name: 'STANDALONE', value: 'a', policyIds: [], scope: 'standalone' }),
        makeSecret({ id: 's2', name: 'GLOBAL', value: 'b', policyIds: [] }),
      ];
      const result = buildSyncPayload([], secrets);
      expect(result.globalSecrets).toEqual({ GLOBAL: 'b' });
    });
  });

  describe('missing policy ref', () => {
    it('warns when policy referenced by secret is not found', () => {
      const logger = { warn: jest.fn(), info: jest.fn() };
      const secrets = [makeSecret({ name: 'KEY', value: 'val', policyIds: ['nonexistent'] })];
      buildSyncPayload([], secrets, logger);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
    });

    it('skips binding when policy not found', () => {
      const secrets = [makeSecret({ name: 'KEY', value: 'val', policyIds: ['nonexistent'] })];
      const result = buildSyncPayload([], secrets);
      expect(result.policyBindings).toHaveLength(0);
    });
  });
});

describe('syncSecrets', () => {
  function mockStorage(secrets: VaultSecret[] = []) {
    return {
      secrets: { getAll: jest.fn(() => secrets) },
      for: jest.fn(() => ({
        secrets: { getAll: jest.fn(() => secrets) },
      })),
    } as any;
  }

  it('calls pushSecrets with payload', async () => {
    const push: PushSecretsFn = jest.fn();
    const storage = mockStorage([makeSecret({ name: 'TOK', value: 'v', policyIds: [] })]);
    const policies = [makePolicy({ id: 'p1' })];

    await syncSecrets(storage, policies, push);

    expect(push).toHaveBeenCalledTimes(1);
    const payload = (push as jest.Mock).mock.calls[0][0] as SyncedSecrets;
    expect(payload.globalSecrets).toEqual({ TOK: 'v' });
  });

  it('pushes empty payload when vault is locked', async () => {
    const push: PushSecretsFn = jest.fn();
    const storage = {
      secrets: { getAll: jest.fn(() => { throw new Error('StorageLockedError'); }) },
      for: jest.fn(),
    } as any;

    await syncSecrets(storage, [], push);

    expect(push).toHaveBeenCalledTimes(1);
    const payload = (push as jest.Mock).mock.calls[0][0] as SyncedSecrets;
    expect(payload.globalSecrets).toEqual({});
    expect(payload.policyBindings).toEqual([]);
  });

  it('calls logger.info on success', async () => {
    const push: PushSecretsFn = jest.fn();
    const logger = { warn: jest.fn(), info: jest.fn() };
    const storage = mockStorage([]);

    await syncSecrets(storage, [], push, logger);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('secret-sync'));
  });
});
