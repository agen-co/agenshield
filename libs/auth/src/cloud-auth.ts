/**
 * Cloud authentication primitives
 *
 * Re-exports from @agenshield/cloud for backward compatibility.
 * Core implementation now lives in the @agenshield/cloud library.
 */

export {
  CLOUD_CONFIG,
  generateEd25519Keypair,
  createAgentSigHeader,
  parseAgentSigHeader,
  verifyAgentSig,
  saveCloudCredentials,
  loadCloudCredentials,
  isCloudEnrolled,
  initiateDeviceCode,
  pollDeviceCode,
  registerDevice,
} from '@agenshield/cloud';

export type {
  Ed25519Keypair,
  CloudCredentials,
  AgentSigParts,
  DeviceCodeResponse,
  DeviceCodePollResult,
  DeviceRegistrationResult,
} from '@agenshield/cloud';
