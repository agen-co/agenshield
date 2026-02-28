/**
 * Shared esbuild plugins for SEA binary builds.
 *
 * Extracted from the original tools/sea/esbuild.config.mts.
 */

import type * as esbuild from 'esbuild';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ALIASES } from './constants.mts';

/**
 * esbuild plugin to resolve workspace aliases to source paths.
 */
export function aliasPlugin(): esbuild.Plugin {
  return {
    name: 'workspace-aliases',
    setup(build) {
      // Sort aliases by length descending so more specific paths match first
      const sortedAliases = Object.entries(ALIASES).sort(
        ([a], [b]) => b.length - a.length,
      );

      build.onResolve({ filter: /^@?agen(t?)shield/ }, (args) => {
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
        return undefined;
      });
    },
  };
}

/**
 * Plugin to handle .js/.mjs imports that should resolve to .ts source.
 */
export function tsExtensionPlugin(): esbuild.Plugin {
  return {
    name: 'ts-extension-resolver',
    setup(build) {
      build.onResolve({ filter: /\.js$/ }, (args) => {
        if (args.kind !== 'import-statement' && args.kind !== 'require-call') return;
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
 * Plugin to handle import.meta.* for CJS output.
 *
 * Uses a banner variable `__BUNDLE_FILENAME` (set once at bundle top level
 * from CJS `__filename`) to avoid naming conflicts with local variables
 * like `const require = createRequire(import.meta.url)` or
 * `const __filename = fileURLToPath(import.meta.url)`.
 *
 * IMPORTANT: When using this plugin, add the following to the esbuild
 * `banner.js` option:
 *   var __BUNDLE_FILENAME = typeof __filename !== "undefined" ? __filename : "";
 */
export function importMetaPlugin(): esbuild.Plugin {
  return {
    name: 'import-meta-url',
    setup(build) {
      build.onLoad({ filter: /\.tsx?$/ }, async (args) => {
        let contents = await fs.promises.readFile(args.path, 'utf8');

        if (!contents.includes('import.meta')) return undefined;

        // Replace import.meta.url with a CJS-compatible file URL using
        // the bundle-level __BUNDLE_FILENAME (no naming conflicts with
        // local __filename / require declarations).
        if (contents.includes('import.meta.url')) {
          contents = contents.replace(
            /import\.meta\.url/g,
            '(__BUNDLE_FILENAME ? "file://" + __BUNDLE_FILENAME : "")',
          );
        }

        // Replace import.meta.dirname with CJS __dirname
        if (contents.includes('import.meta.dirname')) {
          contents = contents.replace(
            /import\.meta\.dirname/g,
            '(typeof __dirname !== "undefined" ? __dirname : "")',
          );
        }

        return { contents, loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts' };
      });
    },
  };
}

/**
 * Banner JS that must be included when using importMetaPlugin.
 * Captures CJS __filename at the top level before any module
 * declarations that might shadow it.
 */
export const IMPORT_META_BANNER = 'var __BUNDLE_FILENAME = typeof __filename !== "undefined" ? __filename : "";';

/**
 * Plugin to intercept the `bindings` package used by better-sqlite3
 * to locate its native `.node` addon.
 *
 * In SEA mode, the `.node` file is extracted at runtime and its path
 * is set via `BETTER_SQLITE3_BINDING` env var by `setupNativeModules()`.
 * This shim replaces the real `bindings` package so that better-sqlite3's
 * JS wrapper can be bundled without requiring `node_modules` at runtime.
 */
export function nativeBindingsPlugin(): esbuild.Plugin {
  return {
    name: 'native-bindings',
    setup(build) {
      build.onResolve({ filter: /^bindings$/ }, () => ({
        path: 'bindings',
        namespace: 'native-bindings-shim',
      }));

      build.onLoad({ filter: /.*/, namespace: 'native-bindings-shim' }, () => ({
        contents: `
          'use strict';
          module.exports = function bindings(bindingName) {
            var bindingPath = process.env.BETTER_SQLITE3_BINDING;
            if (!bindingPath) {
              throw new Error(
                'BETTER_SQLITE3_BINDING environment variable is not set. ' +
                'Native module extraction may be incomplete. ' +
                'Expected binding: ' + bindingName
              );
            }
            // Use process.dlopen() instead of require() because in SEA mode
            // the global require is the embedder require which only handles
            // Node.js builtin modules — not filesystem .node files.
            var mod = { exports: {} };
            process.dlopen(mod, bindingPath);
            return mod.exports;
          };
        `,
        loader: 'js',
      }));
    },
  };
}

/** Common esbuild build options shared across all binary builds */
export interface BuildOptions {
  minify?: boolean;
  sourcemap?: boolean;
}
