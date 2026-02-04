/**
 * Policy Evaluator
 *
 * Evaluates operations against cached policies.
 */

import type { AsyncClient } from '../client/http-client.js';
import { PolicyCache } from './cache.js';

export interface PolicyEvaluatorOptions {
  client: AsyncClient;
  cacheTtl: number;
}

export interface PolicyCheckResult {
  allowed: boolean;
  policyId?: string;
  reason?: string;
}

export class PolicyEvaluator {
  private client: AsyncClient;
  private cache: PolicyCache;

  constructor(options: PolicyEvaluatorOptions) {
    this.client = options.client;
    this.cache = new PolicyCache({ ttl: options.cacheTtl });
  }

  /**
   * Check if an operation is allowed
   */
  async check(
    operation: string,
    target: string
  ): Promise<PolicyCheckResult> {
    // Check cache first
    const cacheKey = `${operation}:${target}`;
    const cached = this.cache.get<PolicyCheckResult>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // Make request to broker
    try {
      const result = await this.client.request<PolicyCheckResult>(
        'policy_check',
        { operation, target }
      );

      // Cache the result
      this.cache.set(cacheKey, result);

      return result;
    } catch (error) {
      // If we can't reach the broker, assume denied
      return {
        allowed: false,
        reason: `Policy check failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Clear the policy cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; hits: number; misses: number } {
    return this.cache.getStats();
  }
}
