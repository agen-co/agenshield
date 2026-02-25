/**
 * Install service types
 */

export interface InstallParams {
  /** Existing local skill ID (must already exist in DB from download/upload) */
  skillId?: string;
  /** Skill slug for local DB lookup */
  slug?: string;
  /** Remote skill ID for local DB lookup (backward compat — will NOT trigger remote download) */
  remoteId?: string;
  /** Version string to install (defaults to latest) */
  version?: string;
  /** Profile/target scope (null = global) */
  profileId?: string;
  /** Auto-update configuration */
  autoUpdate?: boolean;
}
