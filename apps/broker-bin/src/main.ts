/**
 * Broker SEA Entry Point
 *
 * Minimal entry that sets up the SEA runtime (VERSION + native modules)
 * then delegates to the broker main module.
 */

// Early diagnostics — written before any imports that might crash
process.stderr.write(`[broker] PID=${process.pid} starting at ${new Date().toISOString()}\n`);
process.stderr.write(`[broker] HOME=${process.env['HOME']} BROKER_HOME=${process.env['AGENSHIELD_BROKER_HOME']} HOST_HOME=${process.env['AGENSHIELD_HOST_HOME']}\n`);

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

// Handle --version before starting any server
if (process.argv.includes('--version')) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sea = require('node:sea');
    if (sea.isSea()) {
      console.log(sea.getAsset('VERSION', 'utf8').trim());
    } else {
      throw new Error('not SEA');
    }
  } catch {
    // Dev mode — read from package.json
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../../../package.json');
    console.log(pkg.version);
  }
  process.exit(0);
}

require('../../../libs/shield-broker/src/main');
