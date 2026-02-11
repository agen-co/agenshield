/**
 * Target domain types
 *
 * A Target represents a managed AI agent runtime (e.g. 'openclaw', 'cloudcode').
 * Targets scope policies, secrets, and config to specific runtimes.
 */

export interface Target {
  id: string;
  name: string;
  presetId?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TargetUser {
  targetId: string;
  userUsername: string;
  role: 'agent' | 'broker';
  createdAt: string;
}
