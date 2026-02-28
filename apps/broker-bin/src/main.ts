/**
 * Broker SEA Entry Point
 *
 * Minimal entry that sets up the SEA runtime (VERSION + native modules)
 * then delegates to the broker main module.
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

require('../../../libs/shield-broker/src/main');
