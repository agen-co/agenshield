/**
 * Daemon Policy Forwarding
 *
 * Shared module for forwarding policy checks to the daemon's RPC endpoint.
 * Used by both the policy_check handler and the top-level processRequest()
 * in server.ts / http-fallback.ts when the broker's local enforcer denies
 * a request but the daemon may have a user-defined policy that allows it.
 */

/** Timeout for daemon RPC calls (ms) */
const DAEMON_RPC_TIMEOUT = 2000;

export interface DaemonPolicyResult {
  allowed: boolean;
  policyId?: string;
  reason?: string;
}

/**
 * Forward a policy check to the daemon's RPC endpoint.
 *
 * The daemon evaluates user-defined policies (created in the UI).
 * We only accept the daemon's result if it returns `allowed: true`
 * AND includes a `policyId` (explicit user policy match).
 * A default-allow (no policyId) is NOT trusted — we keep the broker denial.
 *
 * @returns The daemon's result if it explicitly allows, or null to keep broker denial.
 */
export async function forwardPolicyToDaemon(
  operation: string,
  target: string,
  daemonUrl: string
): Promise<DaemonPolicyResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DAEMON_RPC_TIMEOUT);

    const response = await fetch(`${daemonUrl}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `broker-fwd-${Date.now()}`,
        method: 'policy_check',
        params: { operation, target },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as {
      result?: { allowed?: boolean; policyId?: string; reason?: string };
      error?: { message?: string };
    };

    if (json.error || !json.result) {
      return null;
    }

    const result = json.result;

    // Trust explicit user policy matches (must have policyId) — both allow and deny
    if (result.policyId) {
      return {
        allowed: !!result.allowed,
        policyId: result.policyId,
        reason: result.reason,
      };
    }

    // Daemon default-allow (no policyId) — don't override broker's decision
    return null;
  } catch {
    // Daemon unreachable or timeout — keep broker denial
    return null;
  }
}
