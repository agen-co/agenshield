/**
 * Locate the test harness binary path
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function findTestHarness(): string | null {
  const searchPaths = [
    // Development location from project root
    path.join(process.cwd(), 'tools/test-harness/bin/dummy-openclaw.js'),
    // Relative to CLI dist
    path.join(__dirname, '../../../../tools/test-harness/bin/dummy-openclaw.js'),
  ];

  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      return path.resolve(p);
    }
  }

  return null;
}
