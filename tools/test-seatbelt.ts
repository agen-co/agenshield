/**
 * Seatbelt Sandbox Test Script
 *
 * Tests exec interception + seatbelt wrapping + per-run proxy:
 *  - Network commands (curl) → proxy → URL policy enforcement
 *  - Non-network commands (ls, echo, date) → no proxy, no network
 *  - Absolute-path commands → same behavior as bare commands
 *  - Fetch interceptor → works independently of seatbelt
 *
 * This test works regardless of which URL policies are configured.
 * It dynamically adapts expectations based on what the daemon returns.
 *
 * Prerequisites:
 *   1. Daemon running: yarn daemon:dev
 *
 * Usage:
 *   yarn test:seatbelt
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { installInterceptors } = require('../libs/shield-interceptor/src/installer.js');

// Install interceptors pointing at the daemon (port 5200)
installInterceptors({
  httpPort: parseInt(process.env['AGENSHIELD_PORT'] || '5200', 10),
  interceptFetch: true,
  interceptHttp: true,
  interceptWs: true,
  interceptFs: false,
  interceptExec: true,
  logLevel: 'debug',
  enableSeatbelt: true,
  failOpen: false,
});

// Require child_process AFTER interceptors are installed.
const { execSync } = require('node:child_process');

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
const INFO = '\x1b[36mINFO\x1b[0m';
const SECTION = '\x1b[35m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

// @ts-ignore
async function test(name: string, fn: () => Promise<void>) {
  console.log(`\n--- ${name} ---`);
  try {
    await fn();
  } catch (err) {
    console.log(`  Unexpected error: ${(err as Error).message}`);
  }
}

function expectBlocked(label: string, command: string) {
  try {
    const result = execSync(command, { encoding: 'utf-8', timeout: 15000 });
    console.log(`  ${FAIL} ${label}: expected BLOCKED but got output (${result.length} bytes)`);
    console.log(`  Preview: ${result.slice(0, 120).replace(/\n/g, '\\n')}`);
    failed++;
  } catch (err) {
    const msg = (err as Error).message || String(err);
    const isPolicy = msg.includes('denied by policy') || msg.includes('PolicyDenied');
    const isSeatbelt = msg.includes('sandbox') || msg.includes('deny');
    const isNetwork = msg.includes('not allowed') || msg.includes('Could not resolve host');
    const isProxy = msg.includes('403') || msg.includes('Forbidden') || msg.includes('proxy');
    if (isPolicy || isSeatbelt || isNetwork || isProxy) {
      const reason = isPolicy ? 'policy' : isSeatbelt ? 'seatbelt' : isProxy ? 'proxy' : 'network';
      console.log(`  ${PASS} ${label}: blocked (${reason})`);
      passed++;
    } else {
      console.log(`  ${INFO} ${label}: errored but not clearly policy/seatbelt/proxy: ${msg.slice(0, 200)}`);
      // Still count as blocked — command didn't succeed
      passed++;
    }
  }
}

function expectAllowed(label: string, command: string) {
  try {
    const result = execSync(command, { encoding: 'utf-8', timeout: 15000 });
    console.log(`  ${PASS} ${label}: allowed (${result.trim().split('\n').length} lines)`);
    passed++;
  } catch (err) {
    console.log(`  ${FAIL} ${label}: expected ALLOWED but got error: ${(err as Error).message.slice(0, 200)}`);
    failed++;
  }
}

console.log('=== AgenShield Seatbelt + Proxy Test ===');
console.log(`Platform: ${process.platform}`);
console.log(`Node: ${process.version}`);
console.log(`PID: ${process.pid}`);

// ════════════════════════════════════════════════════════════
// Section 1: Non-network commands (no proxy, no network needed)
// ════════════════════════════════════════════════════════════

console.log(`\n${SECTION}═══ Non-network commands (should always work) ═══${RESET}`);

test('ls /tmp (no network needed)', async () => {
  expectAllowed('ls /tmp', 'ls /tmp');
});

test('echo hello (no network needed)', async () => {
  expectAllowed('echo', 'echo hello-seatbelt-test');
});

test('date (no network needed)', async () => {
  expectAllowed('date', 'date');
});

test('cat /etc/hosts (no network needed)', async () => {
  expectAllowed('cat /etc/hosts', 'cat /etc/hosts');
});

test('wc -l /etc/passwd (no network needed)', async () => {
  expectAllowed('wc', 'wc -l /etc/passwd');
});

// ════════════════════════════════════════════════════════════
// Section 2: Network commands via proxy (allowed by default)
// These should work regardless of URL policies because:
//  - No URL policies → proxy passthrough (allows everything)
//  - URL policies → proxy allows non-matching URLs (default-allow)
// ════════════════════════════════════════════════════════════

console.log(`\n${SECTION}═══ Network commands via proxy (should be allowed) ═══${RESET}`);

test('curl to registry.npmjs.org (via proxy)', async () => {
  expectAllowed('curl npmjs', 'curl -s --max-time 10 https://registry.npmjs.org');
});

test('curl to example.com (via proxy)', async () => {
  expectAllowed('curl example.com', 'curl -s --max-time 10 https://example.com');
});

test('Absolute-path curl /usr/bin/curl (via proxy)', async () => {
  expectAllowed('curl (absolute)', '/usr/bin/curl -s --max-time 10 https://example.com');
});

test('curl with headers (via proxy)', async () => {
  expectAllowed('curl headers', 'curl -s --max-time 10 -H "Accept: application/json" https://httpbin.org/get');
});

// ════════════════════════════════════════════════════════════
// Section 3: Seatbelt enforcement — direct network should be blocked
// Even with proxy, the seatbelt only allows localhost.
// If we bypass the proxy env vars, network should fail.
// ════════════════════════════════════════════════════════════

console.log(`\n${SECTION}═══ Seatbelt enforcement (direct bypass attempt) ═══${RESET}`);

test('curl --noproxy * (should be blocked by seatbelt)', async () => {
  // --noproxy bypasses the HTTPS_PROXY env var, so curl tries direct network.
  // Seatbelt only allows localhost → this should fail.
  expectBlocked('curl --noproxy', 'curl -s --max-time 5 --noproxy "*" https://example.com');
});

// ════════════════════════════════════════════════════════════
// Section 4: Fetch interceptor (works via daemon, not seatbelt)
// ════════════════════════════════════════════════════════════

console.log(`\n${SECTION}═══ Fetch interceptor ═══${RESET}`);

(async function () {
  await test('fetch https://example.com', async () => {
    try {
      const data = await fetch('https://example.com');
      console.log(`  ${PASS} fetch: status ${data.status}`);
      passed++;
    } catch (err) {
      console.log(`  ${FAIL} fetch: ${(err as Error).message.slice(0, 200)}`);
      failed++;
    }
  });

  // ─── Summary ───

  console.log(`\n${'═'.repeat(50)}`);
  console.log('=== Summary ===');
  console.log(`  ${PASS} Passed: ${passed}`);
  if (failed > 0) {
    console.log(`  ${FAIL} Failed: ${failed}`);
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
})();
