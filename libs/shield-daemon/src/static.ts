/**
 * Static asset resolver for embedded UI
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSEA, getSEALibDir } from '@agenshield/ipc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the path to UI assets
 * @returns Path to UI assets or null if not found
 */
export function getUiAssetsPath(): string | null {
  // SEA mode: ui-assets are extracted to the lib directory
  if (isSEA()) {
    const libDir = getSEALibDir();
    if (libDir) {
      const seaPath = path.join(libDir, 'ui-assets');
      if (fs.existsSync(seaPath)) return seaPath;
    }
  }

  // npm install: ui-assets is at the package root (sibling of dist/)
  const pkgRootPath = path.join(__dirname, '..', 'ui-assets');
  if (fs.existsSync(pkgRootPath)) {
    return pkgRootPath;
  }

  // Bundled: ui-assets copied into dist/ alongside main.js
  const bundledPath = path.join(__dirname, 'ui-assets');
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  // Development: monorepo Nx build output
  const devPath = path.join(__dirname, '..', '..', '..', 'dist', 'apps', 'shield-ui');
  if (fs.existsSync(devPath)) {
    return devPath;
  }

  return null;
}
