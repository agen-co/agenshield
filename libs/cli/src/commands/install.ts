/**
 * Install command
 *
 * Bootstraps a self-managed AgenShield installation at ~/.agenshield/dist/.
 * After installation the user adds ~/.agenshield/bin to their PATH.
 *
 * @example
 * ```bash
 * npx agenshield install
 * npx agenshield install --version 0.8.0
 * npx agenshield install --force
 * ```
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AGENSHIELD_HOME,
  getBinDir,
  getDistDir,
  getLocalCliEntry,
  getVersionFilePath,
  checkNodeVersion,
  downloadAndExtract,
  installFromLocal,
  findMonorepoRoot,
  writeShim,
  writeVersionInfo,
  readVersionInfo,
  ensurePathInShellRc,
} from '../utils/home.js';

/**
 * Read the version from the CLI's own package.json (fallback for --version).
 */
function getOwnVersion(): string {
  try {
    // Walk up from compiled location to find package.json
    let dir = path.dirname(new URL(import.meta.url).pathname);
    for (let i = 0; i < 5; i++) {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'agenshield' && pkg.version) return pkg.version as string;
      }
      dir = path.dirname(dir);
    }
  } catch { /* ignore */ }
  return 'latest';
}

/**
 * Create the install command
 */
export function createInstallCommand(): Command {
  const cmd = new Command('install')
    .description('Install AgenShield locally to ~/.agenshield/')
    .option('--version <version>', 'Install a specific version (default: own version or latest)')
    .option('--channel <channel>', 'Release channel', 'stable')
    .option('--force', 'Overwrite existing installation')
    .option('--local', 'Install from local monorepo build output instead of npm')
    .action(async (options) => {
      console.log('');
      console.log('  AgenShield Local Install');
      console.log('  ────────────────────────');
      console.log('');

      // 1. Check Node.js version
      const nodeError = checkNodeVersion(22);
      if (nodeError) {
        console.log(`  \x1b[31m✗ ${nodeError}\x1b[0m`);
        process.exit(1);
      }
      console.log(`  \x1b[32m✓\x1b[0m Node.js ${process.versions['node']}`);

      // 2. Check for existing installation
      const existing = readVersionInfo();
      if (existing && !options.force) {
        console.log(`  \x1b[33m!\x1b[0m AgenShield ${existing.version} is already installed at ${AGENSHIELD_HOME}`);
        console.log('  Use --force to overwrite, or run `agenshield upgrade` to update.');
        console.log('');
        process.exit(0);
      }

      // 3. Create directories (skip dist for --local; installFromLocal symlinks it)
      const dirs = [
        getBinDir(),
        path.join(AGENSHIELD_HOME, 'logs'),
      ];
      if (!options.local) {
        dirs.push(getDistDir());
      }
      for (const dir of dirs) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 4. Clear dist dir if --force and it already exists
      const distDir = getDistDir();
      if (options.force) {
        try {
          const stat = fs.lstatSync(distDir);
          if (stat.isSymbolicLink() || stat.isFile()) {
            fs.unlinkSync(distDir);
          } else if (stat.isDirectory()) {
            fs.rmSync(distDir, { recursive: true, force: true });
          }
        } catch { /* doesn't exist yet */ }
        if (!options.local) {
          fs.mkdirSync(distDir, { recursive: true });
        }
      }

      // 5. Install: local monorepo copy or npm download
      let result: { success: boolean; version: string; error?: string };
      let channel: string;

      if (options.local) {
        const repoRoot = findMonorepoRoot();
        if (!repoRoot) {
          console.log('  \x1b[31m✗ Could not find monorepo root (no package.json with workspaces field).\x1b[0m');
          process.exit(1);
        }

        // Read version from libs/cli/package.json
        let localVersion = 'unknown';
        try {
          const cliPkg = JSON.parse(
            fs.readFileSync(path.join(repoRoot, 'libs', 'cli', 'package.json'), 'utf-8'),
          );
          if (cliPkg.version) localVersion = cliPkg.version;
        } catch { /* ignore */ }

        channel = 'local';
        console.log(`  \x1b[36m⬇\x1b[0m Installing agenshield@${localVersion} from local build...`);
        result = installFromLocal(repoRoot);
      } else {
        const version: string = options.version ?? getOwnVersion();
        channel = options.channel ?? 'stable';
        console.log(`  \x1b[36m⬇\x1b[0m Installing agenshield@${version} (${channel})...`);
        result = downloadAndExtract(version);
      }

      if (!result.success) {
        console.log(`  \x1b[31m✗ Install failed: ${result.error}\x1b[0m`);
        process.exit(1);
      }
      console.log(`  \x1b[32m✓\x1b[0m Installed agenshield@${result.version}`);

      // 6. Write shim
      writeShim();
      console.log(`  \x1b[32m✓\x1b[0m Created CLI shim at ${getBinDir()}/agenshield`);

      // 7. Write version.json
      const now = new Date().toISOString();
      writeVersionInfo({
        version: result.version,
        channel,
        installedAt: existing?.installedAt ?? now,
        updatedAt: now,
      });
      console.log(`  \x1b[32m✓\x1b[0m Wrote ${getVersionFilePath()}`);

      // 8. Verify CLI entry point
      const cliEntry = getLocalCliEntry();
      if (!fs.existsSync(cliEntry)) {
        console.log(`  \x1b[31m✗ CLI entry point not found at ${cliEntry}\x1b[0m`);
        console.log('  The package may have an unexpected layout. Check ~/.agenshield/dist/');
        process.exit(1);
      }
      console.log(`  \x1b[32m✓\x1b[0m Verified CLI entry point`);

      // 9. Auto-add PATH to shell rc
      const { added, rcFile } = ensurePathInShellRc();
      if (added) {
        console.log(`  \x1b[32m✓\x1b[0m Added PATH to ${rcFile}`);
        console.log(`    Run: source ${rcFile}`);
      } else {
        console.log(`  \x1b[32m✓\x1b[0m PATH already configured in ${rcFile}`);
      }

      console.log('');
      console.log('  \x1b[32m✓ Installation complete!\x1b[0m');
      console.log('');
      console.log('  Verify with:');
      console.log('');
      console.log('    agenshield --version');
      console.log('');
      console.log(`  Installation directory: ${AGENSHIELD_HOME}`);
      console.log(`  CLI shim:              ${getBinDir()}/agenshield`);
      console.log('');
    });

  return cmd;
}
