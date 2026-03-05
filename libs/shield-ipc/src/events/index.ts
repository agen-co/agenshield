/**
 * Typed event system — EventRegistry + EventBus.
 *
 * Importing this barrel triggers all domain augmentations, making
 * the full EventRegistry available to consumers.
 */

// Base registry + derived types + runtime registration
export {
  type EventRegistry,
  type EventType,
  type EventPayload,
  type ChannelName,
  registerEventTypes,
  getRegisteredEventTypes,
} from './event-registry';

// EventBus
export { EventBus, type EventBusOptions, type EventMeta } from './event-bus';

// Domain augmentations — side-effect imports trigger `declare module` merging
// and `registerEventTypes()` calls. Re-export payload types.
export {
  type HeartbeatPayload,
  type EventLoopPayload,
  type ConfigPoliciesUpdatedPayload,
  type SystemUpdateAvailablePayload,
  CORE_EVENT_TYPES,
} from './core.events';

export {
  type SecurityStatusPayload,
  type MessagePayload,
  type ConfigTamperedPayload,
  type SecurityLockedPayload,
  type AclFailurePayload,
  SECURITY_EVENT_TYPES,
} from './security.events';

export {
  type ApiRequestPayload,
  type ApiOutboundPayload,
  type BrokerRequestPayload,
  type BrokerResponsePayload,
  type OpenUrlRequestPayload,
  type OpenUrlApprovedPayload,
  type OpenUrlDeniedPayload,
  API_EVENT_TYPES,
} from './api.events';

export {
  WRAPPER_EVENT_TYPES,
} from './wrapper.events';

export {
  type SkillNamePayload,
  type SkillNameReasonPayload,
  type SkillAnalyzedPayload,
  type SkillInstallProgressPayload,
  SKILL_EVENT_TYPES,
} from './skill.events';

export {
  type ExecMonitoredPayload,
  type ExecDeniedPayload,
  type InterceptorEventPayload,
  type ESExecPayload,
  EXEC_EVENT_TYPES,
} from './exec.events';

export {
  type AgenCoAuthRequiredPayload,
  type AgenCoErrorPayload,
  type AgenCoToolExecutedPayload,
  AGENCO_EVENT_TYPES,
} from './agenco.events';

export {
  type ProcessEventPayload,
  PROCESS_EVENT_TYPES,
} from './process.events';

export {
  type AlertCreatedPayload,
  type AlertAcknowledgedPayload,
  ALERT_EVENT_TYPES,
} from './alert.events';

export {
  type SetupDetectionPayload,
  type SetupShieldProgressPayload,
  type SetupShieldCompletePayload,
  type SetupCompletePayload,
  type SetupErrorPayload,
  type SetupStateChangePayload,
  type SetupScanCompletePayload,
  type SetupLogPayload,
  type SetupShieldStepsPayload,
  type SetupStepLogPayload,
  SETUP_EVENT_TYPES,
} from './setup.events';

export {
  type TraceStartedPayload,
  type TraceCompletedPayload,
  type TraceAnomalyPayload,
  TRACE_EVENT_TYPES,
} from './trace.events';

export {
  type ResourceWarningPayload,
  type ResourceLimitEnforcedPayload,
  RESOURCE_EVENT_TYPES,
} from './resource.events';

export {
  type TargetMetricsEntry,
  type MetricsSnapshotPayload,
  type MetricsSpikePayload,
  METRICS_EVENT_TYPES,
} from './metrics.events';

export {
  type AgentProcessInfo,
  type TargetStatusInfo,
  type TargetStatusPayload,
  type TargetBinaryDriftedPayload,
  type TargetRePatchedPayload,
  TARGET_EVENT_TYPES,
} from './target.events';

export {
  type EnforcementProcessPayload,
  ENFORCEMENT_EVENT_TYPES,
} from './enforcement.events';

export {
  type EnrollmentPendingPayload,
  type EnrollmentCompletePayload,
  type EnrollmentFailedPayload,
  ENROLLMENT_EVENT_TYPES,
} from './enrollment.events';

export {
  type WorkspaceSkillDetectedPayload,
  type WorkspaceSkillApprovedPayload,
  type WorkspaceSkillDeniedPayload,
  type WorkspaceSkillRemovedPayload,
  type WorkspaceSkillTamperedPayload,
  type WorkspaceSkillCloudForcedPayload,
  WORKSPACE_SKILL_EVENT_TYPES,
} from './workspace-skill.events';

export {
  type WorkspacePathGrantedPayload,
  type WorkspacePathRevokedPayload,
  type WorkspaceSensitiveFilesProtectedPayload,
  WORKSPACE_EVENT_TYPES,
} from './workspace.events';
