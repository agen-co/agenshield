/**
 * CLI SEA Entry Point
 *
 * Sets up the SEA runtime (VERSION + native modules) then delegates
 * to the CLI main module. TLA in ink/react was already fixed in Phase 1
 * via lazy dynamic imports.
 */

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sea = require('node:sea');
  if (sea.isSea()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setupSEARuntime } = require('../../../tools/sea/shared/runtime');
    setupSEARuntime();
  }
} catch {
  // Not running as SEA — normal mode
}

require('../../../libs/cli/src/cli');
