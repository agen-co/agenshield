/**
 * @agenshield/broker
 *
 * Standalone broker daemon with Unix socket server for AgenShield.
 * Provides policy enforcement, operation proxying, and audit logging.
 */

// Server exports
export { UnixSocketServer } from './server.js';
export { HttpFallbackServer } from './http-fallback.js';

// Policy exports
export { PolicyEnforcer } from './policies/enforcer.js';
export { BuiltinPolicies, getDefaultPolicies } from './policies/builtin.js';

// Handler exports
export * from './handlers/index.js';

// Seatbelt exports
export { SeatbeltGenerator } from './seatbelt/generator.js';
export { SeatbeltTemplates } from './seatbelt/templates.js';

// Secrets exports
export { SecretVault } from './secrets/vault.js';

// Audit exports
export { AuditLogger } from './audit/logger.js';

// Client exports (re-exported from client/index.ts)
export { BrokerClient } from './client/index.js';

// Types
export type {
  BrokerConfig,
  HandlerContext,
  HandlerResult,
  AuditEntry,
  VaultEntry,
} from './types.js';
