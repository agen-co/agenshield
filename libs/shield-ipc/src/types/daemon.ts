/**
 * Daemon status types for AgenShield
 */

export interface OpenClawProcessStatus {
  running: boolean;
  pid?: number;
  lastExitStatus?: number;
}

export interface OpenClawServiceStatus {
  daemon: OpenClawProcessStatus;
  gateway: OpenClawProcessStatus;
  /** Detected OpenClaw version. null = detection failed, undefined = not yet populated */
  version?: string | null;
}

export interface DaemonStatus {
  /** Whether the daemon is currently running */
  running: boolean;
  /** Process ID of the daemon */
  pid?: number;
  /** Uptime in seconds */
  uptime?: number;
  /** Version of the daemon */
  version: string;
  /** Port the daemon is listening on */
  port: number;
  /** ISO timestamp when the daemon started */
  startedAt?: string;
  /** Agent username from state (type='agent') */
  agentUsername?: string;
  /** OpenClaw service status (daemon + gateway) */
  openclaw?: OpenClawServiceStatus;
  /** Whether the daemon is connected to AgenShield Cloud */
  cloudConnected?: boolean;
  /** Company name from AgenShield Cloud enrollment */
  cloudCompany?: string;
  /** Whether the device is enrolled in AgenShield Cloud (credentials exist) */
  cloudEnrolled?: boolean;
  /** Whether monitoring services (watchers, enforcer, etc.) are active */
  servicesActive?: boolean;
  /** Aggregate stats for menu bar / status display */
  stats?: {
    events: number;
    policies: number;
    skills: number;
    /** Count of quarantined workspace skills pending admin approval */
    pendingSkills: number;
  };
  /** Whether enrollment is pending user action */
  enrollmentPending?: boolean;
  /** Current enrollment state details (present during enrollment flow) */
  enrollment?: {
    state: string;
    verificationUri?: string;
    userCode?: string;
    expiresAt?: string;
    error?: string;
  };
  /** Device claim status (user login on managed devices) */
  claim?: {
    status: 'unclaimed' | 'pending' | 'claimed';
    user?: { id: string; name: string; email: string };
  };
  /** Auto-shield state (present when auto-shield has been triggered) */
  autoShield?: {
    state: 'pending' | 'in_progress' | 'complete' | 'failed';
    progress?: { current: number; total: number; currentTarget?: string };
    result?: { shielded: number; failed: number; skipped: number };
    error?: string;
  };
}
