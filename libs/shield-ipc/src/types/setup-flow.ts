/**
 * Setup flow types — daemon setup API (local/cloud enrollment)
 */

/** Setup modes supported by the daemon */
export type SetupMode = 'local' | 'cloud';

/** High-level setup flow state (distinct from SetupState in state.ts) */
export type SetupFlowState = 'not-configured' | 'pending' | 'complete';

/** Full setup status returned by GET /api/setup/status */
export interface SetupStatus {
  /** High-level setup state */
  state: SetupFlowState;
  /** Which mode was selected (undefined when not-configured) */
  mode?: SetupMode;
  /** Cloud URL (only for cloud mode) */
  cloudUrl?: string;
  /** ISO timestamp of when setup was completed */
  completedAt?: string;
}

/** Enrollment state exposed in status response */
export interface SetupEnrollmentState {
  state: string;
  verificationUri?: string;
  userCode?: string;
  expiresAt?: string;
  error?: string;
  agentId?: string;
  companyName?: string;
}

/** Response from GET /api/setup/status */
export interface SetupStatusResponse {
  setup: SetupStatus;
  enrollment: SetupEnrollmentState;
  cloudEnrolled: boolean;
  /** Device claim status (user login on managed devices) */
  claim?: {
    status: 'unclaimed' | 'pending' | 'claimed';
    user?: { id: string; name: string; email: string };
  };
}

/** Request body for POST /api/setup/cloud */
export interface SetupCloudRequest {
  cloudUrl: string;
}

/** Response from POST /api/setup/cloud */
export interface SetupCloudResponse {
  enrollment: SetupEnrollmentState;
}

/** Response from POST /api/setup/local */
export interface SetupLocalResponse {
  adminToken: string;
}
