/**
 * @agenshield/seatbelt — Runtime sandbox enforcement
 *
 * SBPL profile generation, environment filtering, sandbox config building.
 *
 * @packageDocumentation
 */

// Profile manager
export { ProfileManager } from './profile-manager';

// Environment filtering
export { BASE_ENV_ALLOWLIST, filterEnvByAllowlist } from './env-allowlist';

// Sandbox path extraction
export {
  extractConcreteDenyPaths,
  collectDenyPathsFromPolicies,
  collectAllowPathsForCommand,
} from './paths';

// Config builder
export { buildSandboxConfig } from './config-builder';
export type {
  SeatbeltDeps,
  BuildSandboxInput,
  SharedCapabilities,
} from './config-builder';

// Errors
export {
  SeatbeltError,
  ProfileGenerationError,
  SandboxConfigError,
} from './errors';
