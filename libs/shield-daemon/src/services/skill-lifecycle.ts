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
import { uninstallBrewBinaryWrappers } from './brew-wrapper';
import { writeFileViaBroker, mkdirViaBroker, rmViaBroker, isBrokerAvailable } from './broker-bridge';

// ─── Sudo helpers ────────────────────────────────────────────────────────────

/**
 * Create a directory, falling back to broker on EACCES, then sudo as last resort.
 */
export async function sudoMkdir(dir: string, agentUsername: string): Promise<void> {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      try {
        if (await isBrokerAvailable()) {
          await mkdirViaBroker(dir);
          return;
        }
      } catch { /* broker failed, fall through to sudo */ }
      execSync(`sudo -H -u ${agentUsername} /bin/mkdir -p "${dir}"`, { cwd: '/', stdio: 'pipe' });
    } else {
      throw err;
    }
  }
}

/**
 * Write a file, falling back to broker on EACCES, then sudo tee as last resort.
 */
export async function sudoWriteFile(filePath: string, content: string, agentUsername: string, mode?: number): Promise<void> {
  try {
    fs.writeFileSync(filePath, content, { mode });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      try {
        if (await isBrokerAvailable()) {
          await writeFileViaBroker(filePath, content, { mode });
          return;
        }
      } catch { /* broker failed, fall through to sudo */ }
      execSync(
        `sudo -H -u ${agentUsername} tee "${filePath}" > /dev/null`,
        { input: content, cwd: '/', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      if (mode) {
        try {
          execSync(`sudo -H -u ${agentUsername} chmod ${mode.toString(8)} "${filePath}"`, { cwd: '/', stdio: 'pipe' });
        } catch { /* best-effort */ }
      }
    } else {
      throw err;
    }
  }
}

/**
 * Remove a file or directory, falling back to broker on EACCES, then sudo as last resort.
 */
export async function sudoRm(targetPath: string, agentUsername: string): Promise<void> {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      try {
        if (await isBrokerAvailable()) {
          await rmViaBroker(targetPath);
          return;
        }
      } catch { /* broker failed, fall through to sudo */ }
      execSync(`sudo -H -u ${agentUsername} /bin/rm -rf "${targetPath}"`, { cwd: '/', stdio: 'pipe' });
    } else {
      throw err;
    }
  }
}

// ─── Skill Wrapper ───────────────────────────────────────────────────────────

/**
 * Create a bash wrapper in $AGENT_HOME/bin/<skill-name> that invokes the skill through policy.
 */
export async function createSkillWrapper(name: string, binDir: string): Promise<void> {
  const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
  const agentUsername = path.basename(agentHome);

  await sudoMkdir(binDir, agentUsername);

  const wrapperPath = path.join(binDir, name);
  const wrapperContent = `#!/bin/bash
# ${name} skill wrapper - policy-enforced execution
# Ensure accessible working directory
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi
exec /opt/agenshield/bin/shield-client skill run "${name}" "$@"
`;

  await sudoWriteFile(wrapperPath, wrapperContent, agentUsername, 0o755);

  const socketGroup = process.env['AGENSHIELD_SOCKET_GROUP'] || 'ash_default';
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

/**
 * Remove brew binary wrappers owned by a skill.
 * If the skill was the sole owner, removes the wrapper and original binary.
 * If shared, updates the wrapper to the next owner.
 */
export async function removeBrewBinaryWrappers(name: string): Promise<void> {
  const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
  const agentUsername = path.basename(agentHome);

  try {
    const result = await uninstallBrewBinaryWrappers({
      slug: name,
      agentHome,
      agentUsername,
      onLog: (msg) => console.log(`[skill-lifecycle] ${msg}`),
    });

    if (result.removed.length > 0) {
      console.log(`[skill-lifecycle] Removed brew wrappers for ${name}: ${result.removed.join(', ')}`);
    }
    if (result.kept.length > 0) {
      console.log(`[skill-lifecycle] Kept shared brew wrappers for ${name}: ${result.kept.join(', ')}`);
    }
    if (result.errors.length > 0) {
      console.warn(`[skill-lifecycle] Brew wrapper removal errors for ${name}: ${result.errors.join('; ')}`);
    }
  } catch (err) {
    console.warn(`[skill-lifecycle] Failed to remove brew wrappers for ${name}: ${(err as Error).message}`);
  }
}
