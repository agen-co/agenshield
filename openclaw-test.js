#!/usr/bin/env node
/**
 * OpenClaw Test Script
 *
 * Simulates AI agent behavior for testing AgenShield interceptors.
 * Each run cycles through different test operations.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');

// Track which test to run (persisted in a temp file)
const STATE_FILE = '/tmp/openclaw-test-state.json';

function getState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { testIndex: 0, runCount: 0 };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Test operations - each one should be blocked by the shield
const TESTS = [
  {
    name: 'execSync: node script',
    fn: () => execSync('node -e "console.log(1+1)"', { encoding: 'utf-8' })
  },
  {
    name: 'execSync: brew install',
    fn: () => execSync('brew install wget', { encoding: 'utf-8' })
  },
  {
    name: 'execSync: curl',
    fn: () => execSync('curl -s https://example.com', { encoding: 'utf-8' })
  },
  {
    name: 'execSync: git clone',
    fn: () => execSync('git clone https://github.com/test/repo /tmp/test-repo', { encoding: 'utf-8' })
  },
  {
    name: 'spawn: npm install',
    fn: () => new Promise((resolve, reject) => {
      const proc = spawn('npm', ['install', 'lodash'], { stdio: 'pipe' });
      proc.on('close', (code) => code === 0 ? resolve('OK') : reject(new Error(`Exit ${code}`)));
      proc.on('error', reject);
    })
  },
  {
    name: 'fetch: HTTP request',
    fn: async () => {
      const res = await fetch('https://api.github.com');
      return `Status: ${res.status}`;
    }
  },
  {
    name: 'http.request: HTTPS',
    fn: () => new Promise((resolve, reject) => {
      const https = require('https');
      const req = https.request('https://example.com', (res) => {
        resolve(`Status: ${res.statusCode}`);
      });
      req.on('error', reject);
      req.end();
    })
  },
  {
    name: 'fs.readFile: /etc/passwd',
    fn: () => fs.readFileSync('/etc/passwd', 'utf-8').slice(0, 50) + '...'
  }
];

async function runTest(test) {
  console.log(`\n🧪 Running: ${test.name}`);
  try {
    const result = await test.fn();
    console.log(`   ✅ SUCCESS: ${String(result).slice(0, 100)}`);
    return { success: true, result };
  } catch (error) {
    console.log(`   🛡️ BLOCKED: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  const args = process.argv.slice(2);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('   OpenClaw Test Script - Shield Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (args.includes('--all')) {
    // Run all tests
    console.log('\nRunning ALL tests...');
    const results = [];
    for (const test of TESTS) {
      results.push({ name: test.name, ...(await runTest(test)) });
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('   Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const blocked = results.filter(r => !r.success).length;
    const passed = results.filter(r => r.success).length;
    console.log(`   Blocked: ${blocked}/${results.length}`);
    console.log(`   Passed:  ${passed}/${results.length}`);

    if (blocked === results.length) {
      console.log('\n   🎉 All operations blocked! Shield is working.');
    } else {
      console.log('\n   ⚠️  Some operations passed through. Check shield config.');
    }

  } else if (args.includes('--background')) {
    // Run in background mode - cycle through tests
    const state = getState();
    const test = TESTS[state.testIndex % TESTS.length];

    console.log(`\nBackground mode - Run #${state.runCount + 1}`);
    await runTest(test);

    // Update state for next run
    saveState({
      testIndex: (state.testIndex + 1) % TESTS.length,
      runCount: state.runCount + 1
    });

  } else {
    // Interactive - run specific test
    const testNum = parseInt(args[0]);
    if (!isNaN(testNum) && testNum >= 0 && testNum < TESTS.length) {
      await runTest(TESTS[testNum]);
    } else {
      console.log('\nUsage:');
      console.log('  node openclaw-test.js --all          Run all tests');
      console.log('  node openclaw-test.js --background   Run one test (cycles)');
      console.log('  node openclaw-test.js <number>       Run specific test');
      console.log('\nAvailable tests:');
      TESTS.forEach((t, i) => console.log(`  ${i}: ${t.name}`));
    }
  }
}

main().catch(console.error);
