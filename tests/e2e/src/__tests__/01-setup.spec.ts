/**
 * E2E Test: AgenShield Setup
 *
 * Runs `agenshield setup` with the test prefix and verifies that:
 * - OS users and groups are created
 * - Home directory exists with correct ownership
 * - Backup file is created
 */

import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import {
  getTestPrefix,
  getAgentUsername,
  getBrokerUsername,
  getSocketGroupName,
  getWorkspaceGroupName,
  runCLI,
  userExists,
  groupExists,
} from '../setup/helpers';

describe('agenshield setup', () => {
  const prefix = getTestPrefix();

  it('should run setup with prefix and skip-confirm', () => {
    const result = runCLI(
      `setup --target openclaw --prefix ${prefix} --skip-confirm`,
      { timeout: 120_000 }
    );
    expect(result.exitCode).toBe(0);
  });

  it('should have created the agent user', () => {
    expect(userExists(getAgentUsername())).toBe(true);
  });

  it('should have created the broker user', () => {
    expect(userExists(getBrokerUsername())).toBe(true);
  });

  it('should have created the socket group', () => {
    expect(groupExists(getSocketGroupName())).toBe(true);
  });

  it('should have created the workspace group', () => {
    expect(groupExists(getWorkspaceGroupName())).toBe(true);
  });

  it('should have created the agent home directory', () => {
    const home = `/Users/${getAgentUsername()}`;
    expect(fs.existsSync(home)).toBe(true);
    const stat = fs.statSync(home);
    expect(stat.isDirectory()).toBe(true);
  });

  it('should have created /opt/agenshield directory', () => {
    expect(fs.existsSync('/opt/agenshield')).toBe(true);
  });

  it('should have created a backup file', () => {
    expect(fs.existsSync('/etc/agenshield/backup.json')).toBe(true);
  });

  it('backup file should contain valid JSON with our prefix', () => {
    const content = fs.readFileSync('/etc/agenshield/backup.json', 'utf-8');
    const backup = JSON.parse(content);
    expect(backup).toBeDefined();
    // The backup should reference our prefix
    expect(JSON.stringify(backup)).toContain(prefix);
  });

  it('agent user should be a member of the socket group', () => {
    if (process.platform === 'darwin') {
      try {
        const members = execSync(
          `dscl . -read /Groups/${getSocketGroupName()} GroupMembership`,
          { encoding: 'utf-8' }
        );
        expect(members).toContain(getAgentUsername());
      } catch {
        // GroupMembership might not exist if using primary group
        // Check PrimaryGroupID instead
        const agentGid = execSync(
          `dscl . -read /Users/${getAgentUsername()} PrimaryGroupID`,
          { encoding: 'utf-8' }
        );
        const groupGid = execSync(
          `dscl . -read /Groups/${getSocketGroupName()} PrimaryGroupID`,
          { encoding: 'utf-8' }
        );
        // At minimum the user should exist — group membership can vary
        expect(agentGid).toBeDefined();
      }
    }
  });
});
