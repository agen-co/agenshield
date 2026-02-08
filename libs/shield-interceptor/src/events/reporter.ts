/**
 * Event Reporter
 *
 * Reports interceptor events to the broker.
 */

import type { AsyncClient } from '../client/http-client.js';

export interface EventReporterOptions {
  client: AsyncClient;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface InterceptorEvent {
  type: 'intercept' | 'allow' | 'deny' | 'error';
  operation: string;
  target: string;
  timestamp: Date;
  duration?: number;
  policyId?: string;
  error?: string;
}

export class EventReporter {
  private client: AsyncClient;
  private logLevel: EventReporterOptions['logLevel'];
  private queue: InterceptorEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private failedFlushCount = 0;

  private static readonly MAX_QUEUE_SIZE = 500;
  private static readonly MAX_RETRIES = 3;

  private readonly levelPriority: Record<string, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(options: EventReporterOptions) {
    this.client = options.client;
    this.logLevel = options.logLevel;

    // Start periodic flush (unref so it doesn't keep Node alive on exit)
    this.flushInterval = setInterval(() => this.flush(), 5000);
    this.flushInterval.unref();
  }

  /**
   * Report an event
   */
  report(event: InterceptorEvent): void {
    this.queue.push(event);

    // Drop oldest events if queue exceeds max size
    if (this.queue.length > EventReporter.MAX_QUEUE_SIZE) {
      this.queue.splice(0, this.queue.length - EventReporter.MAX_QUEUE_SIZE);
    }

    // Log locally based on level
    const level = this.getLogLevel(event);
    if (this.shouldLog(level)) {
      const prefix = event.type === 'allow' ? '✓' : event.type === 'deny' ? '✗' : '•';
      let detail = `${prefix} ${event.operation}: ${event.target}`;
      if (event.policyId) detail += ` [policy:${event.policyId}]`;
      if (event.error) detail += ` [reason:${event.error}]`;
      if (event.duration) detail += ` [${event.duration}ms]`;
      console[level](`[AgenShield] ${detail}`);
    }

    // Flush if queue is getting large
    if (this.queue.length >= 100) {
      this.flush();
    }
  }

  /**
   * Report an interception
   */
  intercept(operation: string, target: string): void {
    this.report({
      type: 'intercept',
      operation,
      target,
      timestamp: new Date(),
    });
  }

  /**
   * Report an allowed operation
   */
  allow(operation: string, target: string, policyId?: string, duration?: number): void {
    this.report({
      type: 'allow',
      operation,
      target,
      timestamp: new Date(),
      policyId,
      duration,
    });
  }

  /**
   * Report a denied operation
   */
  deny(operation: string, target: string, policyId?: string, reason?: string): void {
    this.report({
      type: 'deny',
      operation,
      target,
      timestamp: new Date(),
      policyId,
      error: reason,
    });
  }

  /**
   * Report an error
   */
  error(operation: string, target: string, error: string): void {
    this.report({
      type: 'error',
      operation,
      target,
      timestamp: new Date(),
      error,
    });
  }

  /**
   * Flush the event queue
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const events = this.queue.splice(0, this.queue.length);

    try {
      await this.client.request('events_batch', { events });
      this.failedFlushCount = 0;
    } catch {
      this.failedFlushCount++;

      if (this.failedFlushCount < EventReporter.MAX_RETRIES) {
        // Re-queue events for retry, respecting max queue size
        this.queue.unshift(...events);
        if (this.queue.length > EventReporter.MAX_QUEUE_SIZE) {
          this.queue.splice(0, this.queue.length - EventReporter.MAX_QUEUE_SIZE);
        }
      }
      // After MAX_RETRIES, drop the events to prevent infinite loop
    }
  }

  /**
   * Stop the reporter
   */
  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Final flush
    this.flush();
  }

  /**
   * Get the appropriate log level for an event
   */
  private getLogLevel(event: InterceptorEvent): 'debug' | 'info' | 'warn' | 'error' {
    switch (event.type) {
      case 'intercept':
        return 'debug';
      case 'allow':
        return 'debug';
      case 'deny':
        return 'warn';
      case 'error':
        return 'error';
      default:
        return 'info';
    }
  }

  /**
   * Check if we should log at the given level
   */
  private shouldLog(level: string): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.logLevel];
  }
}
