/**
 * Event emitter for SSE broadcasting
 */

import { EventEmitter } from 'node:events';
import type { DaemonStatus } from '@agenshield/ipc';

export type EventType =
  | 'security:status'
  | 'security:warning'
  | 'security:critical'
  | 'security:alert'
  | 'process:started'
  | 'process:stopped'
  | 'api:request'
  | 'api:outbound'
  | 'broker:request'
  | 'broker:response'
  | 'config:changed'
  | 'heartbeat'
  | 'wrappers:installed'
  | 'wrappers:uninstalled'
  | 'wrappers:updated'
  | 'wrappers:custom_added'
  | 'wrappers:custom_removed'
  | 'wrappers:synced'
  | 'wrappers:regenerated'
  | 'skills:quarantined'
  | 'skills:untrusted_detected'
  | 'skills:approved'
  | 'exec:monitored'
  | 'exec:denied'
  | 'agenco:connected'
  | 'agenco:disconnected'
  | 'agenco:auth_required'
  | 'agenco:auth_completed'
  | 'agenco:tool_executed'
  | 'agenco:error'
  | 'skills:analyzed'
  | 'skills:analysis_failed'
  | 'skills:install_started'
  | 'skills:install_progress'
  | 'skills:installed'
  | 'skills:install_failed'
  | 'skills:uninstalled'
  | 'interceptor:event'
  | 'daemon:status';

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
 * Helper to emit security status changes
 */
export function emitSecurityStatus(status: unknown): void {
  daemonEvents.broadcast('security:status', status);
}

/**
 * Helper to emit security warnings
 */
export function emitSecurityWarning(warning: string): void {
  daemonEvents.broadcast('security:warning', { message: warning });
}

/**
 * Helper to emit critical security issues
 */
export function emitSecurityCritical(issue: string): void {
  daemonEvents.broadcast('security:critical', { message: issue });
}

/**
 * Helper to emit API request events
 */
export function emitApiRequest(
  method: string,
  path: string,
  statusCode: number,
  duration: number,
  requestBody?: unknown,
  responseBody?: unknown,
): void {
  daemonEvents.broadcast('api:request', {
    method,
    path,
    statusCode,
    duration,
    ...(requestBody !== undefined && { requestBody }),
    ...(responseBody !== undefined && { responseBody }),
  });
}

/**
 * Helper to emit outbound API request events (external fetch calls)
 */
export function emitApiOutbound(data: {
  context: string;
  url: string;
  method: string;
  statusCode: number;
  duration: number;
  requestBody?: string;
  responseBody?: string;
  success: boolean;
}): void {
  daemonEvents.broadcast('api:outbound', data);
}

/**
 * Helper to emit broker request events
 */
export function emitBrokerRequest(operation: string, args: unknown): void {
  daemonEvents.broadcast('broker:request', { operation, args });
}

/**
 * Helper to emit broker response events
 */
export function emitBrokerResponse(operation: string, success: boolean, duration: number): void {
  daemonEvents.broadcast('broker:response', { operation, success, duration });
}

/**
 * Helper to emit skill quarantined events
 */
export function emitSkillQuarantined(skillName: string, reason: string): void {
  daemonEvents.broadcast('skills:quarantined', { name: skillName, reason });
}

/**
 * Helper to emit untrusted skill detection events
 */
export function emitSkillUntrustedDetected(name: string, reason: string): void {
  daemonEvents.broadcast('skills:untrusted_detected', { name, reason });
}

/**
 * Helper to emit skill approved events
 */
export function emitSkillApproved(skillName: string): void {
  daemonEvents.broadcast('skills:approved', { name: skillName });
}

/**
 * Helper to emit exec monitored events (every exec operation)
 */
export function emitExecMonitored(event: {
  command: string;
  args: string[];
  cwd?: string;
  exitCode: number;
  allowed: boolean;
  duration: number;
}): void {
  daemonEvents.broadcast('exec:monitored', event);
}

/**
 * Helper to emit exec denied events (blocked exec operations)
 */
export function emitExecDenied(command: string, reason: string): void {
  daemonEvents.broadcast('exec:denied', { command, reason });
}

// ===== AgenCo event helpers =====

/**
 * Helper to emit agenco auth required event
 */
export function emitAgenCoAuthRequired(authUrl: string, integration?: string): void {
  daemonEvents.broadcast('agenco:auth_required', { authUrl, integration });
}

/**
 * Helper to emit agenco auth completed event
 */
export function emitAgenCoAuthCompleted(): void {
  daemonEvents.broadcast('agenco:auth_completed', {});
}

/**
 * Helper to emit agenco connected event
 */
export function emitAgenCoConnected(): void {
  daemonEvents.broadcast('agenco:connected', {});
}

/**
 * Helper to emit agenco disconnected event
 */
export function emitAgenCoDisconnected(): void {
  daemonEvents.broadcast('agenco:disconnected', {});
}

/**
 * Helper to emit agenco error event
 */
export function emitAgenCoError(code: string, message: string): void {
  daemonEvents.broadcast('agenco:error', { code, message });
}

/**
 * Helper to emit skill analysis complete
 */
export function emitSkillAnalyzed(name: string, analysis: unknown): void {
  daemonEvents.broadcast('skills:analyzed', { name, analysis });
}

/**
 * Helper to emit skill analysis failed
 */
export function emitSkillAnalysisFailed(name: string, error: string): void {
  daemonEvents.broadcast('skills:analysis_failed', { name, error });
}

/**
 * Helper to emit skill uninstalled/disabled
 */
export function emitSkillUninstalled(skillName: string): void {
  daemonEvents.broadcast('skills:uninstalled', { name: skillName });
}

/**
 * Helper to emit skill install progress
 */
export function emitSkillInstallProgress(skillName: string, step: string, message: string): void {
  daemonEvents.broadcast('skills:install_progress', { name: skillName, step, message });
}

/**
 * Helper to emit interceptor events (from events_batch RPC)
 */
export function emitInterceptorEvent(event: {
  type: string;
  operation: string;
  target: string;
  timestamp: string;
  duration?: number;
  policyId?: string;
  error?: string;
}): void {
  daemonEvents.broadcast('interceptor:event', event);
}

/**
 * Helper to emit daemon status over SSE
 */
export function emitDaemonStatus(status: DaemonStatus): void {
  daemonEvents.broadcast('daemon:status', status);
}

/**
 * Generic event emitter for custom events
 */
export function emitEvent(type: EventType, data: unknown): void {
  daemonEvents.broadcast(type, data);
}
