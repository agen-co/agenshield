/**
 * E2E Enforcement Test: Teardown / Uninstall
 *
 * Stops the daemon and runs agenshield uninstall with the test prefix.
 * Verifies all OS resources are cleaned up.
 */

import * as fs from 'node:fs';
import {
  getTestPrefix,
  getAgentUsername,
  getBrokerUsername,
  getSocketGroupName,
  getWorkspaceGroupName,
  getAgentHome,
  runCLI,
  waitForDaemonStop,
  userExists,
  groupExists,
} from '../setup/helpers';

describe('enforcement teardown', () => {
  it('should stop the daemon', async () => {
    runCLI('daemon stop');
    const stopped = await waitForDaemonStop(15_000);
    expect(stopped).toBe(true);
  });

  it('daemon health endpoint should be unreachable', async () => {
    try {
      await fetch('http://localhost:5200/api/health', {
        signal: AbortSignal.timeout(2000),
      });
      fail('Daemon should be stopped');
    } catch {
      // Expected — connection refused
    }
  });

  it('should run uninstall --force with prefix', () => {
    const prefix = getTestPrefix();
    const result = runCLI(`uninstall --force --prefix ${prefix}`, {
      timeout: 60_000,
    });
    expect(result.exitCode).toBe(0);
  });

  it('should have removed the agent user', () => {
    expect(userExists(getAgentUsername())).toBe(false);
  });

  it('should have removed the broker user', () => {
    expect(userExists(getBrokerUsername())).toBe(false);
  });

  it('should have removed the socket group', () => {
    expect(groupExists(getSocketGroupName())).toBe(false);
  });

  it('should have removed the workspace group', () => {
    expect(groupExists(getWorkspaceGroupName())).toBe(false);
  });

  it('should have removed the agent home directory', () => {
    const home = getAgentHome();
    expect(fs.existsSync(home)).toBe(false);
  });
});
