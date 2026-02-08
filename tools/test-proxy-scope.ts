/**
 * Command-Scoped Proxy + Policy Lifecycle Test
 *
 * Proves that policies are enforced dynamically by cycling through
 * multiple policy configurations and verifying behavior flips:
 *
 *   Round 1: gog allowed, google.com allowed, facebook.com denied (scoped to gog)
 *   Round 2: FLIP — google.com denied, facebook.com allowed (scoped to gog)
 *   Round 3: No URL policies — everything passes through proxy
 *   Round 4: gog command DENIED — command policy blocks execution entirely
 *   Round 5: No policies at all — default-allow, proxy passthrough
 *
 * Prerequisites:
 *   1. Daemon running: yarn daemon:dev
 *
 * Usage:
 *   npx tsx tools/test-proxy-scope.ts
 */

import * as fs from 'node:fs';

const DAEMON_PORT = parseInt(process.env['AGENSHIELD_PORT'] || '5200', 10);
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;
const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
const INFO = '\x1b[36mINFO\x1b[0m';
const SECTION = '\x1b[35m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;
let round = 0;
let authToken = '';

// ─── Auth ───

async function authenticate(): Promise<void> {
  const passcode = process.env['AGENSHIELD_PASSCODE'] || '1234';

  // Check if auth is needed
  const statusRes = await fetch(`${DAEMON_URL}/api/auth/status`);
  const status = await statusRes.json() as { protectionEnabled?: boolean; passcodeSet?: boolean };
  if (!status.protectionEnabled) {
    console.log(`${INFO} Auth: protection disabled, no token needed`);
    return;
  }

  const res = await fetch(`${DAEMON_URL}/api/auth/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });
  const data = await res.json() as { success: boolean; token?: string; error?: string };
  if (!data.success || !data.token) {
    throw new Error(`Auth failed: ${data.error || 'unknown error'}`);
  }
  authToken = data.token;
  console.log(`${INFO} Auth: authenticated (token ${authToken.slice(0, 8)}…)`);
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) h['Authorization'] = `Bearer ${authToken}`;
  return h;
}

// ─── Helpers ───

function expectAllowed(label: string, command: string, execSync: Function) {
  try {
    const result = execSync(command, { encoding: 'utf-8', timeout: 15000 }) as string;
    console.log(`  ${PASS} ${label}: allowed (${result.length} bytes)`);
    passed++;
  } catch (err) {
    console.log(`  ${FAIL} ${label}: expected ALLOWED but got error`);
    console.log(`  ${DIM}${(err as Error).message.slice(0, 250)}${RESET}`);
    failed++;
  }
}

function expectBlocked(label: string, command: string, execSync: Function) {
  try {
    const result = execSync(command, { encoding: 'utf-8', timeout: 15000 }) as string;
    console.log(`  ${FAIL} ${label}: expected BLOCKED but got output (${result.length} bytes)`);
    console.log(`  ${DIM}Preview: ${result.slice(0, 120).replace(/\n/g, '\\n')}${RESET}`);
    failed++;
  } catch (err) {
    const msg = (err as Error).message || '';
    const isProxy = msg.includes('403') || msg.includes('Forbidden');
    const isPolicy = msg.includes('denied by policy') || msg.includes('PolicyDenied');
    const reason = isPolicy ? 'command policy' : isProxy ? 'proxy URL policy' : 'blocked';
    console.log(`  ${PASS} ${label}: ${reason}`);
    passed++;
  }
}

async function setPolicies(policies: Record<string, unknown>[], label: string): Promise<void> {
  const getRes = await fetch(`${DAEMON_URL}/api/config`, { headers: authHeaders() });
  const current = await getRes.json() as { data: Record<string, unknown> };
  const config = current.data;

  const putRes = await fetch(`${DAEMON_URL}/api/config`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ ...config, policies }),
  });

  if (!putRes.ok) {
    throw new Error(`Failed to set policies: ${putRes.status} ${await putRes.text()}`);
  }

  console.log(`\n${DIM}  Policies: ${label} (${policies.length} rules)${RESET}`);
  for (const p of policies) {
    const scope = p['scope'] ? ` scope=${p['scope']}` : '';
    const net = p['networkAccess'] ? ` net=${p['networkAccess']}` : '';
    console.log(`${DIM}    [${p['target']}] ${p['action']} "${(p['patterns'] as string[]).join(', ')}"${scope}${net}${RESET}`);
  }

  // Brief pause for config to propagate
  await new Promise(r => setTimeout(r, 300));
}

// ─── Policy sets ───

const BASE_CMD_POLICIES = [
  {
    id: 'test-gog-cmd',
    name: 'Allow gog command',
    action: 'allow',
    target: 'command',
    patterns: ['gog:*', '/tmp/gog:*'],
    enabled: true,
    priority: 100,
    networkAccess: 'proxy',
  },
  {
    id: 'test-curl-cmd',
    name: 'Allow curl command',
    action: 'allow',
    target: 'command',
    patterns: ['curl:*'],
    enabled: true,
    priority: 100,
  },
];

// ─── Setup ───

const GOG_SCRIPT = '/tmp/gog';
fs.writeFileSync(GOG_SCRIPT, `#!/bin/bash\ncurl -s --max-time 8 "$1"\n`, { mode: 0o755 });

/* eslint-disable @typescript-eslint/no-require-imports */
const { installInterceptors } = require('../libs/shield-interceptor/src/installer.js');
installInterceptors({
  httpPort: DAEMON_PORT,
  interceptFetch: false,
  interceptHttp: false,
  interceptWs: false,
  interceptFs: false,
  interceptExec: true,
  logLevel: 'info',
  enableSeatbelt: true,
  failOpen: false,
});
const { execSync } = require('node:child_process');

// ─── Test rounds ───

async function runRound(
  name: string,
  policies: Record<string, unknown>[],
  policyLabel: string,
  tests: Array<{ label: string; command: string; expect: 'allowed' | 'blocked' }>
) {
  round++;
  console.log(`\n${SECTION}${'═'.repeat(60)}${RESET}`);
  console.log(`${SECTION}  ROUND ${round}: ${name}${RESET}`);
  console.log(`${SECTION}${'═'.repeat(60)}${RESET}`);

  await setPolicies(policies, policyLabel);

  for (const t of tests) {
    if (t.expect === 'allowed') {
      expectAllowed(t.label, t.command, execSync);
    } else {
      expectBlocked(t.label, t.command, execSync);
    }
  }
}

(async () => {
  console.log('=== AgenShield Policy Lifecycle Test ===');
  console.log(`Platform: ${process.platform} | Node: ${process.version} | Daemon: ${DAEMON_URL}`);
  console.log(`Test script: ${GOG_SCRIPT}`);

  await authenticate();

  // ─── Round 1: gog allowed, google OK, facebook DENIED (scoped) ───
  await runRound(
    'gog→google ALLOW, gog→facebook DENY (scoped)',
    [
      ...BASE_CMD_POLICIES,
      {
        id: 'url-allow-google',
        name: 'gog: allow google.com',
        action: 'allow',
        target: 'url',
        patterns: ['google.com'],
        enabled: true,
        priority: 200,
        scope: 'command:gog',
      },
      {
        id: 'url-deny-facebook',
        name: 'gog: deny facebook.com',
        action: 'deny',
        target: 'url',
        patterns: ['facebook.com'],
        enabled: true,
        priority: 200,
        scope: 'command:gog',
      },
    ],
    'gog: allow google, deny facebook',
    [
      { label: 'gog→google.com',    command: '/tmp/gog https://www.google.com',   expect: 'allowed' },
      { label: 'gog→facebook.com',  command: '/tmp/gog https://www.facebook.com', expect: 'blocked' },
      { label: 'curl→facebook.com', command: 'curl -s --max-time 10 https://www.facebook.com', expect: 'allowed' },
      { label: 'curl→google.com',   command: 'curl -s --max-time 10 https://www.google.com',   expect: 'allowed' },
    ]
  );

  // ─── Round 2: FLIP — google DENIED, facebook ALLOWED ───
  await runRound(
    'FLIP: gog→google DENY, gog→facebook ALLOW',
    [
      ...BASE_CMD_POLICIES,
      {
        id: 'url-deny-google',
        name: 'gog: deny google.com',
        action: 'deny',
        target: 'url',
        patterns: ['google.com'],
        enabled: true,
        priority: 200,
        scope: 'command:gog',
      },
      {
        id: 'url-allow-facebook',
        name: 'gog: allow facebook.com',
        action: 'allow',
        target: 'url',
        patterns: ['facebook.com'],
        enabled: true,
        priority: 200,
        scope: 'command:gog',
      },
    ],
    'FLIPPED: gog: deny google, allow facebook',
    [
      { label: 'gog→google.com',    command: '/tmp/gog https://www.google.com',   expect: 'blocked' },
      { label: 'gog→facebook.com',  command: '/tmp/gog https://www.facebook.com', expect: 'allowed' },
      { label: 'curl→google.com',   command: 'curl -s --max-time 10 https://www.google.com', expect: 'allowed' },
    ]
  );

  // ─── Round 3: No URL policies — proxy passthrough ───
  await runRound(
    'No URL policies — proxy passthrough (all allowed)',
    [
      ...BASE_CMD_POLICIES,
    ],
    'commands only, no URL restrictions',
    [
      { label: 'gog→google.com',    command: '/tmp/gog https://www.google.com',   expect: 'allowed' },
      { label: 'gog→facebook.com',  command: '/tmp/gog https://www.facebook.com', expect: 'allowed' },
      { label: 'curl→facebook.com', command: 'curl -s --max-time 10 https://www.facebook.com', expect: 'allowed' },
    ]
  );

  // ─── Round 4: gog command DENIED — command policy blocks execution ───
  await runRound(
    'gog command DENIED — should not execute at all',
    [
      {
        id: 'test-gog-cmd-deny',
        name: 'Deny gog command',
        action: 'deny',
        target: 'command',
        patterns: ['gog:*', '/tmp/gog:*'],
        enabled: true,
        priority: 100,
      },
      BASE_CMD_POLICIES[1], // curl still allowed
    ],
    'gog DENIED, curl allowed',
    [
      { label: 'gog→google.com (cmd denied)',  command: '/tmp/gog https://www.google.com', expect: 'blocked' },
      { label: 'curl→google.com (still works)', command: 'curl -s --max-time 10 https://www.google.com', expect: 'allowed' },
    ]
  );

  // ─── Round 5: No policies at all — default-allow with sandbox ───
  // gog is NOT a known network command, so sandbox has networkAllowed=false.
  // Without a command policy granting networkAccess:'proxy', gog has no network.
  // curl IS a known network command → gets proxy → default-allow everything.
  await runRound(
    'No policies — sandbox defaults (gog=no net, curl=proxy)',
    [],
    'empty (sandbox defaults apply)',
    [
      { label: 'gog→google.com (no net)',  command: '/tmp/gog https://www.google.com',   expect: 'blocked' },
      { label: 'gog→facebook.com (no net)', command: '/tmp/gog https://www.facebook.com', expect: 'blocked' },
      { label: 'curl→google.com',   command: 'curl -s --max-time 10 https://www.google.com',   expect: 'allowed' },
      { label: 'curl→facebook.com', command: 'curl -s --max-time 10 https://www.facebook.com', expect: 'allowed' },
    ]
  );

  // ─── Summary ───
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`=== Final Summary: ${round} rounds ===`);
  console.log(`  ${PASS} Passed: ${passed}`);
  if (failed > 0) {
    console.log(`  ${FAIL} Failed: ${failed}`);
  }
  console.log('');

  // Cleanup
  try { fs.unlinkSync(GOG_SCRIPT); } catch {}

  process.exit(failed > 0 ? 1 : 0);
})();
