#!/usr/bin/env node

/**
 * Stop the local Verdaccio registry and ngrok tunnel.
 *
 * Usage: node scripts/registry/stop.mjs
 */

import { readFileSync, rmSync, existsSync } from 'node:fs';

const STATE_FILE = '/tmp/agenshield-registry.json';

async function main() {
  if (!existsSync(STATE_FILE)) {
    console.log('No registry is running (state file not found).');
    process.exit(0);
  }

  let state;
  try {
    state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    console.error('Error reading state file.');
    rmSync(STATE_FILE, { force: true });
    process.exit(1);
  }

  console.log('Stopping local registry...');

  // Kill Verdaccio process
  if (state.pid) {
    try {
      process.kill(state.pid, 'SIGTERM');
      console.log(`  Killed Verdaccio (PID ${state.pid})`);
    } catch (err) {
      if (err.code === 'ESRCH') {
        console.log('  Verdaccio process already stopped.');
      } else {
        console.warn(`  Warning: Could not kill PID ${state.pid}:`, err.message);
      }
    }
  }

  // Disconnect ngrok
  try {
    const ngrok = await import('@ngrok/ngrok');
    await ngrok.disconnect();
    console.log('  Disconnected ngrok tunnel.');
  } catch {
    console.log('  ngrok already disconnected.');
  }

  // Clean up state file
  rmSync(STATE_FILE, { force: true });
  console.log('  Cleaned up state file.');

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
