/**
 * Global setup for E2E enforcement tests.
 *
 * Requires sudo. Runs once before all test suites:
 * 1. Guard: skip if not running as root
 * 2. Generate a unique prefix for isolation
 * 3. Build the project
 * 4. Run agenshield setup to create OS users/groups
 * 5. Start daemon
 * 6. Install test harness
 */

import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PREFIX_FILE = '/tmp/agenshield-e2e-enforcement-prefix.txt';
const ROOT_DIR = resolve(__dirname, '../../../..');
const CLI_PATH = resolve(ROOT_DIR, 'libs/cli/dist/src/cli.js');

export default async function globalSetup() {
  // Guard: must run as root for OS user/group management
  if (process.getuid?.() !== 0) {
    console.warn(
      '\n⚠️  E2E enforcement tests require root privileges (sudo).\n' +
        '   Run with: sudo npx nx run test-e2e-enforcement:e2e --skip-nx-cache\n'
    );
    process.exit(0);
  }

  // Generate a unique prefix for this test run
  const suffix = randomBytes(4).toString('hex');
  const prefix = `enf_${suffix}`;

  console.log(`\n[E2E Enforcement Setup] Test prefix: ${prefix}`);
  console.log(`[E2E Enforcement Setup] Root dir: ${ROOT_DIR}`);

  // Write prefix to temp file so tests and teardown can read it
  writeFileSync(PREFIX_FILE, prefix, 'utf-8');

  // Build the project
  console.log('[E2E Enforcement Setup] Building project...');
  try {
    execSync('npx nx run-many -t build --skip-nx-cache', {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      timeout: 300_000,
    });
  } catch (err) {
    console.error('[E2E Enforcement Setup] Build failed:', (err as Error).message);
    process.exit(1);
  }

  // Run agenshield setup to create OS users and groups
  console.log(`[E2E Enforcement Setup] Running agenshield setup (prefix: ${prefix})...`);
  try {
    execSync(
      `node ${CLI_PATH} setup --target openclaw --prefix ${prefix} --skip-confirm`,
      {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        timeout: 120_000,
      }
    );
  } catch (err) {
    console.error('[E2E Enforcement Setup] Setup failed:', (err as Error).message);
    process.exit(1);
  }

  // Start daemon
  console.log('[E2E Enforcement Setup] Starting daemon...');
  try {
    execSync(`node ${CLI_PATH} daemon start`, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      timeout: 30_000,
    });
  } catch (err) {
    console.error('[E2E Enforcement Setup] Daemon start failed:', (err as Error).message);
    process.exit(1);
  }

  // Wait for daemon health
  const healthUrl = 'http://127.0.0.1:5200/api/health';
  const start = Date.now();
  const timeout = 15_000;
  let healthy = false;

  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!healthy) {
    console.error('[E2E Enforcement Setup] Daemon did not become healthy');
    process.exit(1);
  }

  // Install test harness
  console.log('[E2E Enforcement Setup] Installing test harness...');
  try {
    execSync('npm install && npm link', {
      cwd: resolve(ROOT_DIR, 'tools/test-harness'),
      stdio: 'inherit',
      timeout: 60_000,
    });
  } catch (err) {
    console.error('[E2E Enforcement Setup] Test harness install failed:', (err as Error).message);
    process.exit(1);
  }

  console.log('[E2E Enforcement Setup] Setup complete.\n');
}
