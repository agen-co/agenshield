/**
 * Event emitter for SSE broadcasting
 */

import { EventEmitter } from 'node:events';

export type EventType =
  | 'security:status'
  | 'security:warning'
  | 'security:critical'
  | 'process:started'
  | 'process:stopped'
  | 'api:request'
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
  | 'skills:approved';

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
export function emitApiRequest(method: string, path: string, statusCode: number, duration: number): void {
  daemonEvents.broadcast('api:request', {
    method,
    path,
    statusCode,
    duration,
  });
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
 * Helper to emit skill approved events
 */
export function emitSkillApproved(skillName: string): void {
  daemonEvents.broadcast('skills:approved', { name: skillName });
}

/**
 * Generic event emitter for custom events
 */
export function emitEvent(type: EventType, data: unknown): void {
  daemonEvents.broadcast(type, data);
}
