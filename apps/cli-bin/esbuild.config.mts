/**
 * esbuild config for the CLI SEA binary.
 *
 * Produces a single CJS bundle: agenshield.cjs
 * The ink/react TLA was fixed in Phase 1 via lazy dynamic imports.
 */

import * as esbuild from 'esbuild';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ROOT } from '../../tools/sea/shared/constants.mts';
import { EXTERNAL, NODE_BUILTINS } from '../../tools/sea/shared/constants.mts';
import { aliasPlugin, tsExtensionPlugin, importMetaPlugin, nativeBindingsPlugin, IMPORT_META_BANNER } from '../../tools/sea/shared/esbuild-plugins.mts';
import { writeVersionFile } from '../../tools/sea/shared/build-helpers.mts';

const OUT_DIR = path.join(ROOT, 'dist', 'sea', 'apps', 'cli-bin');

const minify = process.argv.includes('--minify');

async function build(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('[esbuild] Building CLI bundle...');

  await esbuild.build({
    entryPoints: [path.join(ROOT, 'apps/cli-bin/src/main.ts')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    outfile: path.join(OUT_DIR, 'agenshield.cjs'),
    external: [
      ...EXTERNAL,
      ...NODE_BUILTINS,
      // ink/react ecosystem uses top-level await (WASM loading in yoga-layout)
      // which is incompatible with CJS format. Keep external — the dev TUI and
      // ink prompts are not needed in SEA binaries (readline fallbacks are used).
      'ink', 'react', 'react-devtools-core', 'yoga-layout', 'ink-text-input',
    ],
    plugins: [aliasPlugin(), tsExtensionPlugin(), importMetaPlugin(), nativeBindingsPlugin()],
    treeShaking: true,
    minify,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    banner: {
      js: `// AgenShield CLI SEA Bundle\n${IMPORT_META_BANNER}\n`,
    },
    logLevel: 'info',
  });

  // Write VERSION file to dist/sea/ (shared across all binaries)
  writeVersionFile(path.join(ROOT, 'dist', 'sea'));

  console.log('[esbuild] CLI bundle complete');
}

build().catch((err) => {
  console.error('[esbuild] Build failed:', err);
  process.exit(1);
});
