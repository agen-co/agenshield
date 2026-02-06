/**
 * Base Interceptor
 *
 * Base class for all interceptors.
 */

import type { AsyncClient } from '../client/http-client.js';
import type { PolicyEvaluator } from '../policy/evaluator.js';
import type { EventReporter } from '../events/reporter.js';
import { PolicyDeniedError, BrokerUnavailableError } from '../errors.js';

export interface BaseInterceptorOptions {
  client: AsyncClient;
  policyEvaluator: PolicyEvaluator;
  eventReporter: EventReporter;
  failOpen: boolean;
  /** HTTP port used by the broker (to skip interception of broker traffic) */
  brokerHttpPort?: number;
}

export abstract class BaseInterceptor {
  protected client: AsyncClient;
  protected policyEvaluator: PolicyEvaluator;
  protected eventReporter: EventReporter;
  protected failOpen: boolean;
  protected installed: boolean = false;
  private brokerHttpPort: number;

  constructor(options: BaseInterceptorOptions) {
    this.client = options.client;
    this.policyEvaluator = options.policyEvaluator;
    this.eventReporter = options.eventReporter;
    this.failOpen = options.failOpen;
    this.brokerHttpPort = options.brokerHttpPort ?? 5201;
  }

  /**
   * Check if a URL targets the broker or daemon (should not be intercepted)
   */
  protected isBrokerUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        return false;
      }
      const port = parsed.port;
      return port === String(this.brokerHttpPort) || port === '5200';
    } catch {
      return false;
    }
  }

  /**
   * Install the interceptor
   */
  abstract install(): void;

  /**
   * Uninstall the interceptor
   */
  abstract uninstall(): void;

  /**
   * Check if the interceptor is installed
   */
  isInstalled(): boolean {
    return this.installed;
  }

  /**
   * Check policy and handle the result
   */
  protected async checkPolicy(
    operation: string,
    target: string
  ): Promise<void> {
    const startTime = Date.now();

    try {
      this.eventReporter.intercept(operation, target);

      const result = await this.policyEvaluator.check(operation, target);

      if (!result.allowed) {
        this.eventReporter.deny(operation, target, result.policyId, result.reason);
        throw new PolicyDeniedError(result.reason || 'Operation denied by policy', {
          operation,
          target,
          policyId: result.policyId,
        });
      }

      this.eventReporter.allow(
        operation,
        target,
        result.policyId,
        Date.now() - startTime
      );
    } catch (error) {
      if (error instanceof PolicyDeniedError) {
        throw error;
      }

      // Handle broker unavailable
      if (this.failOpen) {
        this.eventReporter.error(
          operation,
          target,
          `Broker unavailable, failing open: ${(error as Error).message}`
        );
        return;
      }

      throw new BrokerUnavailableError((error as Error).message);
    }
  }

  /**
   * Log a debug message
   */
  protected debug(message: string): void {
    console.debug(`[AgenShield:${this.constructor.name}] ${message}`);
  }
}
