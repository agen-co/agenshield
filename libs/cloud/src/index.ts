/**
 * @agenshield/cloud — Cloud transport, auth, and enrollment protocol
 *
 * Consolidates all cloud-related primitives into a standalone library:
 * Ed25519 auth, AgentSig headers, credential storage, device code flow,
 * MDM config, WebSocket/HTTP transport, and enrollment state machine.
 *
 * @packageDocumentation
 */

// Errors
export {
  CloudError,
  CloudConnectionError,
  CloudAuthError,
  CloudEnrollmentError,
  CloudCommandError,
} from './errors';

// Types
export type {
  Ed25519Keypair,
  CloudCredentials,
  AgentSigParts,
  DeviceCodeResponse,
  DeviceCodePollResult,
  DeviceRegistrationResult,
  MdmOrgConfig,
  CloudCommand,
  CloudLogger,
  CloudCommandHandler,
  CloudClientOptions,
  CloudConnectionState,
  EnrollmentState,
  EnrollmentCallbacks,
} from './types';

// Config
export { CLOUD_CONFIG } from './config';

// Auth primitives
export {
  AGENT_SIG_MAX_SKEW_MS,
  generateEd25519Keypair,
  createAgentSigHeader,
  parseAgentSigHeader,
  verifyAgentSig,
} from './auth';

// Credential storage
export {
  saveCloudCredentials,
  loadCloudCredentials,
  isCloudEnrolled,
} from './credentials';

// MDM config
export {
  loadMdmConfig,
  saveMdmConfig,
  hasMdmConfig,
} from './mdm-config';

// Device code flow
export {
  initiateDeviceCode,
  pollDeviceCode,
  registerDevice,
} from './device-code';

// Cloud client (transport layer)
export { CloudClient } from './cloud-client';

// Enrollment protocol
export { EnrollmentProtocol } from './enrollment';
