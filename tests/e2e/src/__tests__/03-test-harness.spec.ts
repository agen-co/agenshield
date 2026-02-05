/**
 * E2E Test: Sandbox Enforcement via Test Harness
 *
 * Runs the dummy OpenClaw test harness as the sandboxed agent user
 * and verifies that the sandbox correctly blocks/allows operations.
 */

import {
  getAgentUsername,
  runAsAgentUser,
  runShell,
} from '../setup/helpers';

describe('sandbox enforcement via test harness', () => {
  it('openclaw should be available globally', () => {
    const result = runShell('which openclaw');
    expect(result.exitCode).toBe(0);
  });

  it('openclaw --version should return dummy version', () => {
    const result = runShell('openclaw --version');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('1.0.0-dummy');
  });

  it('should run openclaw status as agent user', () => {
    const result = runAsAgentUser('openclaw status', { timeout: 15_000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Environment Status');
  });

  it('should detect agent user as sandbox user', () => {
    const result = runAsAgentUser('openclaw status', { timeout: 15_000 });
    expect(result.exitCode).toBe(0);
    // The agent user name includes "claw" pattern indicator
    expect(result.stdout).toContain('User:');
    expect(result.stdout).toContain(getAgentUsername());
  });

  it('should block network access from sandboxed agent', () => {
    const result = runAsAgentUser('openclaw run --test-network', { timeout: 30_000 });
    // Sandbox should prevent outbound HTTP
    expect(result.stdout).toContain('BLOCKED');
  });

  it('should block reading sensitive files from sandboxed agent', () => {
    const result = runAsAgentUser('openclaw run --test-file /etc/sudoers', {
      timeout: 15_000,
    });
    expect(result.stdout).toContain('BLOCKED');
  });

  it('should block exec of arbitrary commands from sandboxed agent', () => {
    const result = runAsAgentUser('openclaw run --test-exec "curl http://example.com"', {
      timeout: 15_000,
    });
    expect(result.stdout).toContain('BLOCKED');
  });

  it('should allow writing to agent home workspace', () => {
    const home = `/Users/${getAgentUsername()}`;
    const result = runAsAgentUser(
      `openclaw run --test-write ${home}/workspace/e2e-test.txt`,
      { timeout: 15_000 }
    );
    expect(result.stdout).toContain('SUCCESS');
  });

  it('should block writing outside agent home', () => {
    const result = runAsAgentUser(
      'openclaw run --test-write /tmp/e2e-escape-attempt.txt',
      { timeout: 15_000 }
    );
    expect(result.stdout).toContain('BLOCKED');
  });

  it('should show correct environment as agent user', () => {
    const result = runAsAgentUser('openclaw config --show', { timeout: 15_000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`User: ${getAgentUsername()}`);
  });
});
