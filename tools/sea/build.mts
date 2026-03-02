#!/usr/bin/env node --experimental-strip-types
/**
 * SEA Build Orchestrator
 *
 * Complete build pipeline for producing a Node.js Single Executable Application.
 *
 * Usage:
 *   node --experimental-strip-types tools/sea/build.mts [options]
 *
 * Options:
 *   --skip-nx       Skip Nx build step (use existing build output)
 *   --skip-ui       Skip UI build step
 *   --skip-inject   Skip postject injection (produce bundle only)
 *   --minify        Minify the bundle
 *   --platform      Target platform (default: current)
 *   --arch          Target architecture (default: current)
 *
 * Steps:
 *   1. Build all libs via Nx (unless --skip-nx)
 *   2. Build UI dashboard (unless --skip-ui)
 *   3. Run esbuild mega-bundle
 *   4. Bundle worker/interceptor separately
 *   5. Compress UI assets
 *   6. Write VERSION file
 *   7. Generate SEA blob
 *   8. Copy node binary and inject blob
 *   9. Code-sign (macOS)
 *  10. Package as .tar.gz archive
 *  11. Generate checksums
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { injectBlob as sharedInjectBlob, createArchive as sharedCreateArchive, getVersion as sharedGetVersion } from './shared/build-helpers.mts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DIST_SEA = path.join(ROOT, 'dist', 'sea');
const ASSETS_DIR = path.join(DIST_SEA, 'assets');

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string, label: string, opts?: { cwd?: string; timeout?: number }): void {
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`[STEP] ${label}`);
  console.log(`[CMD]  ${cmd}`);
  console.log(`[${'='.repeat(60)}]\n`);

  execSync(cmd, {
    cwd: opts?.cwd ?? ROOT,
    stdio: 'inherit',
    timeout: opts?.timeout ?? 300_000,
    env: {
      ...process.env,
      FORCE_COLOR: '1',
    },
  });
}

function getVersion(): string {
  const pkgPath = path.join(ROOT, 'libs', 'cli', 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
}

function getBinaryName(): string {
  return flags.platform === 'win32' ? 'agenshield.exe' : 'agenshield';
}

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

async function step3_esbuildBundles(): Promise<void> {
  const minifyFlag = flags.minify ? '--minify' : '';
  run(
    `npx tsx tools/sea/esbuild.config.mts ${minifyFlag}`,
    'Run esbuild mega-bundle + worker + interceptor',
  );
}

async function step4_compressUIAssets(): Promise<void> {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  const uiDistPath = path.join(ROOT, 'dist', 'apps', 'shield-ui');
  const tarPath = path.join(ASSETS_DIR, 'ui-assets.tar.gz');

  if (!fs.existsSync(uiDistPath)) {
    console.log('[WARN] UI build output not found, creating empty placeholder');
    // Create a minimal placeholder so the SEA config doesn't fail
    fs.writeFileSync(tarPath, Buffer.alloc(0));
    return;
  }

  run(
    `tar -czf "${tarPath}" -C "${uiDistPath}" .`,
    'Compress UI assets',
  );
}

async function step5_writeVersion(): Promise<void> {
  const version = getVersion();
  const versionPath = path.join(DIST_SEA, 'VERSION');
  fs.writeFileSync(versionPath, version + '\n');
  console.log(`[VERSION] ${version} → ${versionPath}`);
}

async function step6_generateBlob(): Promise<void> {
  if (flags.skipInject) {
    console.log('[SKIP] SEA blob generation (--skip-inject)');
    return;
  }

  const seaConfigPath = path.join(ROOT, 'tools', 'sea', 'sea-config.json');
  run(
    `node --experimental-sea-config "${seaConfigPath}"`,
    'Generate SEA blob',
  );
}

async function step7_injectBlob(): Promise<void> {
  if (flags.skipInject) {
    console.log('[SKIP] Blob injection (--skip-inject)');
    return;
  }

  const binaryName = getBinaryName();
  const binaryPath = path.join(DIST_SEA, binaryName);
  const blobPath = path.join(DIST_SEA, 'sea-prep.blob');

  sharedInjectBlob({
    binaryPath,
    blobPath,
    platform: flags.platform,
    codesignIdentity: flags.codesignIdentity,
    entitlementsPath: flags.entitlements,
  });
}

async function step8_package(): Promise<void> {
  if (flags.skipInject) {
    console.log('[SKIP] Packaging (--skip-inject)');
    return;
  }

  const version = getVersion();
  const binaryName = getBinaryName();
  const binaryPath = path.join(DIST_SEA, binaryName);

  if (!fs.existsSync(binaryPath)) {
    console.log('[SKIP] Binary not found, skipping packaging');
    return;
  }

  // Create a staging directory for the archive
  const stagingDir = path.join(DIST_SEA, 'staging');
  fs.mkdirSync(stagingDir, { recursive: true });

  // Copy binary
  fs.copyFileSync(binaryPath, path.join(stagingDir, binaryName));
  fs.chmodSync(path.join(stagingDir, binaryName), 0o755);

  // Copy native modules directory (better_sqlite3.node)
  const nativeDir = path.join(stagingDir, 'native');
  fs.mkdirSync(nativeDir, { recursive: true });

  // Look for the built native module
  const nativeSearchPaths = [
    path.join(ROOT, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
    path.join(ROOT, 'node_modules/better-sqlite3/prebuilds', `${flags.platform}-${flags.arch}`, 'better_sqlite3.node'),
  ];

  let nativeFound = false;
  for (const searchPath of nativeSearchPaths) {
    if (fs.existsSync(searchPath)) {
      fs.copyFileSync(searchPath, path.join(nativeDir, 'better_sqlite3.node'));
      nativeFound = true;
      console.log(`[NATIVE] Copied better_sqlite3.node from ${searchPath}`);
      break;
    }
  }

  if (!nativeFound) {
    console.log('[WARN] better_sqlite3.node not found — binary will need it installed separately');
  }

  // Create archive
  const archiveName = `agenshield-${version}-${flags.platform}-${flags.arch}.tar.gz`;
  const archivePath = path.join(DIST_SEA, archiveName);

  run(
    `tar -czf "${archivePath}" -C "${stagingDir}" .`,
    `Package archive: ${archiveName}`,
  );

  // Generate checksum
  const checksumPath = path.join(DIST_SEA, 'checksums.sha256');
  const checksum = execSync(`shasum -a 256 "${archivePath}"`, { encoding: 'utf-8' }).trim();
  fs.appendFileSync(checksumPath, checksum + '\n');
  console.log(`[CHECKSUM] ${checksum}`);

  // Clean up staging
  fs.rmSync(stagingDir, { recursive: true, force: true });

  console.log(`\n[DONE] Archive: ${archivePath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('==============================================================');
  console.log(' AgenShield SEA Build');
  console.log(`  Platform: ${flags.platform}/${flags.arch}`);
  console.log(`  Version:  ${getVersion()}`);
  console.log(`  Options:  ${JSON.stringify(flags, null, 2)}`);
  console.log('==============================================================');

  const start = Date.now();

  await step1_buildLibs();
  await step2_buildUI();
  await step3_esbuildBundles();
  await step4_compressUIAssets();
  await step5_writeVersion();
  await step6_generateBlob();
  await step7_injectBlob();
  await step8_package();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n[COMPLETE] Build finished in ${elapsed}s`);
}

main().catch((err) => {
  console.error('\n[FATAL] Build failed:', err);
  process.exit(1);
});
