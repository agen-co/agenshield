/**
 * Static asset resolver for embedded UI (setup server variant)
 *
 * Same logic as libs/shield-daemon/src/static.ts but relative to CLI package paths.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the path to UI assets for the setup server
 * @returns Path to UI assets or null if not found
 */
export function getUiAssetsPath(): string | null {
  // Check for bundled UI assets (production) — <cli-dist>/ui-assets/
  const bundledPath = path.join(__dirname, '..', 'ui-assets');
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  // Check for development build — <monorepo-root>/dist/apps/shield-ui/
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
