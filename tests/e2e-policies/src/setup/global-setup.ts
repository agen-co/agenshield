/**
 * Global setup for E2E policy tests.
 *
 * 1. Create a temp HOME directory for config isolation
 * 2. Write a seed config with custom port and empty policies
 * 3. Spawn the daemon via npx tsx (no build needed)
 * 4. Wait for health endpoint
 * 5. Write state file for tests and teardown
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT_DIR = resolve(__dirname, '../../../..');
const STATE_FILE = '/tmp/agenshield-e2e-policies-state.json';
const TEST_PORT = 5299;
const TEST_HOST = '127.0.0.1';

export default async function globalSetup() {
  console.log('\n[E2E Policies Setup] Starting...');

  // 1. Create temp HOME directory for complete config isolation
  const tempHome = mkdtempSync(join(tmpdir(), 'agenshield-e2e-policies-'));
  const configDir = join(tempHome, '.agenshield');
  mkdirSync(configDir, { recursive: true });

  // Create a fake agent home so skills watcher doesn't error
  const agentHome = join(tempHome, 'agent');
  mkdirSync(agentHome, { recursive: true });

  console.log(`[E2E Policies Setup] Temp HOME: ${tempHome}`);
  console.log(`[E2E Policies Setup] Port: ${TEST_PORT}`);

  // 2. Write seed config
  const seedConfig = {
    version: '0.1.0',
    daemon: {
      port: TEST_PORT,
      host: TEST_HOST,
      logLevel: 'warn',
      enableHostsEntry: false,
    },
    policies: [],
    vault: {
      enabled: false,
      provider: 'local',
    },
  };
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(seedConfig, null, 2));

  // 3. Spawn daemon with isolated HOME
  const daemonProc = spawn('npx', ['tsx', 'libs/shield-daemon/src/main.ts'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: tempHome,
      AGENSHIELD_AGENT_HOME: agentHome,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  daemonProc.unref();

  // Collect stderr for debugging if startup fails
  let stderrBuf = '';
  daemonProc.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString();
  });

  // 4. Wait for health endpoint
  const healthUrl = `http://${TEST_HOST}:${TEST_PORT}/api/health`;
  const start = Date.now();
  const timeout = 30_000;
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
    console.error('[E2E Policies Setup] Daemon stderr:', stderrBuf);
    try {
      daemonProc.kill('SIGKILL');
    } catch {
      /* already dead */
    }
    throw new Error(`Daemon failed to start on port ${TEST_PORT} within ${timeout}ms`);
  }

  // 5. Write state for tests and teardown
  writeFileSync(
    STATE_FILE,
    JSON.stringify({
      pid: daemonProc.pid,
      port: TEST_PORT,
      host: TEST_HOST,
      tempHome,
    })
  );

  console.log(`[E2E Policies Setup] Daemon running (PID ${daemonProc.pid})\n`);
}
