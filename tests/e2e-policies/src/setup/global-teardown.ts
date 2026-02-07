/**
 * Global teardown for E2E policy tests.
 *
 * 1. Kill daemon process
 * 2. Remove temp HOME directory
 * 3. Clean state file
 */

import { readFileSync, rmSync, unlinkSync, existsSync } from 'node:fs';

const STATE_FILE = '/tmp/agenshield-e2e-policies-state.json';

export default async function globalTeardown() {
  console.log('\n[E2E Policies Teardown] Starting cleanup...');

  let state: { pid: number; tempHome: string } | null = null;

  try {
    state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    console.warn('[E2E Policies Teardown] No state file found.');
  }

  // Kill daemon process
  if (state?.pid) {
    try {
      process.kill(state.pid, 'SIGTERM');
      console.log(`[E2E Policies Teardown] Sent SIGTERM to PID ${state.pid}`);
    } catch {
      /* already dead */
    }

    // Give it a moment to shut down gracefully
    await new Promise((r) => setTimeout(r, 2000));

    try {
      process.kill(state.pid, 'SIGKILL');
    } catch {
      /* already dead */
    }
  }

  // Clean temp home directory
  if (state?.tempHome && existsSync(state.tempHome)) {
    rmSync(state.tempHome, { recursive: true, force: true });
    console.log(`[E2E Policies Teardown] Removed ${state.tempHome}`);
  }

  // Clean state file
  try {
    unlinkSync(STATE_FILE);
  } catch {
    /* already cleaned */
  }

  console.log('[E2E Policies Teardown] Cleanup complete.\n');
}
