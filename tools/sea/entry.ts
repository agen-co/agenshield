/**
 * Unified SEA Entry Point
 *
 * Single entry point for the AgenShield binary. Dispatches to the correct
 * role based on process.argv:
 *
 *   agenshield [command]                    → CLI mode (default)
 *   agenshield __internal:daemon [args]     → Daemon process
 *   agenshield __internal:broker [args]     → Broker process
 *   agenshield __internal:privilege-helper   → Root privilege helper
 *   agenshield __internal:worker:syscmd     → Worker thread entry
 */

// Detect role BEFORE any heavy imports
const args = process.argv.slice(2);
const role = args[0]?.startsWith('__internal:') ? args[0] : 'cli';

// Setup SEA environment if running as a Single Executable Application
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sea = require('node:sea');
  if (typeof sea.isSea === 'function' && sea.isSea()) {
    const { setupSEARuntime } = require('./runtime');
    setupSEARuntime();
  }
} catch {
  // Not running as SEA — normal mode
}

switch (role) {
  case '__internal:daemon': {
    // Strip the internal arg so the daemon sees clean argv
    process.argv.splice(2, 1);
    require('./daemon-entry');
    break;
  }
  case '__internal:broker': {
    process.argv.splice(2, 1);
    require('./broker-entry');
    break;
  }
  case '__internal:privilege-helper': {
    // The helper expects: node helper.js <socketPath>
    // In SEA mode argv is: [execPath, execPath, __internal:privilege-helper, socketPath]
    // Transform to:        [execPath, execPath, socketPath]
    const socketPath = process.argv[3];
    process.argv = [process.argv[0], process.argv[1], socketPath];
    require('./privilege-helper-entry');
    break;
  }
  default: {
    // CLI mode — default
    require('./cli-entry');
    break;
  }
}
