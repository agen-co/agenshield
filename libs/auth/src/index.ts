/**
 * @agenshield/auth — JWT authentication library
 *
 * Centralizes all auth logic for the AgenShield system.
 *
 * @packageDocumentation
 */

// Errors
export {
  AuthError,
  TokenExpiredError,
  TokenInvalidError,
  InsufficientPermissionsError,
  SudoVerificationError,
  RateLimitError,
  CloudAuthError,
} from './errors';

// Types
export type {
  TokenRole,
  AdminPayload,
  BrokerPayload,
  JwtPayload,
  VerifyResult,
  JwtAuthHookOptions,
  SecretManagerOptions,
  SudoVerifyResult,
} from './types';

// Secret management
export {
  loadOrCreateSecret,
  getSecret,
  clearSecretCache,
  getSecretPath,
  generateSecret,
} from './secret';

// Signing
export {
  signAdminToken,
  signBrokerToken,
  getAdminTtlSeconds,
} from './sign';

// Verification
export {
  verifyToken,
  verifyTokenOrThrow,
} from './verify';

// Middleware
export {
  createJwtAuthHook,
  extractBearerToken,
} from './middleware';

// Roles
export {
  ROLE_HIERARCHY,
  PUBLIC_ROUTES,
  ADMIN_ONLY_ROUTES,
  hasMinimumRole,
  isPublicRoute,
  isAdminOnlyRoute,
} from './roles';

// Sudo verification
export {
  verifySudoPassword,
  getCurrentUsername,
  resetRateLimit,
} from './sudo-verify';

// Cloud authentication (Ed25519 agent keys, AgentSig headers, credentials)
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
} from './cloud-auth';
export type {
  Ed25519Keypair,
  CloudCredentials,
  AgentSigParts,
  DeviceCodeResponse,
  DeviceCodePollResult,
  DeviceRegistrationResult,
} from './cloud-auth';

// MDM org config
export {
  loadMdmConfig,
  saveMdmConfig,
  hasMdmConfig,
} from './mdm-config';
export type { MdmOrgConfig } from './mdm-config';
