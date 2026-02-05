#!/usr/bin/env node

/**
 * Start local Verdaccio registry + ngrok tunnel.
 *
 * Usage: node scripts/registry/start.mjs
 *
 * Requires:
 *   - NGROK_AUTHTOKEN env var for ngrok tunnel
 *   - verdaccio and @ngrok/ngrok installed as devDependencies
 */

import { execSync, spawn } from 'node:child_process';
import { writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, 'verdaccio-config.yaml');
const STATE_FILE = '/tmp/agenshield-registry.json';
const VERDACCIO_PORT = 4873;
const VERDACCIO_URL = `http://localhost:${VERDACCIO_PORT}`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForVerdaccio(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${VERDACCIO_URL}/-/ping`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return true;
    } catch {
      // Not ready yet
    }
    await sleep(500);
  }
  return false;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Check for NGROK_AUTHTOKEN
  if (!process.env.NGROK_AUTHTOKEN) {
    console.error('Error: NGROK_AUTHTOKEN environment variable is required.');
    console.error('Get your token at https://dashboard.ngrok.com/get-started/your-authtoken');
    process.exit(1);
  }

  // Clean up previous storage for a fresh registry
  const storagePath = resolve(__dirname, '.verdaccio-storage');
  if (existsSync(storagePath)) {
    console.log('Cleaning previous Verdaccio storage...');
    rmSync(storagePath, { recursive: true, force: true });
  }
  const htpasswdPath = resolve(__dirname, '.verdaccio-htpasswd');
  if (existsSync(htpasswdPath)) {
    rmSync(htpasswdPath, { force: true });
  }

  // Start Verdaccio as a child process
  console.log('Starting Verdaccio on port', VERDACCIO_PORT, '...');

  const verdaccioProcess = spawn(
    'npx',
    ['verdaccio', '--config', CONFIG_PATH, '--listen', `${VERDACCIO_PORT}`],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname,
      env: { ...process.env },
    }
  );

  verdaccioProcess.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (line) console.log(`[verdaccio] ${line}`);
  });

  verdaccioProcess.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line) console.log(`[verdaccio] ${line}`);
  });

  verdaccioProcess.on('error', (err) => {
    console.error('Failed to start Verdaccio:', err.message);
    process.exit(1);
  });

  // Wait for Verdaccio to be ready
  const ready = await waitForVerdaccio();
  if (!ready) {
    console.error('Verdaccio failed to start within 30 seconds.');
    verdaccioProcess.kill();
    process.exit(1);
  }

  console.log('Verdaccio is ready.');

  // Start ngrok tunnel
  console.log('Starting ngrok tunnel...');
  let ngrokUrl;

  try {
    const ngrok = await import('@ngrok/ngrok');
    const listener = await ngrok.forward({
      addr: VERDACCIO_PORT,
      authtoken_from_env: true,
    });
    ngrokUrl = listener.url();
    console.log('ngrok tunnel established.');
  } catch (err) {
    console.error('Failed to start ngrok tunnel:', err.message);
    verdaccioProcess.kill();
    process.exit(1);
  }

  // Write state file for stop script
  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        pid: verdaccioProcess.pid,
        ngrokUrl,
        localUrl: VERDACCIO_URL,
        startedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('  AgenShield Local Registry');
  console.log('='.repeat(60));
  console.log(`  Local:   ${VERDACCIO_URL}`);
  console.log(`  Public:  ${ngrokUrl}`);
  console.log(`  Web UI:  ${VERDACCIO_URL}`);
  console.log('');
  console.log('  Publish packages:');
  console.log('    npm run registry:publish');
  console.log('');
  console.log('  Test from another machine:');
  console.log(`    npm install agenshield --registry ${ngrokUrl}`);
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('='.repeat(60) + '\n');

  // Handle graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    verdaccioProcess.kill();
    try {
      rmSync(STATE_FILE, { force: true });
    } catch {
      // Ignore
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep alive — verdaccio runs as child process
  verdaccioProcess.on('exit', (code) => {
    console.log(`Verdaccio exited with code ${code}`);
    try {
      rmSync(STATE_FILE, { force: true });
    } catch {
      // Ignore
    }
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
