#!/usr/bin/env node --experimental-strip-types
/**
 * Multi-Binary SEA Build Orchestrator
 *
 * Builds all 3 AgenShield SEA binaries: CLI, Daemon, Broker.
 *
 * Usage:
 *   node --experimental-strip-types tools/sea/build-all.mts [options]
 *
 * Options:
 *   --skip-nx       Skip Nx library build step
 *   --skip-ui       Skip UI build step
 *   --skip-inject   Skip postject injection (produce bundles only)
 *   --minify        Minify all bundles
 *   --platform      Target platform (default: current)
 *   --arch          Target architecture (default: current)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { ROOT, DIST_SEA } from './shared/constants.mts';
import {
  getVersion,
  writeVersionFile,
  compressUIAssets,
  generateSEABlob,
  injectBlob,
  createArchive,
} from './shared/build-helpers.mts';

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = {
  skipNx: argv.includes('--skip-nx'),
  skipUi: argv.includes('--skip-ui'),
  skipInject: argv.includes('--skip-inject'),
  minify: argv.includes('--minify'),
  platform: getArg('--platform') || os.platform(),
  arch: getArg('--arch') || os.arch(),
  codesignIdentity: getArg('--codesign-identity'),
  entitlements: getArg('--entitlements'),
};

function getArg(name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function run(cmd: string, label: string, opts?: { timeout?: number }): void {
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`[STEP] ${label}`);
  console.log(`[CMD]  ${cmd}`);
  console.log(`[${'='.repeat(60)}]\n`);

  execSync(cmd, {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: opts?.timeout ?? 300_000,
    env: { ...process.env, FORCE_COLOR: '1' },
  });
}

// ---------------------------------------------------------------------------
// App definitions
// ---------------------------------------------------------------------------

interface AppDef {
  name: string;
  binaryName: string;
  bundleCmd: string;
  seaConfig: string;
  outDir: string;
}

const APPS: AppDef[] = [
  {
    name: 'cli-bin',
    binaryName: flags.platform === 'win32' ? 'agenshield.exe' : 'agenshield',
    bundleCmd: `npx tsx apps/cli-bin/esbuild.config.mts${flags.minify ? ' --minify' : ''}`,
    seaConfig: path.join(ROOT, 'apps/cli-bin/sea-config.json'),
    outDir: path.join(DIST_SEA, 'apps', 'cli-bin'),
  },
  {
    name: 'daemon-bin',
    binaryName: flags.platform === 'win32' ? 'agenshield-daemon.exe' : 'agenshield-daemon',
    bundleCmd: `npx tsx apps/daemon-bin/esbuild.config.mts${flags.minify ? ' --minify' : ''}`,
    seaConfig: path.join(ROOT, 'apps/daemon-bin/sea-config.json'),
    outDir: path.join(DIST_SEA, 'apps', 'daemon-bin'),
  },
  {
    name: 'broker-bin',
    binaryName: flags.platform === 'win32' ? 'agenshield-broker.exe' : 'agenshield-broker',
    bundleCmd: `npx tsx apps/broker-bin/esbuild.config.mts${flags.minify ? ' --minify' : ''}`,
    seaConfig: path.join(ROOT, 'apps/broker-bin/sea-config.json'),
    outDir: path.join(DIST_SEA, 'apps', 'broker-bin'),
  },
];

// ---------------------------------------------------------------------------
// Build steps
// ---------------------------------------------------------------------------

async function step1_buildLibs(): Promise<void> {
  if (flags.skipNx) {
    console.log('[SKIP] Nx build (--skip-nx)');
    return;
  }
  run(
    'npx nx run-many -t build --exclude="tag:native" --parallel=5',
    'Build all libraries via Nx',
    { timeout: 600_000 },
  );
}

async function step2_buildUI(): Promise<void> {
  if (flags.skipUi) {
    console.log('[SKIP] UI build (--skip-ui)');
    return;
  }
  run('npx nx build shield-ui', 'Build UI dashboard', { timeout: 300_000 });
}

async function step2b_buildMacApp(): Promise<void> {
  if (flags.platform !== 'darwin') {
    console.log('[SKIP] macOS app build (not on darwin)');
    return;
  }

  // Clean stale build output so a failed build can't leave an old .app behind
  const macAppOut = path.join(ROOT, 'dist/apps/shield-macos/Release');
  if (fs.existsSync(macAppOut)) {
    fs.rmSync(macAppOut, { recursive: true, force: true });
    console.log('[CLEAN] Removed stale dist/apps/shield-macos/Release/');
  }

  try {
    run('npx nx build shield-macos', 'Build macOS menu bar app (Xcode)', { timeout: 600_000 });
  } catch (err) {
    // Non-fatal: Xcode build may fail if cert is not available or not on macOS
    console.log(`[WARN] macOS app build failed (non-fatal): ${(err as Error).message}`);
    console.log('[WARN] The SEA archive will not include AgenShield.app');
  }
}

async function step3_esbuildBundles(): Promise<void> {
  for (const app of APPS) {
    run(app.bundleCmd, `Bundle ${app.name}`);
  }
}

async function step4_writeVersionAndCompressUI(): Promise<void> {
  writeVersionFile(DIST_SEA);
  compressUIAssets(DIST_SEA);
}

async function step5_generateBlobsAndInject(): Promise<void> {
  if (flags.skipInject) {
    console.log('[SKIP] SEA blob generation and injection (--skip-inject)');
    return;
  }

  for (const app of APPS) {
    generateSEABlob(app.seaConfig);

    const binaryPath = path.join(app.outDir, app.binaryName);
    const blobPath = path.join(app.outDir, 'sea-prep.blob');

    injectBlob({
      binaryPath,
      blobPath,
      platform: flags.platform,
      codesignIdentity: flags.codesignIdentity,
      entitlementsPath: flags.entitlements,
    });
  }
}

async function step6_package(): Promise<void> {
  if (flags.skipInject) {
    console.log('[SKIP] Packaging (--skip-inject)');
    return;
  }

  createArchive({
    binaries: APPS.map(app => ({
      name: app.binaryName,
      path: path.join(app.outDir, app.binaryName),
    })),
    platform: flags.platform,
    arch: flags.arch,
    codesignIdentity: flags.codesignIdentity,
    entitlementsPath: flags.entitlements,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const version = getVersion();
  console.log('==============================================================');
  console.log(' AgenShield Multi-Binary SEA Build');
  console.log(`  Platform: ${flags.platform}/${flags.arch}`);
  console.log(`  Version:  ${version}`);
  console.log(`  Binaries: ${APPS.map(a => a.binaryName).join(', ')}`);
  console.log(`  Options:  ${JSON.stringify(flags, null, 2)}`);
  console.log('==============================================================');

  const start = Date.now();

  await step1_buildLibs();
  await step2_buildUI();
  await step2b_buildMacApp();
  await step3_esbuildBundles();
  await step4_writeVersionAndCompressUI();
  await step5_generateBlobsAndInject();
  await step6_package();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n[COMPLETE] Build finished in ${elapsed}s`);
}

main().catch((err) => {
  console.error('\n[FATAL] Build failed:', err);
  process.exit(1);
});
