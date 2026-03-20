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

import type { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { withGlobals } from './base.js';
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
  buildAndInstallSEAFromLocal,
  installSEAFromDir,
  isRootOwned,
} from '../utils/home.js';
import { stopDaemon, getDaemonStatus } from '../utils/daemon.js';
import { inkSelect } from '../prompts/index.js';
import { output } from '../utils/output.js';
import { createSpinner } from '../utils/spinner.js';
import { CliError, ConnectionError } from '../errors.js';
import { resolveHostHome } from '../utils/host-user.js';

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

// Service installation (LaunchDaemon, menu bar agent) is NOT performed during install.
// The user runs `agenshield start` after install, which uses the signed SEA binary
// to auto-install services on first run. This avoids SentinelOne blocking the
// unsigned npx process from writing plists to system directories.

/**
 * Token-based cloud enrollment (--token + --cloud-url).
 *
 * Registers this device with the cloud, saves credentials locally,
 * and writes setup.json so `ensureSetupComplete()` passes on `agenshield start`.
 *
 * Does NOT install services or start the daemon — that's `agenshield start`'s job.
 */
async function performTokenEnrollment(cloudUrl: string, token: string): Promise<void> {
  output.info('');
  output.info(`  ${output.bold('Cloud Enrollment (Token)')}`);
  output.info('');

  // Ensure downstream libs resolve paths correctly under sudo/root
  if (process.getuid?.() === 0 && !process.env['AGENSHIELD_USER_HOME']) {
    process.env['AGENSHIELD_USER_HOME'] = resolveHostHome();
  }

  const {
    generateEd25519Keypair,
    registerDevice,
    saveCloudCredentials,
    isCloudEnrolled,
  } = await import('../utils/cloud.js');
  const { writeSetupState } = await import('../utils/setup-state.js');

  // Check if already enrolled
  if (isCloudEnrolled()) {
    output.warn('This device is already enrolled in AgenShield Cloud.');
    output.info('  To re-enroll, remove ~/.agenshield/cloud.json first.');
    output.info('');
    return;
  }

  // 1. Generate Ed25519 keypair
  const keypairSpinner = await createSpinner('Generating device keypair...');
  const keypair = generateEd25519Keypair();
  keypairSpinner.succeed('Device keypair generated');

  // 2. Register device with cloud using the enrollment token
  const registerSpinner = await createSpinner('Registering device...');
  let registration: Awaited<ReturnType<typeof registerDevice>>;
  try {
    registration = await registerDevice(
      cloudUrl,
      token,
      keypair.publicKey,
      os.hostname(),
    );
  } catch (err) {
    registerSpinner.fail('Registration failed');
    throw new ConnectionError(`Failed to register device: ${(err as Error).message}`);
  }
  registerSpinner.succeed(`Device registered (ID: ${registration.agentId})`);

  // 3. Save credentials locally (file-based, daemon not running yet)
  saveCloudCredentials(
    registration.agentId,
    keypair.privateKey,
    cloudUrl,
    'MDM',
  );

  // 4. Persist setup state so `ensureSetupComplete()` passes on `agenshield start`
  writeSetupState({
    mode: 'cloud',
    cloudUrl,
    completedAt: new Date().toISOString(),
  });

  output.success(`Enrolled with cloud (Agent ID: ${registration.agentId})`);
  output.info('');
}

export function registerInstallCommand(program: Command): void {
  program
    .command('install')
    .description('Install AgenShield locally to ~/.agenshield/')
    .option('--version <ver>', 'Install a specific version (default: own version or latest)')
    .option('--channel <ch>', 'Release channel', 'stable')
    .option('--force', 'Overwrite existing installation', false)
    .option('--local', 'Install from local monorepo build output instead of npm', false)
    .option('--sea', 'Build and install as a Single Executable Application binary', false)
    .option('--from-dir <dir>', 'Install SEA binaries from a pre-extracted archive directory')
    .option('--policy-url <url>', 'Policy server URL for cloud login', 'http://localhost:9090')
    .option('--org <name>', 'Organization name displayed in menu bar login')
    .option('--token <token>', 'Enrollment token for automatic cloud setup')
    .option('--cloud-url <url>', 'Cloud API URL for enrollment')
    .option('--skip-services', 'Skip automatic macOS LaunchDaemon and menu bar agent installation', false)
    .option('--auto-shield', 'Automatically shield detected targets after enrollment', false)
    .action(withGlobals(async (opts) => {
      const fromDir = opts['fromDir'] as string | undefined;

      // Auto-detect SEA mode: if running as SEA binary, find sibling files
      let autoFromDir: string | undefined;
      if (!fromDir && !opts['local']) {
        const { isSEA: checkSEA } = await import('@agenshield/ipc');
        if (checkSEA()) {
          const binDir = path.dirname(process.execPath);
          const parentDir = path.dirname(binDir);
          if (fs.existsSync(path.join(parentDir, 'native'))) {
            // npx package layout: bin/ subdirectory + sibling assets at parent
            autoFromDir = parentDir;
          } else if (fs.existsSync(path.join(binDir, 'agenshield-daemon'))) {
            // Flat layout: all files in same directory (archive extract)
            autoFromDir = binDir;
          }
        }
      }

      const resolvedFromDir = fromDir || autoFromDir;
      const useSEA = (opts['sea'] as boolean) || !!resolvedFromDir;

      output.info('');
      output.info(`  AgenShield ${useSEA ? 'SEA Binary' : 'Local'} Install`);
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
      let installAction: 'update' | 'reinstall' = 'update';
      let wasDaemonRunning = false;

      if (existing) {
        const formatLabel = existing.format === 'sea' ? 'SEA binary' : 'npm';
        output.info(`  Existing installation detected:`);
        output.info(`    Version: ${existing.version}`);
        output.info(`    Format:  ${formatLabel}`);
        output.info(`    Channel: ${existing.channel ?? 'unknown'}`);
        output.info('');

        const interactive = !opts['force'] && process.stdin.isTTY && process.stderr.isTTY;

        if (interactive) {
          const choice = await inkSelect<'update' | 'reinstall' | 'cancel'>([
            { label: 'Update (recommended)', value: 'update', description: 'Stop daemon, overwrite files, restart' },
            { label: 'Uninstall & reinstall', value: 'reinstall', description: 'Remove old artifacts, install fresh' },
            { label: 'Cancel', value: 'cancel', description: 'Exit without changes' },
          ], { title: 'AgenShield is already installed. What would you like to do?' });

          if (!choice || choice === 'cancel') {
            output.info('  Cancelled.');
            return;
          }
          installAction = choice;
        } else {
          // Non-interactive or --force: default to update
          output.info('  Proceeding with update (non-interactive mode)...');
          output.info('');
        }

        // Stop daemon if running before overwriting files
        const daemonStatus = await getDaemonStatus();
        wasDaemonRunning = daemonStatus.running;
        if (wasDaemonRunning) {
          const stopSpinner = await createSpinner('Stopping daemon...');
          const stopResult = await stopDaemon();
          if (!stopResult.success && stopResult.message !== 'Daemon is not running') {
            stopSpinner.fail(stopResult.message);
            throw new CliError(
              `Failed to stop daemon before install. Try: agenshield stop\n${stopResult.message}`,
              'DAEMON_STOP_FAILED',
            );
          }
          stopSpinner.succeed(stopResult.message);
        }

        // Handle reinstall: remove old artifacts
        if (installAction === 'reinstall') {
          const cleanSpinner = await createSpinner('Removing old installation...');
          const dirsToRemove = [
            getBinDir(),
            path.join(AGENSHIELD_HOME, 'libexec'),
            getDistDir(),
          ];
          for (const dir of dirsToRemove) {
            try {
              if (fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true, force: true });
              }
            } catch { /* best effort */ }
          }
          try {
            const versionFile = getVersionFilePath();
            if (fs.existsSync(versionFile)) {
              fs.unlinkSync(versionFile);
            }
          } catch { /* best effort */ }
          cleanSpinner.succeed('Removed old installation');
        }
      }

      // 2b. Warn if ~/.agenshield was left behind as root-owned
      if (fs.existsSync(AGENSHIELD_HOME) && isRootOwned(AGENSHIELD_HOME)) {
        throw new CliError(
          `${AGENSHIELD_HOME} is owned by root. Run:\n  sudo chown -R $(whoami) "${AGENSHIELD_HOME}"`,
          'PERMISSION_ERROR',
        );
      }

      // 3. Create directories
      const dirs = [
        getBinDir(),
        path.join(AGENSHIELD_HOME, 'logs'),
      ];
      if (!useSEA) {
        dirs.push(getDistDir());
      }
      for (const dir of dirs) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // -- SEA binary install path --
      if (useSEA) {
        let result: { success: boolean; version: string; error?: string };

        if (resolvedFromDir) {
          // Install from pre-extracted archive directory or npx package
          const ver = (opts['version'] as string | undefined) ?? getOwnVersion();

          const spinner2 = await createSpinner(`Installing SEA binaries from ${resolvedFromDir}...`);
          result = await installSEAFromDir(resolvedFromDir, ver, (step) => spinner2.update(step));

          if (!result.success) {
            spinner2.fail(`SEA install failed: ${result.error}`);
            throw new CliError(`SEA install failed: ${result.error}`, 'SEA_INSTALL_FAILED');
          }
          spinner2.succeed(`Installed agenshield@${result.version} SEA binaries`);
        } else if (opts['local']) {
          const repoRoot = findMonorepoRoot();
          if (!repoRoot) {
            throw new CliError(
              'Could not find monorepo root (no package.json with workspaces field).',
              'MONOREPO_NOT_FOUND',
            );
          }

          const spinner2 = await createSpinner('Installing SEA binaries from local build...');
          result = await buildAndInstallSEAFromLocal(
            repoRoot,
            (step) => spinner2.update(step),
          );

          if (!result.success) {
            spinner2.fail(`SEA build failed: ${result.error}`);
            throw new CliError(`SEA build failed: ${result.error}`, 'SEA_BUILD_FAILED');
          }
          spinner2.succeed(`Built agenshield@${result.version} SEA binary`);
        } else {
          // TODO: Download pre-built SEA binary from GitHub Releases
          throw new CliError(
            'Remote SEA binary installs are not yet supported. Use --local --sea to build from monorepo.',
            'SEA_REMOTE_NOT_SUPPORTED',
          );
        }

        // Write version.json with SEA format
        const now = new Date().toISOString();
        writeVersionInfo({
          version: result.version,
          channel: resolvedFromDir ? (opts['channel'] as string) : 'local',
          installedAt: existing?.installedAt ?? now,
          updatedAt: now,
          format: 'sea',
        });
        output.success(`Wrote ${getVersionFilePath()}`);

        // Verify all binaries exist
        const binDir = getBinDir();
        const libexecDir = path.join(path.dirname(binDir), 'libexec');
        const expectedBinaries: Array<{ name: string; dir: string }> = [
          { name: 'agenshield', dir: binDir },
          { name: 'agenshield-daemon', dir: libexecDir },
          { name: 'agenshield-broker', dir: libexecDir },
        ];
        for (const { name, dir } of expectedBinaries) {
          const binPath = path.join(dir, name);
          if (!fs.existsSync(binPath)) {
            throw new CliError(
              `SEA binary not found at ${binPath}.`,
              'BINARY_MISSING',
            );
          }
        }
        output.success(`SEA binaries installed in ${binDir}`);

        // Auto-add PATH
        const { added, rcFile } = ensurePathInShellRc();
        if (added) {
          output.success(`Added PATH to ${rcFile}`);
          output.info(`    Run: source ${rcFile}`);
        } else {
          output.success(`PATH already configured in ${rcFile}`);
        }

        // Install Claude bootstrap wrapper (user-level only, no sudo)
        const { installClaudeWrapper } = await import('../utils/claude-wrapper.js');
        const wrapperResult = installClaudeWrapper({ skipSystemPath: true });
        if (wrapperResult.installed.length > 0) {
          output.success(`Installed Claude launcher → ${wrapperResult.installed.join(', ')}`);
        }

        // Write pending-services manifest — privileged ops deferred to `agenshield start`
        if (os.platform() === 'darwin') {
          const pendingPath = path.join(AGENSHIELD_HOME, 'pending-services.json');
          fs.writeFileSync(pendingPath, JSON.stringify({
            copyApp: true,
            installPlists: true,
            claudeSystemWrapper: true,
            createdAt: new Date().toISOString(),
          }, null, 2) + '\n', { mode: 0o644 });
          output.success('Deferred privileged operations to `agenshield start`');
        }

        // Write auto-shield intent file
        if (opts['autoShield']) {
          const autoShieldPath = path.join(AGENSHIELD_HOME, 'auto-shield.json');
          fs.writeFileSync(autoShieldPath, JSON.stringify({ enabled: true, createdAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o644 });
          output.success('Auto-shield enabled');
        }

        // Token enrollment (--token + --cloud-url)
        {
          const token = opts['token'] as string | undefined;
          const cloudUrl = (opts['cloudUrl'] as string | undefined) || (opts['policyUrl'] as string | undefined);
          if (token && cloudUrl) {
            await performTokenEnrollment(cloudUrl, token);
          }
        }

        output.info('');
        output.success('SEA installation complete!');
        output.info('');
        output.info('  Next step — start the daemon:');
        output.info('');
        output.info('    agenshield start');
        output.info('');
        output.info(`  Installation directory: ${AGENSHIELD_HOME}`);
        output.info(`  Binaries:              ${binDir}/`);
        for (const { name } of expectedBinaries) {
          output.info(`    - ${name}`);
        }
        output.info('');
        return;
      }

      // -- Standard npm-pack install path --

      // 4. Clear dist dir if --force and it already exists
      const distDir = getDistDir();
      if (opts['force']) {
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

      if (opts['local']) {
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
        const ver: string = (opts['version'] as string) ?? getOwnVersion();
        channelVal = opts['channel'] as string;
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
      const { added: npmAdded, rcFile: npmRcFile } = ensurePathInShellRc();
      if (npmAdded) {
        output.success(`Added PATH to ${npmRcFile}`);
        output.info(`    Run: source ${npmRcFile}`);
      } else {
        output.success(`PATH already configured in ${npmRcFile}`);
      }

      // 9b. Install Claude bootstrap wrapper (user-level only, no sudo)
      {
        const { installClaudeWrapper: installNpmClaudeWrapper } = await import('../utils/claude-wrapper.js');
        const npmWrapperResult = installNpmClaudeWrapper({ skipSystemPath: true });
        if (npmWrapperResult.installed.length > 0) {
          output.success(`Installed Claude launcher → ${npmWrapperResult.installed.join(', ')}`);
        }
      }

      // 9c. Write pending-services manifest — privileged ops deferred to `agenshield start`
      if (os.platform() === 'darwin') {
        const pendingPath = path.join(AGENSHIELD_HOME, 'pending-services.json');
        fs.writeFileSync(pendingPath, JSON.stringify({
          copyApp: true,
          installPlists: true,
          claudeSystemWrapper: true,
          createdAt: new Date().toISOString(),
        }, null, 2) + '\n', { mode: 0o644 });
        output.success('Deferred privileged operations to `agenshield start`');
      }

      // 9e. Write auto-shield intent file
      if (opts['autoShield']) {
        const autoShieldPath = path.join(AGENSHIELD_HOME, 'auto-shield.json');
        fs.writeFileSync(autoShieldPath, JSON.stringify({ enabled: true, createdAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o644 });
        output.success('Auto-shield enabled');
      }

      // 9f. Token enrollment (--token + --cloud-url)
      {
        const token = opts['token'] as string | undefined;
        const cloudUrl = (opts['cloudUrl'] as string | undefined) || (opts['policyUrl'] as string | undefined);
        if (token && cloudUrl) {
          await performTokenEnrollment(cloudUrl, token);
        }
      }

      output.info('');
      output.success('Installation complete!');
      output.info('');
      output.info('  Next step — start the daemon:');
      output.info('');
      output.info('    agenshield start');
      output.info('');
      output.info(`  Installation directory: ${AGENSHIELD_HOME}`);
      output.info(`  CLI shim:              ${getBinDir()}/agenshield`);
      output.info('');
    }));
}
