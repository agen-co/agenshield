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
  // AgentLink schemas
  AgentLinkAuthStartRequestSchema,
  AgentLinkAuthStartResponseSchema,
  AgentLinkAuthCallbackRequestSchema,
  AgentLinkAuthCallbackResponseSchema,
  AgentLinkAuthStatusResponseSchema,
  AgentLinkToolRunRequestSchema,
  AgentLinkToolRunResponseSchema,
  AgentLinkToolListRequestSchema,
  AgentLinkToolSchema,
  AgentLinkToolListResponseSchema,
  AgentLinkToolSearchRequestSchema,
  AgentLinkIntegrationsListRequestSchema,
  AgentLinkIntegrationSchema,
  AgentLinkIntegrationsListResponseSchema,
  AgentLinkConnectedIntegrationSchema,
  AgentLinkConnectedIntegrationsResponseSchema,
  AgentLinkConnectIntegrationRequestSchema,
  AgentLinkConnectIntegrationResponseSchema,
} from './schemas/agentlink.schema';

export {
  // State schemas
  DaemonStateSchema,
  UserStateSchema,
  GroupStateSchema,
  AgentLinkStateSchema,
  InstallationStateSchema,
  PasscodeProtectionStateSchema,
  SystemStateSchema,
} from './schemas/state.schema';

export {
  // Vault schemas
  AgentLinkSecretsSchema,
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

// Constants
export * from './constants';
