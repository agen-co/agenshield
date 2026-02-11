/**
 * AgenShield IPC Library
 *
 * Shared types, schemas, and constants for communication between
 * AgenShield daemon and clients (CLI, UI).
 *
 * @packageDocumentation
 */
export * from './types/index';
export { DaemonConfigSchema, PolicyConfigSchema, VaultConfigSchema, ShieldConfigSchema, UserDefinitionSchema, GroupDefinitionSchema, UserConfigSchema, PathsConfigSchema, InstallationConfigSchema, } from './schemas/config.schema';
export { OperationTypeSchema, HttpRequestParamsSchema, FileReadParamsSchema, FileWriteParamsSchema, FileListParamsSchema, ExecParamsSchema, OpenUrlParamsSchema, SecretInjectParamsSchema, PingParamsSchema, PolicyCheckParamsSchema, BrokerRequestSchema, BrokerErrorSchema, BrokerResponseSchema, } from './schemas/ops.schema';
export { PolicyRuleSchema, FsConstraintsSchema, NetworkConstraintsSchema, EnvInjectionRuleSchema, PolicyConfigurationSchema, PolicyEvaluationResultSchema, ChannelRestrictionSchema, } from './schemas/policy.schema';
export { AgenCoAuthStartRequestSchema, AgenCoAuthStartResponseSchema, AgenCoAuthCallbackRequestSchema, AgenCoAuthCallbackResponseSchema, AgenCoAuthStatusResponseSchema, AgenCoToolRunRequestSchema, AgenCoToolRunResponseSchema, AgenCoToolListRequestSchema, AgenCoToolSchema, AgenCoToolListResponseSchema, AgenCoToolSearchRequestSchema, AgenCoIntegrationsListRequestSchema, AgenCoIntegrationActionSchema, AgenCoIntegrationSchema, AgenCoIntegrationsListResponseSchema, AgenCoConnectedIntegrationSchema, AgenCoConnectedIntegrationsResponseSchema, AgenCoConnectIntegrationRequestSchema, AgenCoConnectIntegrationResponseSchema, } from './schemas/agenco.schema';
export { DaemonStateSchema, UserStateSchema, GroupStateSchema, AgenCoStateSchema, InstallationStateSchema, PasscodeProtectionStateSchema, SystemStateSchema, } from './schemas/state.schema';
export { AgenCoSecretsSchema, VaultContentsSchema, } from './schemas/vault.schema';
export { AuthStatusResponseSchema, UnlockRequestSchema, UnlockResponseSchema, LockRequestSchema, LockResponseSchema, SetupPasscodeRequestSchema, SetupPasscodeResponseSchema, ChangePasscodeRequestSchema, ChangePasscodeResponseSchema, SessionSchema, AuthConfigSchema, PasscodeDataSchema, } from './schemas/auth.schema';
export { OPENCLAW_PRESET, AGENCO_PRESET, POLICY_PRESETS } from './presets';
export type { PolicyPreset } from './presets';
export { COMMAND_CATALOG, searchCatalog } from './catalog';
export * from './constants';
export * from './version-features';
export * from './targets/index';
export * from './skills/index';
export * from './activity/index';
export * from './commands/index';
export * from './storage/index';
export * from './policy-graph/index';
//# sourceMappingURL=index.d.ts.map