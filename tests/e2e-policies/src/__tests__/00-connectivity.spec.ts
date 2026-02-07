/**
 * E2E Test: Connectivity smoke tests
 *
 * Verifies the daemon is running and basic API/RPC endpoints work.
 */

import { daemonAPI, rpc, setPolicies, clearPolicies, makePolicy } from '../setup/helpers';

describe('daemon connectivity', () => {
  it('GET /api/health returns 200', async () => {
    const res = await daemonAPI('GET', '/health');
    expect(res.status).toBe(200);
  });

  it('RPC ping returns ok', async () => {
    const resp = await rpc('ping', {});
    expect(resp.result).toEqual({ status: 'ok' });
  });

  it('GET /api/config returns config with empty policies', async () => {
    const res = await daemonAPI('GET', '/config');
    expect(res.status).toBe(200);
    const body = res.data as { success: boolean; data: { policies: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.data.policies).toEqual([]);
  });

  it('PUT /api/config round-trips policies correctly', async () => {
    const policy = makePolicy({
      name: 'Test Round-Trip',
      action: 'deny',
      target: 'url',
      patterns: ['example.com'],
    });

    await setPolicies([policy]);

    const res = await daemonAPI('GET', '/config');
    const body = res.data as { success: boolean; data: { policies: Array<{ id: string; name: string }> } };
    expect(body.data.policies).toHaveLength(1);
    expect(body.data.policies[0].id).toBe(policy.id);
    expect(body.data.policies[0].name).toBe('Test Round-Trip');

    // Clean up
    await clearPolicies();
  });
});
