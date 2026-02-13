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
  CORE_EVENT_TYPES,
} from './core.events';

export {
  type SecurityStatusPayload,
  type MessagePayload,
  type ConfigTamperedPayload,
  type SecurityLockedPayload,
  SECURITY_EVENT_TYPES,
} from './security.events';

export {
  type ApiRequestPayload,
  type ApiOutboundPayload,
  type BrokerRequestPayload,
  type BrokerResponsePayload,
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
