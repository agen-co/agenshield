/**
 * @deprecated Use the typed event system from `@agenshield/ipc` (`events/` module) instead.
 *
 * This file is kept for backward compatibility. The canonical event types,
 * payloads, and EventBus are now in `events/event-registry.ts` and
 * `events/event-bus.ts`, re-exported from the package root.
 */

/**
 * @deprecated Use `EventType` from `@agenshield/ipc` (events module) instead.
 */
export type LegacyEventType =
  | 'security:status'
  | 'security:warning'
  | 'security:critical'
  | 'process:started'
  | 'process:stopped'
  | 'api:request'
  | 'broker:request'
  | 'broker:response'
  | 'config:changed'
  | 'heartbeat';

/**
 * @deprecated Use typed payloads from `@agenshield/ipc` (events module) instead.
 */
export interface DaemonEvent<T = unknown> {
  type: string;
  timestamp: string;
  data: T;
}

/** @deprecated Use `SecurityStatusPayload` from events module */
export interface SecurityStatusEventData {
  runningAsRoot: boolean;
  currentUser: string;
  sandboxUserExists: boolean;
  isIsolated: boolean;
  guardedShellInstalled: boolean;
  exposedSecrets: string[];
  warnings: string[];
  critical: string[];
  recommendations: string[];
  level: 'secure' | 'partial' | 'unprotected' | 'critical';
}

/** @deprecated Use `MessagePayload` from events module */
export interface SecurityWarningEventData {
  message: string;
}

/** @deprecated Use `MessagePayload` from events module */
export interface SecurityCriticalEventData {
  message: string;
}

/** @deprecated Use `ApiRequestPayload` from events module */
export interface ApiRequestEventData {
  method: string;
  path: string;
  statusCode: number;
  duration: number;
}

/** @deprecated Use `BrokerRequestPayload` from events module */
export interface BrokerRequestEventData {
  operation: string;
  args: unknown;
}

/** @deprecated Use `BrokerResponsePayload` from events module */
export interface BrokerResponseEventData {
  operation: string;
  success: boolean;
  duration: number;
}

/** @deprecated Use `HeartbeatPayload` from events module */
export interface HeartbeatEventData {
  connected?: boolean;
  ping?: boolean;
  message?: string;
  filter?: string;
}

/** @deprecated */
export type SecurityStatusEvent = DaemonEvent<SecurityStatusEventData>;
/** @deprecated */
export type SecurityWarningEvent = DaemonEvent<SecurityWarningEventData>;
/** @deprecated */
export type SecurityCriticalEvent = DaemonEvent<SecurityCriticalEventData>;
/** @deprecated */
export type ApiRequestEvent = DaemonEvent<ApiRequestEventData>;
/** @deprecated */
export type BrokerRequestEvent = DaemonEvent<BrokerRequestEventData>;
/** @deprecated */
export type BrokerResponseEvent = DaemonEvent<BrokerResponseEventData>;
/** @deprecated */
export type HeartbeatEvent = DaemonEvent<HeartbeatEventData>;
