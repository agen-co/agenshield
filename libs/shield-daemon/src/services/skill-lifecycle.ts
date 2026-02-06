/**
 * Skill Lifecycle Utilities
 *
 * Shared helpers for creating/removing skill wrappers and policies.
 * Used by both skills routes and marketplace routes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { PolicyConfig } from '@agenshield/ipc';
import { loadConfig, updateConfig } from '../config/index';

/**
 * Create a bash wrapper in $AGENT_HOME/bin/<skill-name> that invokes the skill through policy.
 */
export function createSkillWrapper(name: string, binDir: string): void {
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const wrapperPath = path.join(binDir, name);
  const wrapperContent = `#!/bin/bash
# ${name} skill wrapper - policy-enforced execution
# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi
exec /opt/agenshield/bin/shield-client skill run "${name}" "$@"
`;

  fs.writeFileSync(wrapperPath, wrapperContent, { mode: 0o755 });

  const socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'clawshield';
  try {
    execSync(`chown root:${socketGroup} "${wrapperPath}"`, { stdio: 'pipe' });
    execSync(`chmod 755 "${wrapperPath}"`, { stdio: 'pipe' });
  } catch {
    // May fail if not root — acceptable in development
  }
}

/**
 * Remove the skill wrapper from $AGENT_HOME/bin/<skill-name>.
 */
export function removeSkillWrapper(name: string, binDir: string): void {
  const wrapperPath = path.join(binDir, name);
  try {
    if (fs.existsSync(wrapperPath)) {
      fs.unlinkSync(wrapperPath);
    }
  } catch {
    // Best-effort removal
  }
}

/**
 * Add a PolicyConfig entry for the skill to the daemon config.
 */
export function addSkillPolicy(name: string): void {
  const config = loadConfig();
  const policyId = `skill-${name}`;

  if (config.policies.some((p) => p.id === policyId)) {
    return;
  }

  const policy: PolicyConfig = {
    id: policyId,
    name: `Policy for skill: ${name}`,
    action: 'allow',
    target: 'skill',
    patterns: [name],
    enabled: true,
  };

  updateConfig({
    policies: [...config.policies, policy],
  });
}

/**
 * Remove the PolicyConfig entry for a skill from the daemon config.
 */
export function removeSkillPolicy(name: string): void {
  const config = loadConfig();
  const policyId = `skill-${name}`;
  const filtered = config.policies.filter((p) => p.id !== policyId);

  if (filtered.length !== config.policies.length) {
    updateConfig({ policies: filtered });
  }
}
