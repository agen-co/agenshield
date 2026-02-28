/**
 * esbuild config for the Broker SEA binary.
 *
 * Produces a single CJS bundle: agenshield-broker.cjs
 */

import * as esbuild from 'esbuild';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ROOT } from '../../tools/sea/shared/constants.mts';
import { EXTERNAL, NODE_BUILTINS } from '../../tools/sea/shared/constants.mts';
import { aliasPlugin, tsExtensionPlugin, importMetaPlugin, nativeBindingsPlugin, IMPORT_META_BANNER } from '../../tools/sea/shared/esbuild-plugins.mts';
import { writeVersionFile } from '../../tools/sea/shared/build-helpers.mts';

const OUT_DIR = path.join(ROOT, 'dist', 'sea', 'apps', 'broker-bin');

const minify = process.argv.includes('--minify');

async function build(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('[esbuild] Building broker bundle...');

  await esbuild.build({
    entryPoints: [path.join(ROOT, 'apps/broker-bin/src/main.ts')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    outfile: path.join(OUT_DIR, 'agenshield-broker.cjs'),
    external: [...EXTERNAL, ...NODE_BUILTINS],
    plugins: [aliasPlugin(), tsExtensionPlugin(), importMetaPlugin(), nativeBindingsPlugin()],
    treeShaking: true,
    minify,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    banner: {
      js: `// AgenShield Broker SEA Bundle\n${IMPORT_META_BANNER}\n`,
    },
    logLevel: 'info',
  });

  // Write VERSION file to dist/sea/ (shared across all binaries)
  writeVersionFile(path.join(ROOT, 'dist', 'sea'));

  console.log('[esbuild] Broker bundle complete');
}

build().catch((err) => {
  console.error('[esbuild] Build failed:', err);
  process.exit(1);
});
