/**
 * AgenShield CLI Library
 *
 * Security CLI for AI agents. This module exports utilities
 * for building CLI commands and managing the AgenShield system.
 *
 * @packageDocumentation
 */

import { getVersion } from './utils/version.js';

export const VERSION = getVersion();

// Re-export error classes
export * from './errors.js';

// Re-export detection utilities
export * from './detect/index.js';

// Re-export wizard utilities
export * from './wizard/types.js';
export { createWizardEngine } from './wizard/engine.js';

// Re-export utility functions
export * from './utils/index.js';

// Re-export command creators (for extending the CLI)
export * from './commands/index.js';
