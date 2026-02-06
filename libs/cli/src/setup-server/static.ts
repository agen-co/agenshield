/**
 * Static asset resolver for embedded UI (setup server variant)
 *
 * Same logic as libs/shield-daemon/src/static.ts but relative to CLI package paths.
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the path to UI assets for the setup server
 * @returns Path to UI assets or null if not found
 */
export function getUiAssetsPath(): string | null {
  // Try npm-installed daemon package — ui-assets is at the package root
  try {
    const pkgPath = require.resolve('@agenshield/daemon/package.json');
    const npmPath = path.join(path.dirname(pkgPath), 'ui-assets');
    if (fs.existsSync(npmPath)) return npmPath;
  } catch {
    /* package not installed via npm */
  }

  // Bundled UI assets (production) — <cli-dist>/ui-assets/
  const bundledPath = path.join(__dirname, '..', 'ui-assets');
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  // Development: monorepo Nx build output
  const devPaths = [
    path.join(__dirname, '..', '..', '..', '..', 'dist', 'apps', 'shield-ui'),
    path.join(process.cwd(), 'dist', 'apps', 'shield-ui'),
  ];
  for (const devPath of devPaths) {
    if (fs.existsSync(devPath)) {
      return devPath;
    }
  }

  return null;
}
