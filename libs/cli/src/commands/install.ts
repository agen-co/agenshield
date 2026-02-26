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

import { Option } from 'clipanion';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BaseCommand } from './base.js';
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
import { createSpinner } from '../utils/spinner.js';
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

export class InstallCommand extends BaseCommand {
  static override paths = [['install']];

  static override usage = BaseCommand.Usage({
    category: 'Setup & Maintenance',
    description: 'Install AgenShield locally to ~/.agenshield/',
    examples: [
      ['Install latest version', '$0 install'],
      ['Install a specific version', '$0 install --version 0.8.0'],
      ['Force reinstall', '$0 install --force'],
      ['Install from local monorepo', '$0 install --local'],
    ],
  });

  version = Option.String('--version', { description: 'Install a specific version (default: own version or latest)' });
  channel = Option.String('--channel', 'stable', { description: 'Release channel' });
  force = Option.Boolean('--force', false, { description: 'Overwrite existing installation' });
  local = Option.Boolean('--local', false, { description: 'Install from local monorepo build output instead of npm' });

  async run(): Promise<number | void> {
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
    if (existing && !this.force) {
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
    if (this.force) {
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
    let channelVal: string;

    const spinner = await createSpinner('Installing...');

    if (this.local) {
      const repoRoot = findMonorepoRoot();
      if (!repoRoot) {
        spinner.fail('Install failed');
        throw new CliError('Could not find monorepo root (no package.json with workspaces field).', 'MONOREPO_NOT_FOUND');
      }

      let localVersion = 'unknown';
      try {
        const cliPkg = JSON.parse(
          fs.readFileSync(path.join(repoRoot, 'libs', 'cli', 'package.json'), 'utf-8'),
        );
        if (cliPkg.version) localVersion = cliPkg.version;
      } catch { /* ignore */ }

      channelVal = 'local';
      spinner.update(`Installing agenshield@${localVersion} from local build...`);
      result = await installFromLocal(repoRoot, undefined, (step) => spinner.update(step));
    } else {
      const ver: string = this.version ?? getOwnVersion();
      channelVal = this.channel;
      spinner.update(`Installing agenshield@${ver} (${channelVal})...`);
      result = await downloadAndExtract(ver, undefined, (step) => spinner.update(step));
    }

    if (!result.success) {
      spinner.fail(`Install failed: ${result.error}`);
      throw new CliError(`Install failed: ${result.error}`, 'INSTALL_FAILED');
    }
    spinner.succeed(`Installed agenshield@${result.version}`);

    // 6. Write shim
    writeShim();
    output.success(`Created CLI shim at ${getBinDir()}/agenshield`);

    // 7. Write version.json
    const now = new Date().toISOString();
    writeVersionInfo({
      version: result.version,
      channel: channelVal,
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
  }
}
