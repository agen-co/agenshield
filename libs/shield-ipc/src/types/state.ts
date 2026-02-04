/**
 * System state types
 *
 * Types for tracking AgenShield system state in state.json
 */

/**
 * Daemon state information
 */
export interface DaemonState {
  /** Whether daemon is running */
  running: boolean;
  /** Process ID if running */
  pid?: number;
  /** When daemon was started */
  startedAt?: string;
  /** Port daemon is listening on */
  port: number;
}

/**
 * User state information
 */
export interface UserState {
  /** Username */
  username: string;
  /** User ID */
  uid: number;
  /** User type */
  type: 'agent' | 'broker';
  /** When user was created */
  createdAt: string;
  /** Home directory */
  homeDir: string;
}

/**
 * Group state information
 */
export interface GroupState {
  /** Group name */
  name: string;
  /** Group ID */
  gid: number;
  /** Group type */
  type: 'socket' | 'workspace';
}

/**
 * AgentLink state information
 */
export interface AgentLinkState {
  /** Whether user is authenticated */
  authenticated: boolean;
  /** Last authentication time */
  lastAuthAt?: string;
  /** List of connected integration IDs */
  connectedIntegrations: string[];
}

/**
 * Installation state information
 */
export interface InstallationState {
  /** Installation preset used */
  preset: string;
  /** Base name for users/groups */
  baseName: string;
  /** Optional prefix */
  prefix?: string;
  /** Installed wrapper paths */
  wrappers: string[];
  /** Whether seatbelt is installed */
  seatbeltInstalled: boolean;
}

/**
 * Passcode protection state information
 */
export interface PasscodeProtectionState {
  /** Whether passcode protection is enabled */
  enabled: boolean;
  /** Number of failed authentication attempts */
  failedAttempts?: number;
  /** ISO timestamp until which authentication is locked out */
  lockedUntil?: string;
}

/**
 * Complete system state
 */
export interface SystemState {
  /** State schema version */
  version: string;
  /** When AgenShield was installed */
  installedAt: string;
  /** Daemon state */
  daemon: DaemonState;
  /** Created users */
  users: UserState[];
  /** Created groups */
  groups: GroupState[];
  /** AgentLink state */
  agentlink: AgentLinkState;
  /** Installation state */
  installation: InstallationState;
  /** Passcode protection state */
  passcodeProtection?: PasscodeProtectionState;
}
