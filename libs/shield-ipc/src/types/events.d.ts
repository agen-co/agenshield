/**
 * SSE Event types for real-time communication
 */
export type EventType = 'security:status' | 'security:warning' | 'security:critical' | 'process:started' | 'process:stopped' | 'api:request' | 'broker:request' | 'broker:response' | 'config:changed' | 'heartbeat';
/**
 * Base event structure
 */
export interface DaemonEvent<T = unknown> {
    type: EventType;
    timestamp: string;
    data: T;
}
/**
 * Security status event data
 */
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
/**
 * Security warning event data
 */
export interface SecurityWarningEventData {
    message: string;
}
/**
 * Security critical event data
 */
export interface SecurityCriticalEventData {
    message: string;
}
/**
 * API request event data
 */
export interface ApiRequestEventData {
    method: string;
    path: string;
    statusCode: number;
    duration: number;
}
/**
 * Broker request event data
 */
export interface BrokerRequestEventData {
    operation: string;
    args: unknown;
}
/**
 * Broker response event data
 */
export interface BrokerResponseEventData {
    operation: string;
    success: boolean;
    duration: number;
}
/**
 * Heartbeat event data
 */
export interface HeartbeatEventData {
    connected?: boolean;
    ping?: boolean;
    message?: string;
    filter?: string;
}
/**
 * Typed event definitions
 */
export type SecurityStatusEvent = DaemonEvent<SecurityStatusEventData>;
export type SecurityWarningEvent = DaemonEvent<SecurityWarningEventData>;
export type SecurityCriticalEvent = DaemonEvent<SecurityCriticalEventData>;
export type ApiRequestEvent = DaemonEvent<ApiRequestEventData>;
export type BrokerRequestEvent = DaemonEvent<BrokerRequestEventData>;
export type BrokerResponseEvent = DaemonEvent<BrokerResponseEventData>;
export type HeartbeatEvent = DaemonEvent<HeartbeatEventData>;
//# sourceMappingURL=events.d.ts.map