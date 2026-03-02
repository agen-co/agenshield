/**
 * Shared SEA build helpers.
 *
 * Functions for SEA blob generation, postject injection, code signing,
 * and archive packaging — shared across all binary app builds.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { ROOT, DIST_SEA } from './constants.mts';

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

export function getVersion(): string {
  const pkgPath = path.join(ROOT, 'libs', 'cli', 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
}

// ---------------------------------------------------------------------------
// SEA blob generation
// ---------------------------------------------------------------------------

/**
 * Generate a SEA blob from a sea-config.json file.
 */
export function generateSEABlob(seaConfigPath: string): void {
  run(
    `node --experimental-sea-config "${seaConfigPath}"`,
    `Generate SEA blob from ${path.basename(seaConfigPath)}`,
  );
}

// ---------------------------------------------------------------------------
// Blob injection
// ---------------------------------------------------------------------------

export interface InjectOptions {
  binaryPath: string;
  blobPath: string;
  platform?: string;
  /** Code signing identity (e.g. "Developer ID Application: ..."). When absent, ad-hoc signing is used. */
  codesignIdentity?: string;
  /** Path to entitlements.plist for hardened runtime. Used with both real and ad-hoc signing. */
  entitlementsPath?: string;
}

/**
 * Copy the Node binary, remove existing signature, inject SEA blob, re-sign.
 *
 * Signing modes:
 * - No identity → `codesign --sign - --options runtime --entitlements` (ad-hoc with hardened runtime)
 * - Identity provided → `codesign --sign "Developer ID..." --timestamp --options runtime --entitlements`
 */
export function injectBlob(opts: InjectOptions): void {
  const { binaryPath, blobPath, platform = os.platform(), codesignIdentity, entitlementsPath } = opts;

  // Copy the node binary
  const nodePath = process.execPath;
  console.log(`[COPY] ${nodePath} → ${binaryPath}`);
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.copyFileSync(nodePath, binaryPath);
  fs.chmodSync(binaryPath, 0o755);

  // macOS: remove existing code signature before injection
  if (platform === 'darwin') {
    try {
      run(
        `codesign --remove-signature "${binaryPath}"`,
        'Remove existing code signature (macOS)',
      );
    } catch {
      console.log('[WARN] codesign --remove-signature failed (may not be signed)');
    }
  }

  // Inject the blob using postject
  const machoFlag = platform === 'darwin' ? '--macho-segment-name NODE_SEA' : '';

  run(
    `npx postject "${binaryPath}" NODE_SEA_BLOB "${blobPath}" ` +
    `--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 ` +
    machoFlag,
    'Inject SEA blob into binary',
  );

  // macOS: code signing
  if (platform === 'darwin') {
    codesignBinary(binaryPath, codesignIdentity, entitlementsPath);
  }

  // Post-injection validation: ensure binary runs
  validateBinary(binaryPath);
}

/**
 * Sign a binary with the given identity, or ad-hoc if none provided.
 * Both modes use hardened runtime + entitlements (required for macOS Sequoia).
 */
export function codesignBinary(
  binaryPath: string,
  identity?: string,
  entitlementsPath?: string,
): void {
  if (identity) {
    const entitlementFlag = entitlementsPath ? ` --entitlements "${entitlementsPath}"` : '';
    run(
      `codesign --force --sign "${identity}" --timestamp --options runtime${entitlementFlag} "${binaryPath}"`,
      `Code signing with identity: ${identity.slice(0, 40)}...`,
    );
  } else {
    const defaultEntitlements = path.join(ROOT, 'tools', 'sea', 'entitlements.plist');
    const resolvedEntitlements = entitlementsPath ?? defaultEntitlements;
    if (fs.existsSync(resolvedEntitlements)) {
      run(
        `codesign --force --sign - --options runtime --entitlements "${resolvedEntitlements}" "${binaryPath}"`,
        'Ad-hoc code signing with hardened runtime (macOS)',
      );
    } else {
      console.log('[WARN] Entitlements plist not found — falling back to plain ad-hoc signing');
      run(
        `codesign --force --sign - "${binaryPath}"`,
        'Ad-hoc code signing (macOS)',
      );
    }
  }
}

/**
 * Post-injection validation: run the binary with --version to ensure it works.
 */
function validateBinary(binaryPath: string): void {
  try {
    const output = execSync(`"${binaryPath}" --version`, {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    console.log(`[VALIDATE] ${path.basename(binaryPath)} --version → ${output}`);
  } catch (err) {
    console.log(`[WARN] Post-injection validation failed for ${path.basename(binaryPath)}: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Write VERSION file
// ---------------------------------------------------------------------------

/**
 * Write the VERSION file to a given output directory.
 */
export function writeVersionFile(outDir: string): string {
  const version = getVersion();
  const versionPath = path.join(outDir, 'VERSION');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(versionPath, version + '\n');
  console.log(`[VERSION] ${version} → ${versionPath}`);
  return version;
}

// ---------------------------------------------------------------------------
// Packaging
// ---------------------------------------------------------------------------

export interface PackageOptions {
  /** Paths to the final binaries (e.g. agenshield, agenshield-daemon, agenshield-broker) */
  binaries: { name: string; path: string }[];
  /** Platform (darwin, linux) */
  platform?: string;
  /** Architecture (arm64, x64) */
  arch?: string;
  /** Output directory for the archive */
  outDir?: string;
  /** Code signing identity for .node native modules on macOS */
  codesignIdentity?: string;
  /** Path to entitlements.plist */
  entitlementsPath?: string;
}

/**
 * Create a platform archive (.tar.gz) with all binaries and lib assets.
 */
export function createArchive(opts: PackageOptions): string {
  const platform = opts.platform ?? os.platform();
  const arch = opts.arch ?? os.arch();
  const outDir = opts.outDir ?? DIST_SEA;
  const version = getVersion();

  // Create a staging directory
  const stagingDir = path.join(outDir, 'staging');
  fs.mkdirSync(stagingDir, { recursive: true });

  // Copy binaries
  for (const bin of opts.binaries) {
    if (fs.existsSync(bin.path)) {
      fs.copyFileSync(bin.path, path.join(stagingDir, bin.name));
      fs.chmodSync(path.join(stagingDir, bin.name), 0o755);
      console.log(`[STAGE] ${bin.name}`);
    } else {
      console.log(`[WARN] Binary not found: ${bin.path}`);
    }
  }

  // Copy native modules
  const nativeDir = path.join(stagingDir, 'native');
  fs.mkdirSync(nativeDir, { recursive: true });

  const nativeSearchPaths = [
    path.join(ROOT, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
    path.join(ROOT, 'node_modules/better-sqlite3/prebuilds', `${platform}-${arch}`, 'better_sqlite3.node'),
  ];

  let nativeFound = false;
  for (const searchPath of nativeSearchPaths) {
    if (fs.existsSync(searchPath)) {
      const destPath = path.join(nativeDir, 'better_sqlite3.node');
      fs.copyFileSync(searchPath, destPath);
      nativeFound = true;
      console.log(`[NATIVE] Copied better_sqlite3.node from ${searchPath}`);

      // Sign .node native modules when a real signing identity is provided
      if (platform === 'darwin' && opts.codesignIdentity) {
        codesignBinary(destPath, opts.codesignIdentity, opts.entitlementsPath);
      }
      break;
    }
  }
  if (!nativeFound) {
    console.log('[WARN] better_sqlite3.node not found');
  }

  // Copy worker and interceptor from daemon build output (if exists)
  const daemonDistDir = path.join(outDir, 'apps', 'daemon-bin');
  for (const subDir of ['workers', 'interceptor', 'client']) {
    const srcDir = path.join(daemonDistDir, subDir);
    if (fs.existsSync(srcDir)) {
      const destDir = path.join(stagingDir, subDir);
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      }
      console.log(`[STAGE] ${subDir}/`);
    }
  }

  // Copy UI assets if they exist
  const uiAssetsDir = path.join(ROOT, 'dist', 'apps', 'shield-ui');
  if (fs.existsSync(uiAssetsDir)) {
    const destUiDir = path.join(stagingDir, 'ui-assets');
    fs.mkdirSync(destUiDir, { recursive: true });
    execSync(`cp -R "${uiAssetsDir}/." "${destUiDir}/"`, { stdio: 'pipe' });
    console.log('[STAGE] ui-assets/');
  }

  // Create archive
  const archiveName = `agenshield-${version}-${platform}-${arch}.tar.gz`;
  const archivePath = path.join(outDir, archiveName);

  run(
    `tar -czf "${archivePath}" -C "${stagingDir}" .`,
    `Package archive: ${archiveName}`,
  );

  // Generate checksum
  const checksumPath = path.join(outDir, 'checksums.sha256');
  const checksum = execSync(`shasum -a 256 "${archivePath}"`, { encoding: 'utf-8' }).trim();
  fs.appendFileSync(checksumPath, checksum + '\n');
  console.log(`[CHECKSUM] ${checksum}`);

  // Clean up staging
  fs.rmSync(stagingDir, { recursive: true, force: true });

  console.log(`\n[DONE] Archive: ${archivePath}`);
  return archivePath;
}

// ---------------------------------------------------------------------------
// Compress UI assets
// ---------------------------------------------------------------------------

/**
 * Compress UI assets into a tar.gz for SEA embedding.
 */
export function compressUIAssets(outDir: string): string {
  const assetsDir = path.join(outDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const uiDistPath = path.join(ROOT, 'dist', 'apps', 'shield-ui');
  const tarPath = path.join(assetsDir, 'ui-assets.tar.gz');

  if (!fs.existsSync(uiDistPath)) {
    console.log('[WARN] UI build output not found, creating empty placeholder');
    fs.writeFileSync(tarPath, Buffer.alloc(0));
    return tarPath;
  }

  run(
    `tar -czf "${tarPath}" -C "${uiDistPath}" .`,
    'Compress UI assets',
  );

  return tarPath;
}
