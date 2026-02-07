/**
 * Global teardown for E2E enforcement tests.
 *
 * Runs once after all test suites (even on failure):
 * 1. Stop the daemon
 * 2. Uninstall with the test prefix
 * 3. Safety sweep: delete any leftover enf_ prefixed OS users/groups
 * 4. Unlink test harness
 * 5. Clean temp file
 */

import { execSync } from 'node:child_process';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PREFIX_FILE = '/tmp/agenshield-e2e-enforcement-prefix.txt';
const ROOT_DIR = resolve(__dirname, '../../../..');
const CLI_PATH = resolve(ROOT_DIR, 'libs/cli/dist/src/cli.js');

function safeExec(cmd: string, label: string): void {
  try {
    execSync(cmd, { stdio: 'pipe', timeout: 30_000 });
  } catch {
    console.warn(`[E2E Enforcement Teardown] ${label} failed (non-fatal)`);
  }
}

export default async function globalTeardown() {
  console.log('\n[E2E Enforcement Teardown] Starting cleanup...');

  // Read prefix
  let prefix = '';
  try {
    prefix = readFileSync(PREFIX_FILE, 'utf-8').trim();
  } catch {
    console.warn('[E2E Enforcement Teardown] No prefix file found, running safety sweep only.');
  }

  // Stop daemon
  console.log('[E2E Enforcement Teardown] Stopping daemon...');
  safeExec(`node ${CLI_PATH} daemon stop`, 'Daemon stop');
  await new Promise((r) => setTimeout(r, 2000));

  // Uninstall
  if (prefix) {
    console.log(`[E2E Enforcement Teardown] Uninstalling (prefix: ${prefix})...`);
    safeExec(
      `node ${CLI_PATH} uninstall --force --prefix ${prefix}`,
      'Uninstall'
    );
  }

  // Safety sweep: delete any leftover enf_ users and groups (macOS)
  console.log('[E2E Enforcement Teardown] Running safety sweep for enf_ users/groups...');
  if (process.platform === 'darwin') {
    try {
      const users = execSync('dscl . -list /Users', { encoding: 'utf-8' })
        .split('\n')
        .filter((u) => u.startsWith('enf_'));

      for (const user of users) {
        console.log(`[E2E Enforcement Teardown]   Deleting user: ${user}`);
        safeExec(`dscl . -delete /Users/${user}`, `Delete user ${user}`);
        const home = `/Users/${user}`;
        if (existsSync(home)) {
          safeExec(`rm -rf ${home}`, `Delete home ${home}`);
        }
      }

      const groups = execSync('dscl . -list /Groups', { encoding: 'utf-8' })
        .split('\n')
        .filter((g) => g.startsWith('enf_'));

      for (const group of groups) {
        console.log(`[E2E Enforcement Teardown]   Deleting group: ${group}`);
        safeExec(`dscl . -delete /Groups/${group}`, `Delete group ${group}`);
      }
    } catch {
      console.warn('[E2E Enforcement Teardown] Safety sweep encountered errors (non-fatal).');
    }
  }

  // Unlink test harness
  console.log('[E2E Enforcement Teardown] Unlinking test harness...');
  safeExec('npm unlink -g dummy-openclaw', 'Unlink test harness');

  // Clean temp file
  try {
    unlinkSync(PREFIX_FILE);
  } catch {
    // Already cleaned
  }

  console.log('[E2E Enforcement Teardown] Cleanup complete.\n');
}
