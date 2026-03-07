/**
 * Barrel export coverage — imports from @agenshield/ipc to cover
 * named re-exports in index.ts and events/index.ts.
 */
import {
  // Config schemas (covers index.ts lines 16-25)
  DaemonConfigSchema,
  PolicyConfigSchema,
  PolicyTierSchema,
  VaultConfigSchema,
  ShieldConfigSchema,
  UserDefinitionSchema,
  GroupDefinitionSchema,
  UserConfigSchema,
  PathsConfigSchema,
  InstallationConfigSchema,

  // Ops schemas (covers index.ts lines 30-42)
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

  // Policy schemas (covers index.ts lines 47-53)
  PolicyRuleSchema,
  FsConstraintsSchema,
  NetworkConstraintsSchema,
  EnvInjectionRuleSchema,
  PolicyConfigurationSchema,
  PolicyEvaluationResultSchema,
  ChannelRestrictionSchema,

  // AgenCo schemas (covers index.ts lines 58-76)
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

  // State schemas (covers index.ts lines 81-88)
  DaemonStateSchema,
  UserStateSchema,
  GroupStateSchema,
  AgenCoStateSchema,
  InstallationStateSchema,
  PasscodeProtectionStateSchema,
  SetupStateSchema,
  SystemStateSchema,

  // Vault schemas (covers index.ts lines 93-94)
  AgenCoSecretsSchema,
  VaultContentsSchema,

  // Auth schemas (covers index.ts lines 99-104)
  AuthStatusResponseSchema,
  SudoLoginRequestSchema,
  SudoLoginResponseSchema,
  RefreshResponseSchema,
  AuthConfigSchema,
  PasscodeDataSchema,

  // Event registry (covers events/index.ts lines 14-15)
  registerEventTypes,
  getRegisteredEventTypes,

  // Event types (covers events/index.ts domain re-exports)
  CORE_EVENT_TYPES,
  SECURITY_EVENT_TYPES,
  API_EVENT_TYPES,
  WRAPPER_EVENT_TYPES,
  SKILL_EVENT_TYPES,
  EXEC_EVENT_TYPES,
  AGENCO_EVENT_TYPES,
  PROCESS_EVENT_TYPES,
  ALERT_EVENT_TYPES,
  SETUP_EVENT_TYPES,
  TRACE_EVENT_TYPES,
  RESOURCE_EVENT_TYPES,
  METRICS_EVENT_TYPES,
  TARGET_EVENT_TYPES,
  ENFORCEMENT_EVENT_TYPES,
  ENROLLMENT_EVENT_TYPES,
  WORKSPACE_SKILL_EVENT_TYPES,
  WORKSPACE_EVENT_TYPES,
  AUTO_SHIELD_EVENT_TYPES,
} from '@agenshield/ipc';

describe('schema barrel exports', () => {
  it('config schemas are defined', () => {
    expect(DaemonConfigSchema).toBeDefined();
    expect(PolicyConfigSchema).toBeDefined();
    expect(PolicyTierSchema).toBeDefined();
    expect(VaultConfigSchema).toBeDefined();
    expect(ShieldConfigSchema).toBeDefined();
    expect(UserDefinitionSchema).toBeDefined();
    expect(GroupDefinitionSchema).toBeDefined();
    expect(UserConfigSchema).toBeDefined();
    expect(PathsConfigSchema).toBeDefined();
    expect(InstallationConfigSchema).toBeDefined();
  });

  it('ops schemas are defined', () => {
    expect(OperationTypeSchema).toBeDefined();
    expect(HttpRequestParamsSchema).toBeDefined();
    expect(FileReadParamsSchema).toBeDefined();
    expect(FileWriteParamsSchema).toBeDefined();
    expect(FileListParamsSchema).toBeDefined();
    expect(ExecParamsSchema).toBeDefined();
    expect(OpenUrlParamsSchema).toBeDefined();
    expect(SecretInjectParamsSchema).toBeDefined();
    expect(PingParamsSchema).toBeDefined();
    expect(PolicyCheckParamsSchema).toBeDefined();
    expect(BrokerRequestSchema).toBeDefined();
    expect(BrokerErrorSchema).toBeDefined();
    expect(BrokerResponseSchema).toBeDefined();
  });

  it('policy schemas are defined', () => {
    expect(PolicyRuleSchema).toBeDefined();
    expect(FsConstraintsSchema).toBeDefined();
    expect(NetworkConstraintsSchema).toBeDefined();
    expect(EnvInjectionRuleSchema).toBeDefined();
    expect(PolicyConfigurationSchema).toBeDefined();
    expect(PolicyEvaluationResultSchema).toBeDefined();
    expect(ChannelRestrictionSchema).toBeDefined();
  });

  it('agenco schemas are defined', () => {
    expect(AgenCoAuthStartRequestSchema).toBeDefined();
    expect(AgenCoAuthStartResponseSchema).toBeDefined();
    expect(AgenCoAuthCallbackRequestSchema).toBeDefined();
    expect(AgenCoAuthCallbackResponseSchema).toBeDefined();
    expect(AgenCoAuthStatusResponseSchema).toBeDefined();
    expect(AgenCoToolRunRequestSchema).toBeDefined();
    expect(AgenCoToolRunResponseSchema).toBeDefined();
    expect(AgenCoToolListRequestSchema).toBeDefined();
    expect(AgenCoToolSchema).toBeDefined();
    expect(AgenCoToolListResponseSchema).toBeDefined();
    expect(AgenCoToolSearchRequestSchema).toBeDefined();
    expect(AgenCoIntegrationsListRequestSchema).toBeDefined();
    expect(AgenCoIntegrationActionSchema).toBeDefined();
    expect(AgenCoIntegrationSchema).toBeDefined();
    expect(AgenCoIntegrationsListResponseSchema).toBeDefined();
    expect(AgenCoConnectedIntegrationSchema).toBeDefined();
    expect(AgenCoConnectedIntegrationsResponseSchema).toBeDefined();
    expect(AgenCoConnectIntegrationRequestSchema).toBeDefined();
    expect(AgenCoConnectIntegrationResponseSchema).toBeDefined();
  });

  it('state schemas are defined', () => {
    expect(DaemonStateSchema).toBeDefined();
    expect(UserStateSchema).toBeDefined();
    expect(GroupStateSchema).toBeDefined();
    expect(AgenCoStateSchema).toBeDefined();
    expect(InstallationStateSchema).toBeDefined();
    expect(PasscodeProtectionStateSchema).toBeDefined();
    expect(SetupStateSchema).toBeDefined();
    expect(SystemStateSchema).toBeDefined();
  });

  it('vault schemas are defined', () => {
    expect(AgenCoSecretsSchema).toBeDefined();
    expect(VaultContentsSchema).toBeDefined();
  });

  it('auth schemas are defined', () => {
    expect(AuthStatusResponseSchema).toBeDefined();
    expect(SudoLoginRequestSchema).toBeDefined();
    expect(SudoLoginResponseSchema).toBeDefined();
    expect(RefreshResponseSchema).toBeDefined();
    expect(AuthConfigSchema).toBeDefined();
    expect(PasscodeDataSchema).toBeDefined();
  });
});

describe('event registry barrel exports', () => {
  it('registerEventTypes is a function', () => {
    expect(typeof registerEventTypes).toBe('function');
  });

  it('getRegisteredEventTypes returns all registered types', () => {
    const types = getRegisteredEventTypes();
    expect(types.length).toBeGreaterThan(0);
  });
});

describe('event type barrel exports', () => {
  it('all domain event types are defined arrays', () => {
    const allEventTypes = [
      CORE_EVENT_TYPES,
      SECURITY_EVENT_TYPES,
      API_EVENT_TYPES,
      WRAPPER_EVENT_TYPES,
      SKILL_EVENT_TYPES,
      EXEC_EVENT_TYPES,
      AGENCO_EVENT_TYPES,
      PROCESS_EVENT_TYPES,
      ALERT_EVENT_TYPES,
      SETUP_EVENT_TYPES,
      TRACE_EVENT_TYPES,
      RESOURCE_EVENT_TYPES,
      METRICS_EVENT_TYPES,
      TARGET_EVENT_TYPES,
      ENFORCEMENT_EVENT_TYPES,
      ENROLLMENT_EVENT_TYPES,
      WORKSPACE_SKILL_EVENT_TYPES,
      WORKSPACE_EVENT_TYPES,
      AUTO_SHIELD_EVENT_TYPES,
    ];
    for (const types of allEventTypes) {
      expect(types).toBeDefined();
      expect(Array.isArray(types)).toBe(true);
      expect(types.length).toBeGreaterThan(0);
    }
  });
});
