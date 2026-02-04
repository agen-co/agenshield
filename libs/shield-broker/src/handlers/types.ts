/**
 * Handler types
 */

import type { PolicyEnforcer } from '../policies/enforcer.js';
import type { AuditLogger } from '../audit/logger.js';
import type { SecretVault } from '../secrets/vault.js';

export interface HandlerDependencies {
  policyEnforcer: PolicyEnforcer;
  auditLogger: AuditLogger;
  secretVault: SecretVault;
}
