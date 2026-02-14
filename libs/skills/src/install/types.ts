/**
 * Install service types
 */

export interface InstallParams {
  /** Remote skill ID (downloads from marketplace) */
  remoteId?: string;
  /** OR: existing local skill ID */
  skillId?: string;
  /** Version string to install (defaults to latest) */
  version?: string;
  /** Profile scope */
  profileId?: string;
  /** Auto-update configuration */
  autoUpdate?: boolean;
}
