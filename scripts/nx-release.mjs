/**
 * Simplified Nx Release script for VectoriaDB.
 *
 * This script accepts a version via environment variable and uses Nx Release's
 * programmatic API to bump versions.
 *
 * Usage:
 *   NEW_VERSION=2.1.0 node scripts/nx-release.mjs
 *
 * Options:
 *   DRY_RUN=true - Preview changes without applying them
 */

import { releaseVersion } from 'nx/release/index.js';
import fs from 'fs';
import path from 'path';

async function main() {
  const newVersion = process.env.NEW_VERSION;
  const dryRun = process.env.DRY_RUN === 'true';

  if (!newVersion) {
    console.error('Error: NEW_VERSION environment variable not set');
    console.error('Usage: NEW_VERSION=2.1.0 node scripts/nx-release.mjs');
    process.exit(1);
  }

  console.log(`Bumping vectoriadb to version: ${newVersion}`);
  console.log(`Dry run: ${dryRun}`);

  try {
    // Use Nx Release to bump version
    // Git operations are disabled here - the workflow handles git commit/tag
    await releaseVersion({
      specifier: newVersion,
      projects: ['vectoriadb'],
      dryRun,
      verbose: true,
      gitCommit: false,
      gitTag: false,
    });

    console.log(`✓ Version updated for vectoriadb`);

    // Verify the version was updated
    const pkgPath = path.join('libs', 'vectoriadb', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    if (pkg.version !== newVersion) {
      console.log(`⚠ Specified ${newVersion}, but final version is ${pkg.version}`);
    } else {
      console.log(`✓ Verified version: ${pkg.version}`);
    }
  } catch (error) {
    console.error(`✗ Failed to version vectoriadb:`, error.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
