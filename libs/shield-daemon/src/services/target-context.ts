/**
 * Target context resolution
 *
 * Resolves agent home, usernames, and socket group from profile storage
 * for a given preset/target ID. Falls back to env vars when storage is
 * unavailable (e.g. during early boot).
 *
 * Returns `null` when no profile exists and no `AGENSHIELD_AGENT_HOME`
 * env var is set — callers must handle the absence gracefully.
 */

import * as path from 'node:path';
import { getStorage } from '@agenshield/storage';
import { TargetContextNotFoundError } from '../errors';

export interface TargetContext {
  agentHome: string;
  agentUsername: string;
  brokerUsername: string;
  socketGroup: string;
  presetId?: string;
  skillsDir: string;
}

/**
 * Resolve the skills directory for a given agent home and preset.
 *
 * - Claude Code targets use `~/.claude/skills`
 * - OpenClaw / default targets use `~/.openclaw/workspace/skills`
 */
export function resolveSkillsDir(agentHome: string, presetId?: string): string {
  if (presetId === 'claude-code') {
    return path.join(agentHome, '.claude', 'skills');
  }
  return path.join(agentHome, '.openclaw', 'workspace', 'skills');
}

/**
 * Resolve target-specific paths from the profile in storage.
 *
 * @param presetOrTargetId - Preset ID (e.g. 'openclaw') or profile ID.
 *   When provided, finds the matching profile by id or presetId.
 *   Falls back to the first target profile if no ID given (single-target mode).
 * @returns Resolved context with agentHome, usernames, and socketGroup,
 *   or `null` if no profile is configured and no env var fallback is set.
 */
export function resolveTargetContext(presetOrTargetId?: string): TargetContext | null {
  try {
    const storage = getStorage();
    const profiles = storage.profiles.getAll();

    const profile = presetOrTargetId
      ? profiles.find(p => p.id === presetOrTargetId || p.presetId === presetOrTargetId)
      : profiles.find(p => p.type === 'target') ?? profiles[0];

    if (profile?.agentHomeDir && profile?.agentUsername) {
      const baseName = profile.agentUsername.replace(/^ash_/, '').replace(/_agent$/, '');
      return {
        agentHome: profile.agentHomeDir,
        agentUsername: profile.agentUsername,
        brokerUsername: profile.brokerUsername || `ash_${baseName}_broker`,
        socketGroup: `ash_${baseName}`,
        presetId: profile.presetId,
        skillsDir: resolveSkillsDir(profile.agentHomeDir, profile.presetId),
      };
    }
  } catch {
    // Storage not ready yet — fall through to env fallback
  }

  // Fallback: env var only — no hardcoded default
  const agentHome = process.env['AGENSHIELD_AGENT_HOME'];
  if (!agentHome) {
    return null;
  }

  const agentUsername = path.basename(agentHome);
  const baseName = agentUsername.replace(/^ash_/, '').replace(/_agent$/, '');
  return {
    agentHome,
    agentUsername,
    brokerUsername: `ash_${baseName}_broker`,
    socketGroup: `ash_${baseName}`,
    skillsDir: resolveSkillsDir(agentHome),
  };
}

/**
 * Like `resolveTargetContext()` but throws `TargetContextNotFoundError`
 * instead of returning null. Use in code paths that cannot proceed
 * without a target context (e.g. skill deployment, config writes).
 */
export function requireTargetContext(presetOrTargetId?: string): TargetContext {
  const ctx = resolveTargetContext(presetOrTargetId);
  if (!ctx) {
    throw new TargetContextNotFoundError();
  }
  return ctx;
}
