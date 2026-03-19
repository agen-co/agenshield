/**
 * Cloud types
 *
 * Shared type definitions for the cloud library.
 */

// ---------------------------------------------------------------------------
// Auth types
// ---------------------------------------------------------------------------

export interface Ed25519Keypair {
  publicKey: string;
  privateKey: string;
}

export interface CloudCredentials {
  agentId: string;
  privateKey: string;
  cloudUrl: string;
  companyName: string;
  registeredAt: string;
}

/**
 * Result of parsing an AgentSig authorization header.
 */
export interface AgentSigParts {
  agentId: string;
  timestamp: number;
  signature: Buffer;
}

// ---------------------------------------------------------------------------
// Device code flow types
// ---------------------------------------------------------------------------

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceCodePollResult {
  status: 'authorization_pending' | 'approved' | 'expired' | 'denied';
  enrollmentToken?: string;
  companyName?: string;
  error?: string;
}

export interface DeviceRegistrationResult {
  agentId: string;
  agentKey: string;
  companyName: string;
}

// ---------------------------------------------------------------------------
// MDM types
// ---------------------------------------------------------------------------

/**
 * MDM org-based enrollment configuration.
 */
export interface MdmOrgConfig {
  orgClientId: string;
  cloudUrl: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Cloud client types
// ---------------------------------------------------------------------------

export interface CloudCommand {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface CloudLogger {
  info(msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  warn(msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  debug(msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
}

export type CloudCommandHandler = (command: CloudCommand) => Promise<void>;

export interface CloudClientOptions {
  logger?: CloudLogger;
}

export type CloudConnectionState = 'disconnected' | 'connecting' | 'connected' | 'polling';

// ---------------------------------------------------------------------------
// Enrollment types
// ---------------------------------------------------------------------------

export type EnrollmentState =
  | { state: 'idle' }
  | { state: 'initiating' }
  | { state: 'pending_user_auth'; verificationUri: string; userCode: string; expiresAt: string }
  | { state: 'registering' }
  | { state: 'complete'; agentId: string; companyName: string }
  | { state: 'failed'; error: string; retryAt?: string };

export interface EnrollmentCallbacks {
  onPending(info: { verificationUri: string; userCode: string; expiresAt: string }): void;
  onComplete(info: { agentId: string; companyName: string }): void;
  onFailed(info: { error: string; retryAt?: string }): void;
  getAgentVersion(): string;
  onEnrolled(info: { agentId: string; companyName: string; cloudUrl: string }): Promise<void>;
}
