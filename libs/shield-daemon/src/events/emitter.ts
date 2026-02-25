/**
 * Event emitter for SSE broadcasting
 */

import { EventEmitter } from 'node:events';
import {
  EventBus,
  type EventType,
  type EventRegistry,
  type DaemonStatus,
  type SecurityStatusPayload,
  type SecurityLockedPayload,
  type ApiRequestPayload,
  type ApiOutboundPayload,
  type BrokerRequestPayload,
  type BrokerResponsePayload,
  type ExecMonitoredPayload,
  type ExecDeniedPayload,
  type InterceptorEventPayload,
  type ESExecPayload,
  type AgenCoAuthRequiredPayload,
  type AgenCoErrorPayload,
  type SkillInstallProgressPayload,
  type ProcessEventPayload,
  type ResourceWarningPayload,
  type ResourceLimitEnforcedPayload,
  type MetricsSnapshotPayload,
  type TargetStatusInfo,
} from '@agenshield/ipc';

// Re-export for internal daemon consumers that import from this file
export type { EventType, EventRegistry } from '@agenshield/ipc';

export interface DaemonEvent {
  type: EventType;
  timestamp: string;
  data: unknown;
  profileId?: string;
  source?: string;  // 'daemon' | 'system' | targetId (e.g. 'claude-code')
}

class DaemonEventEmitter extends EventEmitter {
  private static instance: DaemonEventEmitter;

  private constructor() {
    super();
    this.setMaxListeners(100); // Allow many SSE connections
  }

  static getInstance(): DaemonEventEmitter {
    if (!DaemonEventEmitter.instance) {
      DaemonEventEmitter.instance = new DaemonEventEmitter();
    }
    return DaemonEventEmitter.instance;
  }

  /**
   * Emit a typed event to all SSE subscribers
   */
  broadcast(type: EventType, data: unknown, profileId?: string, source?: string): void {
    const resolvedSource = source ?? deriveSource(type, data, profileId);
    const event: DaemonEvent = {
      type,
      timestamp: new Date().toISOString(),
      data,
      ...(profileId !== undefined && { profileId }),
      source: resolvedSource,
    };
    this.emit('event', event);
  }

  /**
   * Subscribe to all events
   */
  subscribe(callback: (event: DaemonEvent) => void): () => void {
    this.on('event', callback);
    return () => this.off('event', callback);
  }
}

export const daemonEvents = DaemonEventEmitter.getInstance();

/**
 * In-memory cache mapping profileId → presetId for source attribution.
 * Populated via {@link registerProfilePreset} when targets are shielded/loaded.
 */
const profilePresetCache = new Map<string, string>();

/**
 * Register a profileId → presetId mapping so interceptor events can be
 * attributed to the correct target source.
 */
export function registerProfilePreset(profileId: string, presetId: string): void {
  profilePresetCache.set(profileId, presetId);
}

/**
 * Derive a source label from the event type and data when not explicitly provided.
 */
function deriveSource(type: string, data: unknown, profileId?: string): string {
  const d = data as Record<string, unknown> | undefined;
  if (type.startsWith('interceptor:')) {
    if (profileId) return profilePresetCache.get(profileId) ?? profileId;
    return 'interceptor';
  }
  if (type.startsWith('setup:')) return (d?.targetId as string) ?? 'daemon';
  if (type.startsWith('process:broker')) return (d?.process as string) ?? 'system';
  if (type.startsWith('resource:')) return 'system';
  if (type.startsWith('metrics:')) return 'system';
  if (type.startsWith('targets:')) return 'daemon';
  if (type.startsWith('daemon:') || type.startsWith('config:') || type.startsWith('security:')) return 'daemon';
  if (type.startsWith('skills:')) return (d?.target as string) ?? 'daemon';
  if (type.startsWith('api:')) return 'daemon';
  return 'daemon';
}

/**
 * Typed EventBus singleton — new event system.
 * Runs alongside legacy daemonEvents for SSE compatibility.
 */
export const eventBus = new EventBus({ maxListeners: 100 });

/**
 * Typed broadcast: emits to both the new EventBus and the legacy SSE emitter.
 */
function broadcast<T extends EventType>(type: T, data: EventRegistry[T], profileId?: string, source?: string): void {
  eventBus.emit(type, data);
  daemonEvents.broadcast(type, data as unknown, profileId, source);
}

// ===== Typed event helpers =====

export function emitSecurityStatus(status: SecurityStatusPayload, profileId?: string): void {
  broadcast('security:status', status, profileId);
}

export function emitSecurityWarning(warning: string, profileId?: string): void {
  broadcast('security:warning', { message: warning }, profileId);
}

export function emitSecurityCritical(issue: string, profileId?: string): void {
  broadcast('security:critical', { message: issue }, profileId);
}

export function emitSecurityLocked(reason: SecurityLockedPayload['reason'], profileId?: string): void {
  broadcast('security:locked', { reason }, profileId);
}

export function emitApiRequest(
  method: string,
  path: string,
  statusCode: number,
  duration: number,
  requestBody?: unknown,
  responseBody?: unknown,
  profileId?: string,
): void {
  const payload: ApiRequestPayload = {
    method,
    path,
    statusCode,
    duration,
    ...(requestBody !== undefined && { requestBody }),
    ...(responseBody !== undefined && { responseBody }),
  };
  broadcast('api:request', payload, profileId);
}

export function emitApiOutbound(data: ApiOutboundPayload, profileId?: string): void {
  broadcast('api:outbound', data, profileId);
}

export function emitBrokerRequest(operation: string, args: unknown, profileId?: string): void {
  broadcast('broker:request', { operation, args }, profileId);
}

export function emitBrokerResponse(operation: string, success: boolean, duration: number, profileId?: string): void {
  broadcast('broker:response', { operation, success, duration }, profileId);
}

export function emitSkillQuarantined(skillName: string, reason: string, profileId?: string): void {
  broadcast('skills:quarantined', { name: skillName, reason }, profileId);
}

export function emitSkillUntrustedDetected(name: string, reason: string, profileId?: string): void {
  broadcast('skills:untrusted_detected', { name, reason }, profileId);
}

export function emitSkillApproved(skillName: string, profileId?: string): void {
  broadcast('skills:approved', { name: skillName }, profileId);
}

export function emitExecMonitored(event: ExecMonitoredPayload, profileId?: string): void {
  broadcast('exec:monitored', event, profileId);
}

export function emitExecDenied(command: string, reason: string, profileId?: string): void {
  broadcast('exec:denied', { command, reason }, profileId);
}

// ===== AgenCo event helpers =====

export function emitAgenCoAuthRequired(authUrl: string, integration?: string): void {
  const payload: AgenCoAuthRequiredPayload = { authUrl, ...(integration !== undefined && { integration }) };
  broadcast('agenco:auth_required', payload);
}

export function emitAgenCoAuthCompleted(): void {
  broadcast('agenco:auth_completed', {} as Record<string, never>);
}

export function emitAgenCoConnected(): void {
  broadcast('agenco:connected', {} as Record<string, never>);
}

export function emitAgenCoDisconnected(): void {
  broadcast('agenco:disconnected', {} as Record<string, never>);
}

export function emitAgenCoError(code: string, message: string): void {
  broadcast('agenco:error', { code, message });
}

export function emitSkillAnalyzed(name: string, analysis: unknown, profileId?: string): void {
  broadcast('skills:analyzed', { name, analysis }, profileId);
}

export function emitSkillAnalysisFailed(name: string, error: string, profileId?: string): void {
  broadcast('skills:analysis_failed', { name, error }, profileId);
}

export function emitSkillUninstalled(skillName: string, profileId?: string): void {
  broadcast('skills:uninstalled', { name: skillName }, profileId);
}

export function emitSkillInstallProgress(skillName: string, step: string, message: string, profileId?: string): void {
  broadcast('skills:install_progress', { name: skillName, step, message }, profileId);
}

export function emitESExecEvent(event: ESExecPayload, profileId?: string): void {
  broadcast('es:exec', event, profileId);
}

export function emitInterceptorEvent(event: InterceptorEventPayload, profileId?: string): void {
  broadcast('interceptor:event', event, profileId);
}

export function emitDaemonStatus(status: DaemonStatus, profileId?: string): void {
  broadcast('daemon:status', status, profileId);
}

/**
 * Generic typed event emitter
 */
export function emitEvent<T extends EventType>(type: T, data: EventRegistry[T], profileId?: string): void {
  broadcast(type, data, profileId);
}

// ===== Resource monitoring event helpers =====

export function emitResourceWarning(data: ResourceWarningPayload, profileId?: string): void {
  broadcast('resource:warning', data, profileId);
}

export function emitResourceLimitEnforced(data: ResourceLimitEnforcedPayload, profileId?: string): void {
  broadcast('resource:limit_enforced', data, profileId);
}

// ===== Process lifecycle event helpers =====

export type ProcessName = 'broker' | 'gateway' | 'daemon';

export function emitProcessStarted(processName: ProcessName, data: { pid?: number }, profileId?: string): void {
  const payload: ProcessEventPayload = {
    process: processName,
    action: 'started',
    ...data,
  };
  broadcast(`process:${processName}_started` as EventType, payload, profileId);
}

export function emitProcessStopped(processName: ProcessName, data: { pid?: number; lastExitStatus?: number }, profileId?: string): void {
  const payload: ProcessEventPayload = {
    process: processName,
    action: 'stopped',
    ...data,
  };
  broadcast(`process:${processName}_stopped` as EventType, payload, profileId);
}

export function emitProcessRestarted(processName: ProcessName, data: { pid?: number; previousPid?: number; lastExitStatus?: number }, profileId?: string): void {
  const payload: ProcessEventPayload = {
    process: processName,
    action: 'restarted',
    ...data,
  };
  broadcast(`process:${processName}_restarted` as EventType, payload, profileId);
}

// ===== Metrics event helpers =====

export function emitMetricsSnapshot(data: MetricsSnapshotPayload): void {
  broadcast('metrics:snapshot', data);
}

// ===== Target lifecycle event helpers =====

export function emitTargetStatus(targets: TargetStatusInfo[]): void {
  broadcast('targets:status', { targets });
}
