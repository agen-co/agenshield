/**
 * AgenShield IPC Library
 *
 * Shared types, schemas, and constants for communication between
 * AgenShield daemon and clients (CLI, UI).
 *
 * @packageDocumentation
 */

// Types (primary type definitions)
export * from './types/index';

// Schemas (Zod schemas - types are re-exported from types/ to avoid conflicts)
export {
  // Config schemas
  DaemonConfigSchema,
  PolicyConfigSchema,
  VaultConfigSchema,
  ShieldConfigSchema,
  UserDefinitionSchema,
  GroupDefinitionSchema,
  UserConfigSchema,
  PathsConfigSchema,
  InstallationConfigSchema,
} from './schemas/config.schema';

export {
  // Ops schemas
  OperationTypeSchema,
  HttpRequestParamsSchema,
  FileReadParamsSchema,
  FileWriteParamsSchema,
  FileListParamsSchema,
  ExecParamsSchema,
  OpenUrlParamsSchema,
  SecretInjectParamsSchema,
  PingParamsSchema,
  PolicyCheckParamsSchema,
  BrokerRequestSchema,
  BrokerErrorSchema,
  BrokerResponseSchema,
} from './schemas/ops.schema';

export {
  // Policy schemas
  PolicyRuleSchema,
  FsConstraintsSchema,
  NetworkConstraintsSchema,
  EnvInjectionRuleSchema,
  PolicyConfigurationSchema,
  PolicyEvaluationResultSchema,
  ChannelRestrictionSchema,
} from './schemas/policy.schema';

export {
  // AgenCo schemas
  AgenCoAuthStartRequestSchema,
  AgenCoAuthStartResponseSchema,
  AgenCoAuthCallbackRequestSchema,
  AgenCoAuthCallbackResponseSchema,
  AgenCoAuthStatusResponseSchema,
  AgenCoToolRunRequestSchema,
  AgenCoToolRunResponseSchema,
  AgenCoToolListRequestSchema,
  AgenCoToolSchema,
  AgenCoToolListResponseSchema,
  AgenCoToolSearchRequestSchema,
  AgenCoIntegrationsListRequestSchema,
  AgenCoIntegrationActionSchema,
  AgenCoIntegrationSchema,
  AgenCoIntegrationsListResponseSchema,
  AgenCoConnectedIntegrationSchema,
  AgenCoConnectedIntegrationsResponseSchema,
  AgenCoConnectIntegrationRequestSchema,
  AgenCoConnectIntegrationResponseSchema,
} from './schemas/agenco.schema';

export {
  // State schemas
  DaemonStateSchema,
  UserStateSchema,
  GroupStateSchema,
  AgenCoStateSchema,
  InstallationStateSchema,
  PasscodeProtectionStateSchema,
  SystemStateSchema,
} from './schemas/state.schema';

export {
  // Vault schemas
  AgenCoSecretsSchema,
  VaultContentsSchema,
} from './schemas/vault.schema';

export {
  // Auth schemas
  AuthStatusResponseSchema,
  UnlockRequestSchema,
  UnlockResponseSchema,
  LockRequestSchema,
  LockResponseSchema,
  SetupPasscodeRequestSchema,
  SetupPasscodeResponseSchema,
  ChangePasscodeRequestSchema,
  ChangePasscodeResponseSchema,
  SessionSchema,
  AuthConfigSchema,
  PasscodeDataSchema,
} from './schemas/auth.schema';

// Presets
export { OPENCLAW_PRESET, AGENCO_PRESET, POLICY_PRESETS } from './presets';
export type { PolicyPreset } from './presets';

// Catalog
export { COMMAND_CATALOG, searchCatalog } from './catalog';

// Constants
export * from './constants';

// Version-based feature flags
export * from './version-features';

// Domain types & schemas
export * from './targets/index';
export * from './skills/index';
export * from './activity/index';
export * from './commands/index';
export * from './storage/index';
export * from './policy-graph/index';
