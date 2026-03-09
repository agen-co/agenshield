import * as path from 'node:path';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Resolves the path to the embedded AgenShield.app bundle
 * that ships inside the @agenshield/sandbox npm package.
 *
 * Returns null if the bundle is not found (e.g. development mode
 * or the Xcode build was skipped).
 */
export function getMacAppBundlePath(): string | null {
  const require = createRequire(import.meta.url);
  const pkgDir = path.dirname(require.resolve('@agenshield/sandbox/package.json'));
  const appPath = path.join(pkgDir, 'macos-app', 'AgenShield.app');
  return fs.existsSync(appPath) ? appPath : null;
}
