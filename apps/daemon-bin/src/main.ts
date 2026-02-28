/**
 * Daemon SEA Entry Point
 *
 * Dispatches between daemon mode and privilege-helper mode:
 *   agenshield-daemon                    → Daemon process
 *   agenshield-daemon --privilege-helper <socketPath> → Root privilege helper
 */

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sea = require('node:sea');
  if (sea.isSea()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setupSEARuntime } = require('../../../tools/sea/shared/runtime');
    setupSEARuntime({
      extractWorkers: true,
      extractInterceptors: true,
      extractUI: true,
    });
  }
} catch {
  // Not running as SEA — normal mode
}

const args = process.argv.slice(2);

if (args[0] === '--privilege-helper') {
  // Privilege helper mode: rewrite argv so the helper sees [execPath, script, socketPath]
  const socketPath = args[1];
  process.argv = [process.argv[0], process.argv[1], socketPath];
  require('../../../libs/shield-daemon/src/privilege-helper/helper');
} else {
  // Daemon mode (default)
  require('../../../libs/shield-daemon/src/main');
}
