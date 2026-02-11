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
} from '@agenshield/ipc';

// Re-export for internal daemon consumers that import from this file
export type { EventType, EventRegistry } from '@agenshield/ipc';

export interface DaemonEvent {
  type: EventType;
  timestamp: string;
  data: unknown;
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
  broadcast(type: EventType, data: unknown): void {
    const event: DaemonEvent = {
      type,
      timestamp: new Date().toISOString(),
      data,
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
 * Typed EventBus singleton — new event system.
 * Runs alongside legacy daemonEvents for SSE compatibility.
 */
export const eventBus = new EventBus({ maxListeners: 100 });

/**
 * Typed broadcast: emits to both the new EventBus and the legacy SSE emitter.
 */
function broadcast<T extends EventType>(type: T, data: EventRegistry[T]): void {
  eventBus.emit(type, data);
  daemonEvents.broadcast(type, data as unknown);
}

// ===== Typed event helpers =====

export function emitSecurityStatus(status: SecurityStatusPayload): void {
  broadcast('security:status', status);
}

export function emitSecurityWarning(warning: string): void {
  broadcast('security:warning', { message: warning });
}

export function emitSecurityCritical(issue: string): void {
  broadcast('security:critical', { message: issue });
}

export function emitApiRequest(
  method: string,
  path: string,
  statusCode: number,
  duration: number,
  requestBody?: unknown,
  responseBody?: unknown,
): void {
  const payload: ApiRequestPayload = {
    method,
    path,
    statusCode,
    duration,
    ...(requestBody !== undefined && { requestBody }),
    ...(responseBody !== undefined && { responseBody }),
  };
  broadcast('api:request', payload);
}

export function emitApiOutbound(data: ApiOutboundPayload): void {
  broadcast('api:outbound', data);
}

export function emitBrokerRequest(operation: string, args: unknown): void {
  broadcast('broker:request', { operation, args });
}

export function emitBrokerResponse(operation: string, success: boolean, duration: number): void {
  broadcast('broker:response', { operation, success, duration });
}

export function emitSkillQuarantined(skillName: string, reason: string): void {
  broadcast('skills:quarantined', { name: skillName, reason });
}

export function emitSkillUntrustedDetected(name: string, reason: string): void {
  broadcast('skills:untrusted_detected', { name, reason });
}

export function emitSkillApproved(skillName: string): void {
  broadcast('skills:approved', { name: skillName });
}

export function emitExecMonitored(event: ExecMonitoredPayload): void {
  broadcast('exec:monitored', event);
}

export function emitExecDenied(command: string, reason: string): void {
  broadcast('exec:denied', { command, reason });
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

export function emitSkillAnalyzed(name: string, analysis: unknown): void {
  broadcast('skills:analyzed', { name, analysis });
}

export function emitSkillAnalysisFailed(name: string, error: string): void {
  broadcast('skills:analysis_failed', { name, error });
}

export function emitSkillUninstalled(skillName: string): void {
  broadcast('skills:uninstalled', { name: skillName });
}

export function emitSkillInstallProgress(skillName: string, step: string, message: string): void {
  broadcast('skills:install_progress', { name: skillName, step, message });
}

export function emitESExecEvent(event: ESExecPayload): void {
  broadcast('es:exec', event);
}

export function emitInterceptorEvent(event: InterceptorEventPayload): void {
  broadcast('interceptor:event', event);
}

export function emitDaemonStatus(status: DaemonStatus): void {
  broadcast('daemon:status', status);
}

/**
 * Generic typed event emitter
 */
export function emitEvent<T extends EventType>(type: T, data: EventRegistry[T]): void {
  broadcast(type, data);
}

// ===== Process lifecycle event helpers =====

export type ProcessName = 'broker' | 'gateway' | 'daemon';

export function emitProcessStarted(processName: ProcessName, data: { pid?: number }): void {
  const payload: ProcessEventPayload = {
    process: processName,
    action: 'started',
    ...data,
  };
  broadcast(`process:${processName}_started` as EventType, payload);
}

export function emitProcessStopped(processName: ProcessName, data: { pid?: number; lastExitStatus?: number }): void {
  const payload: ProcessEventPayload = {
    process: processName,
    action: 'stopped',
    ...data,
  };
  broadcast(`process:${processName}_stopped` as EventType, payload);
}

export function emitProcessRestarted(processName: ProcessName, data: { pid?: number; previousPid?: number; lastExitStatus?: number }): void {
  const payload: ProcessEventPayload = {
    process: processName,
    action: 'restarted',
    ...data,
  };
  broadcast(`process:${processName}_restarted` as EventType, payload);
}
