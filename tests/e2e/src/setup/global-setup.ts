/**
 * Global setup for E2E tests.
 *
 * Runs once before all test suites:
 * 1. Guard: skip gracefully if not running as root
 * 2. Generate a random prefix for isolation
 * 3. Build the project
 * 4. Install the test harness globally
 */

import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PREFIX_FILE = '/tmp/agenshield-e2e-prefix.txt';
const ROOT_DIR = resolve(__dirname, '../../../..');

export default async function globalSetup() {
  // Guard: must run as root for OS user/group management
  if (process.getuid?.() !== 0) {
    console.warn(
      '\n⚠️  E2E tests require root privileges (sudo).\n' +
        '   Skipping E2E test suite.\n' +
        '   Run with: sudo npx nx run test-e2e:e2e --skip-nx-cache\n'
    );
    process.exit(0);
  }

  // Generate a unique prefix for this test run
  const suffix = randomBytes(4).toString('hex');
  const prefix = `e2e_${suffix}`;

  console.log(`\n[E2E Setup] Test prefix: ${prefix}`);
  console.log(`[E2E Setup] Root dir: ${ROOT_DIR}`);

  // Write prefix to temp file so tests and teardown can read it
  writeFileSync(PREFIX_FILE, prefix, 'utf-8');

  // Build the project
  console.log('[E2E Setup] Building project...');
  try {
    execSync('npx nx run-many -t build --skip-nx-cache', {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      timeout: 300_000, // 5 min build timeout
    });
  } catch (err) {
    console.error('[E2E Setup] Build failed:', (err as Error).message);
    process.exit(1);
  }

  // Install test harness as global npm package
  console.log('[E2E Setup] Installing test harness...');
  try {
    execSync('npm install && npm link', {
      cwd: resolve(ROOT_DIR, 'tools/test-harness'),
      stdio: 'inherit',
      timeout: 60_000,
    });
  } catch (err) {
    console.error('[E2E Setup] Test harness install failed:', (err as Error).message);
    process.exit(1);
  }

  console.log('[E2E Setup] Setup complete.\n');
}
