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
import { output } from '../utils/output.js';
import { CliError } from '../errors.js';

/**
 * Read the version from the CLI's own package.json (fallback for --version).
 */
function getOwnVersion(): string {
  try {
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
      output.info('');
      output.info('  AgenShield Local Install');
      output.info('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
      output.info('');

      // 1. Check Node.js version
      const nodeError = checkNodeVersion(22);
      if (nodeError) {
        throw new CliError(nodeError, 'NODE_VERSION');
      }
      output.success(`Node.js ${process.versions['node']}`);

      // 2. Check for existing installation
      const existing = readVersionInfo();
      if (existing && !options.force) {
        output.warn(`AgenShield ${existing.version} is already installed at ${AGENSHIELD_HOME}`);
        output.info('  Use --force to overwrite, or run `agenshield upgrade` to update.');
        output.info('');
        return;
      }

      // 3. Create directories
      const dirs = [
        getBinDir(),
        path.join(AGENSHIELD_HOME, 'logs'),
        getDistDir(),
      ];
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
        fs.mkdirSync(distDir, { recursive: true });
      }

      // 5. Install: local monorepo copy or npm download
      let result: { success: boolean; version: string; error?: string };
      let channel: string;

      if (options.local) {
        const repoRoot = findMonorepoRoot();
        if (!repoRoot) {
          throw new CliError('Could not find monorepo root (no package.json with workspaces field).', 'MONOREPO_NOT_FOUND');
        }

        let localVersion = 'unknown';
        try {
          const cliPkg = JSON.parse(
            fs.readFileSync(path.join(repoRoot, 'libs', 'cli', 'package.json'), 'utf-8'),
          );
          if (cliPkg.version) localVersion = cliPkg.version;
        } catch { /* ignore */ }

        channel = 'local';
        output.info(`  ${output.cyan('\u2B07')} Installing agenshield@${localVersion} from local build...`);
        result = installFromLocal(repoRoot);
      } else {
        const version: string = options.version ?? getOwnVersion();
        channel = options.channel ?? 'stable';
        output.info(`  ${output.cyan('\u2B07')} Installing agenshield@${version} (${channel})...`);
        result = downloadAndExtract(version);
      }

      if (!result.success) {
        throw new CliError(`Install failed: ${result.error}`, 'INSTALL_FAILED');
      }
      output.success(`Installed agenshield@${result.version}`);

      // 6. Write shim
      writeShim();
      output.success(`Created CLI shim at ${getBinDir()}/agenshield`);

      // 7. Write version.json
      const now = new Date().toISOString();
      writeVersionInfo({
        version: result.version,
        channel,
        installedAt: existing?.installedAt ?? now,
        updatedAt: now,
      });
      output.success(`Wrote ${getVersionFilePath()}`);

      // 8. Verify CLI entry point
      const cliEntry = getLocalCliEntry();
      if (!fs.existsSync(cliEntry)) {
        throw new CliError(
          `CLI entry point not found at ${cliEntry}. The package may have an unexpected layout. Check ~/.agenshield/dist/`,
          'ENTRY_POINT_MISSING',
        );
      }
      output.success('Verified CLI entry point');

      // 9. Auto-add PATH to shell rc
      const { added, rcFile } = ensurePathInShellRc();
      if (added) {
        output.success(`Added PATH to ${rcFile}`);
        output.info(`    Run: source ${rcFile}`);
      } else {
        output.success(`PATH already configured in ${rcFile}`);
      }

      output.info('');
      output.success('Installation complete!');
      output.info('');
      output.info('  Verify with:');
      output.info('');
      output.info('    agenshield --version');
      output.info('');
      output.info(`  Installation directory: ${AGENSHIELD_HOME}`);
      output.info(`  CLI shim:              ${getBinDir()}/agenshield`);
      output.info('');
    });

  return cmd;
}
