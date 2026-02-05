/**
 * Global teardown for E2E tests.
 *
 * Runs once after all test suites (even on failure):
 * 1. Stop the daemon if running
 * 2. Force uninstall with the test prefix
 * 3. Safety sweep: delete any leftover e2e_ prefixed OS users/groups
 * 4. Unlink test harness
 * 5. Clean temp file
 */

import { execSync } from 'node:child_process';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PREFIX_FILE = '/tmp/agenshield-e2e-prefix.txt';
const ROOT_DIR = resolve(__dirname, '../../../..');
const CLI_PATH = resolve(ROOT_DIR, 'libs/cli/dist/src/cli.js');

function safeExec(cmd: string, label: string): void {
  try {
    execSync(cmd, { stdio: 'pipe', timeout: 30_000 });
  } catch {
    console.warn(`[E2E Teardown] ${label} failed (non-fatal)`);
  }
}

export default async function globalTeardown() {
  console.log('\n[E2E Teardown] Starting cleanup...');

  // Read prefix
  let prefix = '';
  try {
    prefix = readFileSync(PREFIX_FILE, 'utf-8').trim();
  } catch {
    console.warn('[E2E Teardown] No prefix file found, running safety sweep only.');
  }

  // Stop daemon
  console.log('[E2E Teardown] Stopping daemon...');
  safeExec(`node ${CLI_PATH} daemon stop`, 'Daemon stop');

  // Wait for daemon to actually stop
  await new Promise((r) => setTimeout(r, 2000));

  // Force uninstall
  if (prefix) {
    console.log(`[E2E Teardown] Uninstalling (prefix: ${prefix})...`);
    safeExec(
      `node ${CLI_PATH} uninstall --force --prefix ${prefix}`,
      'Uninstall'
    );
  }

  // Safety sweep: find and delete any leftover e2e_ users and groups (macOS)
  console.log('[E2E Teardown] Running safety sweep for e2e_ users/groups...');
  if (process.platform === 'darwin') {
    try {
      const users = execSync('dscl . -list /Users', { encoding: 'utf-8' })
        .split('\n')
        .filter((u) => u.startsWith('e2e_'));

      for (const user of users) {
        console.log(`[E2E Teardown]   Deleting user: ${user}`);
        safeExec(`dscl . -delete /Users/${user}`, `Delete user ${user}`);
        // Also remove home directory
        const home = `/Users/${user}`;
        if (existsSync(home)) {
          safeExec(`rm -rf ${home}`, `Delete home ${home}`);
        }
      }

      const groups = execSync('dscl . -list /Groups', { encoding: 'utf-8' })
        .split('\n')
        .filter((g) => g.startsWith('e2e_'));

      for (const group of groups) {
        console.log(`[E2E Teardown]   Deleting group: ${group}`);
        safeExec(`dscl . -delete /Groups/${group}`, `Delete group ${group}`);
      }
    } catch {
      console.warn('[E2E Teardown] Safety sweep encountered errors (non-fatal).');
    }
  }

  // Unlink test harness
  console.log('[E2E Teardown] Unlinking test harness...');
  safeExec('npm unlink -g dummy-openclaw', 'Unlink test harness');

  // Clean temp file
  try {
    unlinkSync(PREFIX_FILE);
  } catch {
    // Already cleaned or doesn't exist
  }

  console.log('[E2E Teardown] Cleanup complete.\n');
}
