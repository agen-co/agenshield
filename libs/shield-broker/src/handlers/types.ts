/**
 * Handler types
 */

import type { PolicyEnforcer } from '../policies/enforcer.js';
import type { AuditLogger } from '../audit/logger.js';
import type { SecretVault } from '../secrets/vault.js';
import type { SecretResolver } from '../secrets/resolver.js';
import type { CommandAllowlist } from '../policies/command-allowlist.js';

/**
 * Exec monitoring event emitted after each exec operation
 */
export interface ExecMonitorEvent {
  command: string;
  args: string[];
  cwd?: string;
  exitCode: number;
  allowed: boolean;
  duration: number;
  timestamp: string;
  injectedSecretNames?: string[];
}

export interface HandlerDependencies {
  policyEnforcer: PolicyEnforcer;
  auditLogger: AuditLogger;
  secretVault: SecretVault;
  secretResolver?: SecretResolver;
  commandAllowlist: CommandAllowlist;
  onExecMonitor?: (event: ExecMonitorEvent) => void;
  onExecDenied?: (command: string, reason: string) => void;
  daemonUrl?: string;
}
