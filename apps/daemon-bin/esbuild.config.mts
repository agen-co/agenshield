/**
 * esbuild config for the Daemon SEA binary.
 *
 * Produces four outputs:
 *   1. Main daemon bundle → agenshield-daemon.cjs
 *   2. Worker bundle → workers/system-command.worker.js
 *   3. Interceptor bundles → interceptor/register.cjs + register.mjs
 *   4. Shield-client bundle → client/shield-client.cjs
 */

import * as esbuild from 'esbuild';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ROOT } from '../../tools/sea/shared/constants.mts';
import { EXTERNAL, NODE_BUILTINS } from '../../tools/sea/shared/constants.mts';
import { aliasPlugin, tsExtensionPlugin, importMetaPlugin, nativeBindingsPlugin, IMPORT_META_BANNER } from '../../tools/sea/shared/esbuild-plugins.mts';
import { writeVersionFile, compressUIAssets } from '../../tools/sea/shared/build-helpers.mts';

const OUT_DIR = path.join(ROOT, 'dist', 'sea', 'apps', 'daemon-bin');

const minify = process.argv.includes('--minify');

async function buildMainBundle(): Promise<void> {
  console.log('[esbuild] Building daemon main bundle...');

  await esbuild.build({
    entryPoints: [path.join(ROOT, 'apps/daemon-bin/src/main.ts')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    outfile: path.join(OUT_DIR, 'agenshield-daemon.cjs'),
    external: [...EXTERNAL, ...NODE_BUILTINS],
    plugins: [aliasPlugin(), tsExtensionPlugin(), importMetaPlugin(), nativeBindingsPlugin()],
    treeShaking: true,
    minify,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    banner: {
      js: `// AgenShield Daemon SEA Bundle\n${IMPORT_META_BANNER}\n`,
    },
    logLevel: 'info',
  });

  console.log('[esbuild] Daemon main bundle complete');
}

async function buildWorkerBundle(): Promise<void> {
  console.log('[esbuild] Building worker bundle...');

  const workersDir = path.join(OUT_DIR, 'workers');
  fs.mkdirSync(workersDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(ROOT, 'libs/shield-daemon/src/workers/system-command.worker.ts')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    outfile: path.join(workersDir, 'system-command.worker.js'),
    external: NODE_BUILTINS,
    treeShaking: true,
    minify,
    logLevel: 'info',
  });

  console.log('[esbuild] Worker bundle complete');
}

async function buildShieldClientBundle(): Promise<void> {
  console.log('[esbuild] Building shield-client bundle...');

  const clientDir = path.join(OUT_DIR, 'client');
  fs.mkdirSync(clientDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(ROOT, 'libs/shield-broker/src/client/shield-client.ts')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    outfile: path.join(clientDir, 'shield-client.cjs'),
    external: NODE_BUILTINS,
    plugins: [aliasPlugin(), tsExtensionPlugin(), importMetaPlugin()],
    treeShaking: true,
    minify,
    logLevel: 'info',
  });

  console.log('[esbuild] Shield-client bundle complete');
}

async function buildInterceptorBundles(): Promise<void> {
  console.log('[esbuild] Building interceptor bundles...');

  const interceptorDir = path.join(OUT_DIR, 'interceptor');
  fs.mkdirSync(interceptorDir, { recursive: true });

  // CJS register (--require)
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'libs/shield-interceptor/src/register.ts')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    outfile: path.join(interceptorDir, 'register.cjs'),
    external: NODE_BUILTINS,
    plugins: [aliasPlugin(), tsExtensionPlugin(), importMetaPlugin()],
    treeShaking: true,
    minify,
    logLevel: 'info',
  });

  // ESM register (--import)
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'libs/shield-interceptor/src/register.ts')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    outfile: path.join(interceptorDir, 'register.mjs'),
    external: NODE_BUILTINS,
    plugins: [aliasPlugin(), tsExtensionPlugin()],
    treeShaking: true,
    minify,
    logLevel: 'info',
  });

  console.log('[esbuild] Interceptor bundles complete');
}

async function build(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await Promise.all([
    buildMainBundle(),
    buildWorkerBundle(),
    buildInterceptorBundles(),
    buildShieldClientBundle(),
  ]);

  // Write VERSION file and compress UI assets (shared across all binaries)
  writeVersionFile(path.join(ROOT, 'dist', 'sea'));
  compressUIAssets(path.join(ROOT, 'dist', 'sea'));

  console.log('[esbuild] All daemon bundles complete');
}

build().catch((err) => {
  console.error('[esbuild] Build failed:', err);
  process.exit(1);
});
