/**
 * Profile domain types
 *
 * A Profile represents a complete installation context — target app, agent user,
 * broker user, UIDs, home dirs. Replaces the previous targets+users+target_users model.
 *
 * - 'global' profile: system-wide defaults (future cloud-managed features)
 * - 'target' profile: a managed AI agent runtime (e.g. 'openclaw', 'cloudcode')
 */

export type ProfileType = 'global' | 'target';

export interface Profile {
  id: string;
  name: string;
  type: ProfileType;
  targetName?: string;
  presetId?: string;
  description?: string;
  agentUsername?: string;
  agentUid?: number;
  agentHomeDir?: string;
  brokerUsername?: string;
  brokerUid?: number;
  brokerHomeDir?: string;
  brokerToken?: string;
  createdAt: string;
  updatedAt: string;
}
