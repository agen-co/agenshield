/**
 * Shared constants for SEA esbuild configurations.
 *
 * Path aliases, externals, and Node.js built-in module lists
 * shared across all binary app esbuild configs.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// import.meta.dirname is undefined when loaded via CJS require() in tsx -e context.
// Fall back to import.meta.url which tsx always polyfills.
const _thisDir = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(_thisDir, '../../..');
export const DIST_SEA = path.join(ROOT, 'dist', 'sea');

/** Path aliases matching tsconfig.base.json */
export const ALIASES: Record<string, string> = {
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
  '@agenshield/keychain': path.join(ROOT, 'libs/keychain/src/index.ts'),
  '@agenshield/auth': path.join(ROOT, 'libs/auth/src/index.ts'),
};

/**
 * Packages marked as external (not bundled).
 * Native module JS wrappers (e.g. better-sqlite3) are now bundled,
 * with their `bindings` require intercepted by nativeBindingsPlugin.
 */
export const EXTERNAL: string[] = [];

/**
 * Codesign identifiers for macOS code signing.
 * Duplicated from @agenshield/ipc because .mts build scripts cannot import workspace libs at build time.
 */
export const CODESIGN_IDENTIFIERS: Record<string, string> = {
  'agenshield': 'com.frontegg.agenshield.cli',
  'agenshield-daemon': 'com.frontegg.agenshield.daemon',
  'agenshield-broker': 'com.frontegg.agenshield.broker',
  'better_sqlite3.node': 'com.frontegg.agenshield.native.better-sqlite3',
};

/** Resolve codesign identifier from a binary path. Returns undefined for unknown binaries. */
export function resolveCodesignId(binaryPath: string): string | undefined {
  const basename = path.basename(binaryPath);
  return CODESIGN_IDENTIFIERS[basename];
}

/** Node.js built-in modules to keep external */
export const NODE_BUILTINS = [
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2',
  'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'repl', 'sea', 'stream',
  'string_decoder', 'sys', 'timers', 'tls', 'tty', 'url', 'util',
  'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
].flatMap(m => [m, `node:${m}`]);
