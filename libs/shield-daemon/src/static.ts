/**
 * Static asset resolver for embedded UI
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the path to UI assets
 * @returns Path to UI assets or null if not found
 */
export function getUiAssetsPath(): string | null {
  // Check for bundled UI assets (production - same directory as main.js)
  const bundledPath = path.join(__dirname, 'ui-assets');
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  // Check for development build (from libs/shield-daemon/dist/ → repo root → dist/apps/shield-ui)
  const devPath = path.join(__dirname, '..', '..', '..', 'dist', 'apps', 'shield-ui');
  if (fs.existsSync(devPath)) {
    return devPath;
  }

  return null;
}
