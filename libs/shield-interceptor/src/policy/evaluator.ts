/**
 * Policy Evaluator
 *
 * Evaluates operations against daemon policies via RPC.
 * No caching - always checks daemon for up-to-date policy decisions.
 */

import type { AsyncClient } from '../client/http-client.js';

export interface PolicyEvaluatorOptions {
  client: AsyncClient;
}

export interface PolicyCheckResult {
  allowed: boolean;
  policyId?: string;
  reason?: string;
}

export class PolicyEvaluator {
  private client: AsyncClient;

  constructor(options: PolicyEvaluatorOptions) {
    this.client = options.client;
  }

  /**
   * Check if an operation is allowed
   * Always queries the daemon for fresh policy decisions
   */
  async check(
    operation: string,
    target: string
  ): Promise<PolicyCheckResult> {
    try {
      const result = await this.client.request<PolicyCheckResult>(
        'policy_check',
        { operation, target }
      );

      return result;
    } catch (error) {
      // If we can't reach the daemon, deny by default for security
      return {
        allowed: false,
        reason: `Policy check failed: ${(error as Error).message}`,
      };
    }
  }
}
