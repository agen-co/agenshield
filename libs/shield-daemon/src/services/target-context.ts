/**
 * Target context resolution
 *
 * Resolves agent home, usernames, and socket group from profile storage
 * for a given preset/target ID. Falls back to env vars / defaults when
 * storage is unavailable (e.g. during early boot).
 */

import * as path from 'node:path';
import { getStorage } from '@agenshield/storage';

export interface TargetContext {
  agentHome: string;
  agentUsername: string;
  brokerUsername: string;
  socketGroup: string;
}

/**
 * Resolve target-specific paths from the profile in storage.
 *
 * @param presetOrTargetId - Preset ID (e.g. 'openclaw') or profile ID.
 *   When provided, finds the matching profile by id or presetId.
 *   Falls back to the first target profile if no ID given (single-target mode).
 * @returns Resolved context with agentHome, usernames, and socketGroup.
 */
export function resolveTargetContext(presetOrTargetId?: string): TargetContext {
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
      };
    }
  } catch {
    // Storage not ready yet — fall through to env/defaults
  }

  // Fallback chain: env var -> default
  const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/Users/ash_default_agent';
  const agentUsername = path.basename(agentHome);
  const baseName = agentUsername.replace(/^ash_/, '').replace(/_agent$/, '');
  return {
    agentHome,
    agentUsername,
    brokerUsername: `ash_${baseName}_broker`,
    socketGroup: `ash_${baseName}`,
  };
}
