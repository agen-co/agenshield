/**
 * Setup types — detection and shielding flow
 */

/**
 * A detected target on the system that can be shielded
 */
export interface DetectedTarget {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Target type (e.g. 'claude', 'cursor', 'windsurf') */
  type: string;
  /** Version if detectable */
  version?: string;
  /** Path to the target binary */
  binaryPath?: string;
  /** Detection method used */
  method: string;
  /** Whether the target is already shielded */
  shielded: boolean;
  /** Whether the app process is currently running */
  isRunning?: boolean;
  /** Whether the app is running as privileged root user */
  runAsRoot?: boolean;
}

/**
 * An old AgenShield installation found on the system
 */
export interface OldInstallation {
  /** Version of the old installation */
  version: string;
  /** When it was installed */
  installedAt?: string;
  /** Components from the old installation */
  components: {
    /** macOS users created (ash_*) */
    users: string[];
    /** macOS groups created */
    groups: string[];
    /** Directories (e.g. /opt/agenshield) */
    directories: string[];
    /** LaunchDaemon plists (com.agenshield.*) */
    launchDaemons: string[];
  };
}

/**
 * Detection scan results
 */
export interface DetectionResult {
  /** Detected targets on the system */
  targets: DetectedTarget[];
  /** Old AgenShield installations found */
  oldInstallations: OldInstallation[];
}

/**
 * Progress update for shielding a target
 */
export interface ShieldProgress {
  /** Target being shielded */
  targetId: string;
  /** Current step name */
  step: string;
  /** Progress percentage (0-100) */
  progress: number;
  /** Human-readable message */
  message?: string;
}
