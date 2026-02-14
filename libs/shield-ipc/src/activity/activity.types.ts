/**
 * Activity event domain types
 *
 * Audit log of all security-relevant events (policy checks, skill installs, etc.)
 */

export interface ActivityEvent {
  id: number;
  profileId?: string;
  type: string;
  timestamp: string;
  data: unknown;
  createdAt: string;
}
