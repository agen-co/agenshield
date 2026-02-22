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
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AGENSHIELD_HOME,
  getBinDir,
  getDistDir,
  getLocalCliEntry,
  getVersionFilePath,
  checkNodeVersion,
  downloadAndExtract,
  writeShim,
  writeVersionInfo,
  readVersionInfo,
} from '../utils/home.js';

/**
 * Detect the user's default shell rc file for PATH instructions.
 */
function detectRcFile(): string {
  const shell = process.env['SHELL'] || '';
  if (shell.endsWith('/zsh')) return '~/.zshrc';
  if (shell.endsWith('/bash')) {
    // On macOS, .bash_profile is preferred over .bashrc for login shells
    const bashProfile = path.join(os.homedir(), '.bash_profile');
    if (fs.existsSync(bashProfile)) return '~/.bash_profile';
    return '~/.bashrc';
  }
  if (shell.endsWith('/fish')) return '~/.config/fish/config.fish';
  return '~/.profile';
}

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

      // 3. Determine version
      const version: string = options.version ?? getOwnVersion();
      const channel: string = options.channel ?? 'stable';
      console.log(`  \x1b[36m⬇\x1b[0m Installing agenshield@${version} (${channel})...`);

      // 4. Create directories
      const dirs = [
        getBinDir(),
        getDistDir(),
        path.join(AGENSHIELD_HOME, 'logs'),
      ];
      for (const dir of dirs) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 5. Download and extract
      // Clear dist dir if --force and it already exists
      const distDir = getDistDir();
      if (options.force && fs.existsSync(distDir)) {
        fs.rmSync(distDir, { recursive: true, force: true });
        fs.mkdirSync(distDir, { recursive: true });
      }

      const result = downloadAndExtract(version);
      if (!result.success) {
        console.log(`  \x1b[31m✗ Download failed: ${result.error}\x1b[0m`);
        process.exit(1);
      }
      console.log(`  \x1b[32m✓\x1b[0m Downloaded and extracted agenshield@${result.version}`);

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

      // 9. PATH instructions
      const binDir = getBinDir();
      const rcFile = detectRcFile();
      const exportLine = `export PATH="$HOME/.agenshield/bin:$PATH"`;

      console.log('');
      console.log('  \x1b[32m✓ Installation complete!\x1b[0m');
      console.log('');
      console.log('  Add AgenShield to your PATH by running:');
      console.log('');
      console.log(`    echo '${exportLine}' >> ${rcFile}`);
      console.log(`    source ${rcFile}`);
      console.log('');
      console.log('  Then verify with:');
      console.log('');
      console.log('    agenshield --version');
      console.log('');
      console.log(`  Installation directory: ${AGENSHIELD_HOME}`);
      console.log(`  CLI shim:              ${binDir}/agenshield`);
      console.log('');
    });

  return cmd;
}
