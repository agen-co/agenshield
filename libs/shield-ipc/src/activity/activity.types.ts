/**
 * Activity event domain types
 *
 * Audit log of all security-relevant events (policy checks, skill installs, etc.)
 */

export interface ActivityEvent {
  id: number;
  targetId?: string;
  type: string;
  timestamp: string;
  data: unknown;
  createdAt: string;
}
