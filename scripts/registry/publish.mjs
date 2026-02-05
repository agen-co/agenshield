#!/usr/bin/env node

/**
 * Build and publish all packages to the local Verdaccio registry.
 *
 * Usage: node scripts/registry/publish.mjs [--skip-build]
 *
 * Expects Verdaccio to be running on localhost:4873
 * (start it with: npm run registry:start)
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '../..');
const REGISTRY_URL = 'http://localhost:4873';

const SKIP_BUILD = process.argv.includes('--skip-build');

/**
 * Packages in dependency order.
 * Each entry: [nx-project-name, dist-path-relative-to-root]
 */
const PACKAGES = [
  ['shield-ipc', 'libs/shield-ipc/dist'],
  ['shield-sandbox', 'libs/shield-sandbox/dist'],
  ['shield-broker', 'libs/shield-broker/dist'],
  ['shield-interceptor', 'libs/shield-interceptor/dist'],
  ['shield-patcher', 'libs/shield-patcher/dist'],
  ['shield-skills', 'libs/shield-skills/dist'],
  ['shield-daemon', 'libs/shield-daemon/dist'],
  ['cli', 'libs/cli/dist'],
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function exec(cmd, options = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      cwd: ROOT_DIR,
      stdio: options.stdio ?? 'pipe',
      timeout: options.timeout ?? 120_000,
    });
  } catch (err) {
    if (options.throwOnError !== false) throw err;
    return err.stderr || err.stdout || '';
  }
}

function getPackageInfo(distPath) {
  const pkgPath = resolve(ROOT_DIR, distPath, 'package.json');
  if (!existsSync(pkgPath)) return null;
  return JSON.parse(readFileSync(pkgPath, 'utf-8'));
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Check Verdaccio is running
  try {
    const res = await fetch(`${REGISTRY_URL}/-/ping`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    console.error('Error: Verdaccio is not running on', REGISTRY_URL);
    console.error('Start it with: npm run registry:start');
    process.exit(1);
  }

  // Build all packages
  if (!SKIP_BUILD) {
    console.log('Building all packages...\n');
    try {
      exec('npx nx run-many -t build --skip-nx-cache', {
        stdio: 'inherit',
        timeout: 300_000,
      });
    } catch {
      console.error('\nBuild failed. Fix errors and try again.');
      process.exit(1);
    }
    console.log('');
  } else {
    console.log('Skipping build (--skip-build).\n');
  }

  // Publish each package
  const results = [];

  for (const [project, distPath] of PACKAGES) {
    const pkg = getPackageInfo(distPath);
    if (!pkg) {
      console.error(`  [SKIP] ${project} — dist/package.json not found`);
      results.push({ project, status: 'skipped', reason: 'no dist' });
      continue;
    }

    const fullDistPath = resolve(ROOT_DIR, distPath);
    const name = pkg.name;
    const version = pkg.version;

    process.stdout.write(`  Publishing ${name}@${version}...`);

    try {
      exec(
        `npm publish "${fullDistPath}" --registry ${REGISTRY_URL} --tag test --access public`,
        { throwOnError: true }
      );
      console.log(' OK');
      results.push({ project, name, version, status: 'published' });
    } catch (err) {
      const errMsg = err.stderr || err.message || '';
      if (errMsg.includes('cannot publish over the previously published')) {
        console.log(' (already published)');
        results.push({ project, name, version, status: 'already published' });
      } else {
        console.log(' FAILED');
        console.error(`    ${errMsg.trim()}`);
        results.push({ project, name, version, status: 'failed', error: errMsg.trim() });
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  Publish Summary');
  console.log('='.repeat(60));
  console.log('');

  const maxName = Math.max(...results.map((r) => (r.name || r.project).length));

  for (const r of results) {
    const name = (r.name || r.project).padEnd(maxName + 2);
    const version = (r.version || '').padEnd(10);
    const icon = r.status === 'published' ? 'OK' : r.status === 'already published' ? 'OK' : 'FAIL';
    console.log(`  ${icon === 'OK' ? '+' : 'x'} ${name} ${version} ${r.status}`);
  }

  console.log('');

  // Print install command
  const stateFile = '/tmp/agenshield-registry.json';
  let publicUrl = REGISTRY_URL;
  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      if (state.ngrokUrl) publicUrl = state.ngrokUrl;
    } catch {
      // Ignore
    }
  }

  console.log('  Install from local registry:');
  console.log(`    npm install agenshield --registry ${REGISTRY_URL}`);
  if (publicUrl !== REGISTRY_URL) {
    console.log('');
    console.log('  Install from ngrok (remote):');
    console.log(`    npm install agenshield --registry ${publicUrl}`);
  }
  console.log('');

  // Exit with error if any package failed
  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length > 0) {
    console.error(`${failed.length} package(s) failed to publish.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
