/**
 * E2E Enforcement Test: Setup Verification
 *
 * Verifies that agenshield setup created all required OS resources
 * and the daemon is running and healthy.
 */

import * as fs from 'node:fs';
import {
  getAgentUsername,
  getBrokerUsername,
  getSocketGroupName,
  getWorkspaceGroupName,
  getAgentHome,
  userExists,
  groupExists,
  daemonAPI,
  waitForDaemon,
} from '../setup/helpers';

describe('enforcement setup verification', () => {
  it('agent user exists', () => {
    expect(userExists(getAgentUsername())).toBe(true);
  });

  it('broker user exists', () => {
    expect(userExists(getBrokerUsername())).toBe(true);
  });

  it('socket group exists', () => {
    expect(groupExists(getSocketGroupName())).toBe(true);
  });

  it('workspace group exists', () => {
    expect(groupExists(getWorkspaceGroupName())).toBe(true);
  });

  it('agent home directory exists', () => {
    const home = getAgentHome();
    expect(fs.existsSync(home)).toBe(true);
    expect(fs.statSync(home).isDirectory()).toBe(true);
  });

  it('daemon is healthy', async () => {
    const healthy = await waitForDaemon(5200, 10_000);
    expect(healthy).toBe(true);
  });

  it('GET /api/health returns 200', async () => {
    const res = await daemonAPI('GET', '/health');
    expect(res.status).toBe(200);
  });

  it('config has empty policies initially', async () => {
    const res = await daemonAPI('GET', '/config');
    expect(res.status).toBe(200);
    const body = res.data as { success: boolean; data: { policies: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.data.policies).toEqual([]);
  });
});
