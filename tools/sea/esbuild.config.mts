/**
 * esbuild Mega-Bundle Configuration for SEA
 *
 * Bundles ALL workspace packages into a single CJS file suitable for
 * Node.js Single Executable Applications. Also produces separate bundles
 * for the worker thread and interceptor hooks.
 */

import * as esbuild from 'esbuild';
import * as path from 'node:path';
import * as fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT_DIR = path.join(ROOT, 'dist', 'sea');

// Path aliases matching tsconfig.base.json
const ALIASES: Record<string, string> = {
  'agenshield': path.join(ROOT, 'libs/cli/src/index.ts'),
  '@agenshield/ipc': path.join(ROOT, 'libs/shield-ipc/src/index.ts'),
  '@agenshield/daemon': path.join(ROOT, 'libs/shield-daemon/src/index.ts'),
  '@agenshield/daemon/auth': path.join(ROOT, 'libs/shield-daemon/src/auth/index.ts'),
  '@agenshield/daemon/vault': path.join(ROOT, 'libs/shield-daemon/src/vault/index.ts'),
  '@agenshield/sandbox': path.join(ROOT, 'libs/sandbox/src/index.ts'),
  '@agenshield/broker': path.join(ROOT, 'libs/shield-broker/src/index.ts'),
  '@agenshield/interceptor': path.join(ROOT, 'libs/shield-interceptor/src/index.ts'),
  '@agenshield/patcher': path.join(ROOT, 'libs/shield-patcher/src/index.ts'),
  '@agenshield/integrations': path.join(ROOT, 'libs/shield-integrations/src/index.ts'),
  '@agenshield/storage': path.join(ROOT, 'libs/storage/src/index.ts'),
  '@agentshield/skills': path.join(ROOT, 'libs/skills/src/index.ts'),
  '@agenshield/policies': path.join(ROOT, 'libs/policies/src/index.ts'),
  '@agenshield/seatbelt': path.join(ROOT, 'libs/seatbelt/src/index.ts'),
  '@agenshield/auth': path.join(ROOT, 'libs/auth/src/index.ts'),
};

/**
 * esbuild plugin to resolve workspace aliases to source paths
 */
function aliasPlugin(): esbuild.Plugin {
  return {
    name: 'workspace-aliases',
    setup(build) {
      // Sort aliases by length descending so more specific paths match first
      const sortedAliases = Object.entries(ALIASES).sort(
        ([a], [b]) => b.length - a.length,
      );

      build.onResolve({ filter: /^@?agenshield/ }, (args) => {
        for (const [alias, target] of sortedAliases) {
          if (args.path === alias) {
            return { path: target };
          }
          // Handle sub-path imports like @agenshield/daemon/auth
          if (args.path.startsWith(alias + '/')) {
            const subPath = args.path.slice(alias.length);
            const dir = path.dirname(target);
            return { path: path.join(dir, subPath) };
          }
        }
        // Also handle @agentshield (typo in skills)
        for (const [alias, target] of sortedAliases) {
          if (args.path === alias) {
            return { path: target };
          }
        }
        return undefined;
      });
    },
  };
}

/**
 * Plugin to handle .js/.mjs imports that should resolve to .ts source
 */
function tsExtensionPlugin(): esbuild.Plugin {
  return {
    name: 'ts-extension-resolver',
    setup(build) {
      build.onResolve({ filter: /\.js$/ }, (args) => {
        if (args.kind !== 'import-statement' && args.kind !== 'require-call') return;
        // Only rewrite local/relative imports
        if (!args.path.startsWith('.')) return;

        const dir = args.resolveDir;
        const tsPath = path.resolve(dir, args.path.replace(/\.js$/, '.ts'));
        const tsxPath = path.resolve(dir, args.path.replace(/\.js$/, '.tsx'));

        if (fs.existsSync(tsPath)) {
          return { path: tsPath };
        }
        if (fs.existsSync(tsxPath)) {
          return { path: tsxPath };
        }
        return undefined;
      });
    },
  };
}

/**
 * Plugin to replace import.meta.url with a CJS-compatible equivalent
 */
function importMetaPlugin(): esbuild.Plugin {
  return {
    name: 'import-meta-url',
    setup(build) {
      build.onLoad({ filter: /\.tsx?$/ }, async (args) => {
        let contents = await fs.promises.readFile(args.path, 'utf8');

        // Replace import.meta.url with a file:// URL from __filename
        if (contents.includes('import.meta.url')) {
          contents = contents.replace(
            /import\.meta\.url/g,
            '(typeof __filename !== "undefined" ? require("url").pathToFileURL(__filename).href : "")',
          );
          return { contents, loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts' };
        }
        return undefined;
      });
    },
  };
}

// Native modules that cannot be bundled
const EXTERNAL = [
  'better-sqlite3',
];

// Node.js built-in modules to keep external
const NODE_BUILTINS = [
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2',
  'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'repl', 'sea', 'stream',
  'string_decoder', 'sys', 'timers', 'tls', 'tty', 'url', 'util',
  'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
].flatMap(m => [m, `node:${m}`]);

export interface BuildOptions {
  minify?: boolean;
  sourcemap?: boolean;
}

/**
 * Build the main SEA bundle (entry point → agenshield.cjs)
 */
export async function buildMainBundle(opts: BuildOptions = {}): Promise<void> {
  console.log('[esbuild] Building main SEA bundle...');

  await esbuild.build({
    entryPoints: [path.join(ROOT, 'tools/sea/entry.ts')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    outfile: path.join(OUT_DIR, 'agenshield.cjs'),
    external: [...EXTERNAL, ...NODE_BUILTINS],
    plugins: [aliasPlugin(), tsExtensionPlugin(), importMetaPlugin()],
    treeShaking: true,
    minify: opts.minify ?? false,
    sourcemap: opts.sourcemap ?? false,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    banner: {
      js: '// AgenShield SEA Bundle — generated by tools/sea/esbuild.config.mts\n',
    },
    logLevel: 'info',
  });

  console.log('[esbuild] Main bundle complete: dist/sea/agenshield.cjs');
}

/**
 * Build the system command worker bundle (runs in a Worker thread)
 */
export async function buildWorkerBundle(opts: BuildOptions = {}): Promise<void> {
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
    minify: opts.minify ?? false,
    logLevel: 'info',
  });

  console.log('[esbuild] Worker bundle complete: dist/sea/workers/system-command.worker.js');
}

/**
 * Build the interceptor register scripts (CJS and ESM hooks)
 */
export async function buildInterceptorBundles(opts: BuildOptions = {}): Promise<void> {
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
    minify: opts.minify ?? false,
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
    minify: opts.minify ?? false,
    logLevel: 'info',
  });

  console.log('[esbuild] Interceptor bundles complete: dist/sea/interceptor/');
}

/**
 * Build all bundles
 */
export async function buildAll(opts: BuildOptions = {}): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await Promise.all([
    buildMainBundle(opts),
    buildWorkerBundle(opts),
    buildInterceptorBundles(opts),
  ]);
}

// Run directly when invoked as a script
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('esbuild.config.mts')) {
  buildAll({ minify: process.argv.includes('--minify') })
    .then(() => console.log('[esbuild] All bundles complete'))
    .catch((err) => {
      console.error('[esbuild] Build failed:', err);
      process.exit(1);
    });
}
