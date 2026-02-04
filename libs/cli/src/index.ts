/**
 * AgenShield CLI Library
 *
 * Security CLI for AI agents. This module exports utilities
 * for building CLI commands and managing the AgenShield system.
 *
 * @packageDocumentation
 */

export const VERSION = '0.1.0';

// Re-export detection utilities
export * from './detect/index.js';

// Re-export wizard utilities
export * from './wizard/types.js';
export { createWizardEngine } from './wizard/engine.js';

// Re-export utility functions
export * from './utils/index.js';

// Re-export command creators (for extending the CLI)
export * from './commands/index.js';
