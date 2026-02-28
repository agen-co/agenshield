/**
 * Upgrade command
 *
 * Dual-path upgrade logic:
 *  - Local install (~/.agenshield/dist/) -> npm-pack download with rollback
 *  - Legacy (global npm / monorepo)      -> stop + update engine + restart
 */

import type { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withGlobals } from './base.js';
import { stopDaemon, startDaemon, getDaemonStatus, DAEMON_CONFIG } from '../utils/daemon.js';
import {
  isLocalInstall,
  readVersionInfo,
  writeVersionInfo,
  getDistDir,
  getBinDir,
  queryLatestVersion,
  downloadAndExtract,
  installFromLocal,
  findMonorepoRoot,
  writeShim,
  getLocalCliEntry,
  detectInstallFormat,
  buildAndInstallSEAFromLocal,
} from '../utils/home.js';
import { isSEA } from '@agenshield/ipc';
import { output } from '../utils/output.js';
import { ensureSetupComplete } from '../utils/setup-guard.js';
import { createSpinner } from '../utils/spinner.js';
import { CliError } from '../errors.js';
import type { UpdateEngineOptions } from '../update/types.js';

// ---------------------------------------------------------------------------
// Post-upgrade: reapply wrappers, guarded-shell, ZDOTDIR
// ---------------------------------------------------------------------------

async function runPostUpgrade(): Promise<void> {
  const postUpgradeSpinner = await createSpinner('Reapplying target configurations...');
  const maxAttempts = 5;
  let lastError = 'Could not reach daemon for post-upgrade refresh';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(
        `http://${DAEMON_CONFIG.HOST}:${DAEMON_CONFIG.PORT}/api/system/post-upgrade`,
        { method: 'POST' },
      );
      const data = await res.json() as { success: boolean; data?: { profiles?: unknown[] }; error?: string };
      if (data.success) {
        postUpgradeSpinner.succeed(`Refreshed ${data.data?.profiles?.length ?? 0} target(s)`);
        return;
      }
      lastError = data.error ?? 'Post-upgrade refresh failed';
    } catch {
      lastError = 'Could not reach daemon for post-upgrade refresh';
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  postUpgradeSpinner.fail(lastError);
}

// ---------------------------------------------------------------------------
// Legacy update logic (inlined from former update.ts)
// ---------------------------------------------------------------------------

async function runUpdateWebUI(engineOptions: UpdateEngineOptions): Promise<void> {
  const { createUpdateEngine } = await import('../update/engine.js');
  const { createUpdateServer } = await import('../update-server/index.js');

  output.info('');
  output.info('  Starting AgenShield Update...');
  output.info('');

  const engine = createUpdateEngine(engineOptions);
  const preflight = await engine.preflight();

  if (!preflight.updateNeeded && !engineOptions.force && !engineOptions.local) {
    output.info(`  Already at latest version (${preflight.currentVersion}).`);
    output.info('  Use --force to re-apply the update.');
    return;
  }

  output.info(`  Updating: ${preflight.currentVersion} -> ${preflight.targetVersion}`);
  output.info(`  Pending migrations: ${preflight.pendingMigrationCount}`);
  output.info('');

  if (!engineOptions.dryRun && !engineOptions.local) {
    const { ensureSudoAccess } = await import('../utils/privileges.js');
    ensureSudoAccess();
  }

  // Kill any existing process on port 5200
  const port = 5200;
  try {
    const { execSync } = await import('node:child_process');
    const pids = execSync(`lsof -ti :${port} -sTCP:LISTEN 2>/dev/null || true`, { encoding: 'utf-8' }).trim();
    if (pids) {
      output.info(`  Stopping existing process on port ${port} (PID: ${pids.split('\n').join(', ')})...`);
      execSync(`lsof -ti :${port} -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true`, { encoding: 'utf-8' });
      await new Promise(r => setTimeout(r, 500));
    }
  } catch { /* ignore */ }

  const server = createUpdateServer(engine);
  const url = await server.start(port);

  output.info(`  Update UI is running at: ${url}`);
  output.info('');
  output.info('  Opening browser...');
  output.info('  (If the browser does not open, visit the URL above manually)');
  output.info('');

  try {
    const { exec } = await import('node:child_process');
    exec(`open "${url}"`);
  } catch { /* non-fatal */ }

  let interrupted = false;
  const completionOrSignal = Promise.race([
    server.waitForCompletion(),
    new Promise<void>((resolve) => {
      process.on('SIGINT', () => { interrupted = true; resolve(); });
      process.on('SIGTERM', () => { interrupted = true; resolve(); });
    }),
  ]);

  await completionOrSignal;
  await server.stop();

  if (interrupted) {
    output.info('\n  Update cancelled.');
    process.exit(130);
  }

  if (engine.state.hasError) {
    throw new CliError('Update completed with errors. Check the UI for details.', 'UPDATE_FAILED');
  }

  output.success('Update complete!');
  setTimeout(() => process.exit(0), 500).unref();
}

async function runUpdateCLI(engineOptions: UpdateEngineOptions): Promise<void> {
  const { createUpdateEngine } = await import('../update/engine.js');

  output.info('');
  output.info('  AgenShield Update (CLI mode)');
  output.info('');

  const engine = createUpdateEngine(engineOptions);
  const preflight = await engine.preflight();

  if (!preflight.updateNeeded && !engineOptions.force && !engineOptions.local) {
    output.info(`  Already at latest version (${preflight.currentVersion}).`);
    output.info('  Use --force to re-apply the update.');
    return;
  }

  output.info(`  Updating: ${preflight.currentVersion} -> ${preflight.targetVersion}`);
  output.info(`  Pending migrations: ${preflight.pendingMigrationCount}`);
  output.info('');

  if (preflight.releaseNotes && preflight.releaseNotes !== 'No new release notes.') {
    output.info('  Release Notes:');
    output.info('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
    for (const line of preflight.releaseNotes.split('\n')) {
      output.info(`  ${line}`);
    }
    output.info('');
  }

  if (engineOptions.dryRun) {
    output.info('  [dry-run] Steps that would be executed:');
    for (const step of engine.state.steps) {
      output.info(`    - ${step.name}: ${step.description}`);
    }

    engine.onStateChange = (state) => {
      const running = state.steps.find(s => s.status === 'running');
      if (running) {
        output.info(`  [dry-run] ${running.name}`);
      }
    };

    await engine.execute();
  } else {
    const keepalive = engineOptions.local
      ? undefined
      : await (async () => {
          const { ensureSudoAccess, startSudoKeepalive } = await import('../utils/privileges.js');
          ensureSudoAccess();
          return startSudoKeepalive();
        })();

    try {
      engine.onStateChange = (state) => {
        const running = state.steps.find(s => s.status === 'running');
        if (running) {
          process.stdout.write(`\r  \u23F3 ${running.name}...`);
        }

        const justCompleted = state.steps.filter(s => s.status === 'completed' || s.status === 'skipped');
        const justErrored = state.steps.filter(s => s.status === 'error');
        const total = state.steps.length;
        const done = justCompleted.length;
        const errored = justErrored.length;

        if (done + errored === total) {
          output.info('');
          if (errored > 0) {
            output.error(`Update completed with ${errored} error(s)`);
            for (const s of justErrored) {
              output.info(`    - ${s.name}: ${s.error}`);
            }
          } else {
            output.success(`Update completed successfully (${done} steps)`);
          }
        }
      };

      await engine.execute();
    } finally {
      if (keepalive) clearInterval(keepalive);
    }
  }

  output.info('');
  setTimeout(() => process.exit(0), 500).unref();
}

async function runUpdate(options: {
  dryRun?: boolean;
  verbose?: boolean;
  force?: boolean;
  cli?: boolean;
  local?: boolean;
}): Promise<void> {
  const engineOptions: UpdateEngineOptions = {
    dryRun: options.dryRun ?? false,
    verbose: options.verbose ?? false,
    force: options.force ?? false,
    local: options.local ?? false,
  };

  if (options.verbose) {
    process.env['AGENSHIELD_VERBOSE'] = 'true';
  }

  if (options.cli) {
    await runUpdateCLI(engineOptions);
  } else {
    await runUpdateWebUI(engineOptions);
  }
}

// ---------------------------------------------------------------------------
// Local-install upgrade (npm pack flow with rollback)
// ---------------------------------------------------------------------------

async function upgradeLocalInstall(options: {
  force?: boolean;
  verbose?: boolean;
  local?: boolean;
}): Promise<void> {
  const versionInfo = readVersionInfo();
  if (!versionInfo) {
    throw new CliError('version.json is missing or corrupt. Run `agenshield install --force`.', 'VERSION_MISSING');
  }

  const currentVersion = versionInfo.version;
  output.info(`  Current version: ${currentVersion}`);

  let targetVersion: string;

  if (options.local) {
    const repoRoot = findMonorepoRoot();
    if (!repoRoot) {
      throw new CliError('Could not find monorepo root (no package.json with workspaces field).', 'MONOREPO_NOT_FOUND');
    }

    try {
      const cliPkg = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'libs', 'cli', 'package.json'), 'utf-8'),
      );
      targetVersion = cliPkg.version || 'unknown';
    } catch {
      targetVersion = 'unknown';
    }

    output.info(`  Local version:   ${targetVersion}`);
  } else {
    const spinner = await createSpinner('Checking for updates...');
    try {
      targetVersion = queryLatestVersion();
      spinner.succeed(`Latest version: ${targetVersion}`);
    } catch (err) {
      spinner.fail('Failed to check for updates');
      throw new CliError(`Failed to query npm registry: ${(err as Error).message}`, 'REGISTRY_ERROR');
    }
  }

  if (currentVersion === targetVersion && !options.force) {
    output.info('');
    output.success(`Already at latest version (${currentVersion}).`);
    output.info('  Use --force to re-download.');
    return;
  }

  // Ensure sudo credentials are cached before stopping the daemon,
  // otherwise launchctl calls may hang waiting for a password prompt.
  const { ensureSudoAccess, startSudoKeepalive } = await import('../utils/privileges.js');
  ensureSudoAccess();
  const keepalive = startSudoKeepalive();

  try {

  // Stop daemon if running
  const wasDaemonRunning = (await getDaemonStatus()).running;
  if (wasDaemonRunning) {
    const stopSpinner = await createSpinner('Stopping daemon...');
    const stopResult = await stopDaemon();
    if (!stopResult.success && stopResult.message !== 'Daemon is not running') {
      stopSpinner.fail(stopResult.message);
      throw new CliError(stopResult.message, 'DAEMON_STOP_FAILED');
    }
    stopSpinner.succeed(stopResult.message);
  }

  const distDir = getDistDir();
  const backupDir = `${distDir}.bak`;
  let result: { success: boolean; version: string; error?: string };

  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }

  output.info('  Backing up current installation...');
  try {
    const stat = fs.lstatSync(distDir);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(distDir);
    } else {
      fs.renameSync(distDir, backupDir);
    }
  } catch { /* dist doesn't exist yet */ }
  fs.mkdirSync(distDir, { recursive: true });

  const dlSpinner = await createSpinner(`Downloading agenshield@${targetVersion}...`);
  if (options.local) {
    const repoRoot = findMonorepoRoot()!;
    dlSpinner.update(`Installing agenshield@${targetVersion} from local build...`);
    result = await installFromLocal(repoRoot, undefined, (step) => dlSpinner.update(step));
  } else {
    result = await downloadAndExtract(targetVersion, undefined, (step) => dlSpinner.update(step));
  }

  if (!result.success) {
    dlSpinner.fail(`Install failed: ${result.error}`);
    if (fs.existsSync(backupDir)) {
      output.info('  Rolling back to previous version...');
      fs.rmSync(distDir, { recursive: true, force: true });
      fs.renameSync(backupDir, distDir);
      output.success('Rolled back successfully.');
    }

    if (wasDaemonRunning) {
      output.info('  Restarting daemon with previous version...');
      await startDaemon();
    }
    throw new CliError(`Install failed: ${result.error}`, 'INSTALL_FAILED');
  }

  // Verify entry point
  const cliEntry = getLocalCliEntry();
  if (!fs.existsSync(cliEntry)) {
    dlSpinner.fail(`CLI entry point not found at ${cliEntry}`);
    if (fs.existsSync(backupDir)) {
      output.info('  Rolling back to previous version...');
      fs.rmSync(distDir, { recursive: true, force: true });
      fs.renameSync(backupDir, distDir);
      output.success('Rolled back successfully.');
    }

    if (wasDaemonRunning) {
      output.info('  Restarting daemon with previous version...');
      await startDaemon();
    }
    throw new CliError(`CLI entry point not found at ${cliEntry}`, 'ENTRY_POINT_MISSING');
  }

  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }

  dlSpinner.succeed(`Installed agenshield@${targetVersion}`);

  writeShim();
  writeVersionInfo({
    ...versionInfo,
    version: targetVersion,
    updatedAt: new Date().toISOString(),
  });
  output.success(`Updated version.json (${currentVersion} \u2192 ${targetVersion})`);

  if (wasDaemonRunning) {
    const restartSpinner = await createSpinner('Restarting daemon...');
    const startResult = await startDaemon();
    if (startResult.success) {
      const url = `http://${DAEMON_CONFIG.DISPLAY_HOST}:${DAEMON_CONFIG.PORT}`;
      restartSpinner.succeed(startResult.message);
      output.info(`  URL: ${url}`);
      await runPostUpgrade();
    } else {
      restartSpinner.fail(startResult.message);
    }
  }

  output.info('');
  output.success(`Upgrade complete! (${currentVersion} \u2192 ${targetVersion})`);

  } finally {
    clearInterval(keepalive);
  }
}

// ---------------------------------------------------------------------------
// SEA binary upgrade (local monorepo build → SEA binary swap)
// ---------------------------------------------------------------------------

async function upgradeSEAInstall(options: {
  force?: boolean;
  verbose?: boolean;
  local?: boolean;
  /** When true, this is a migration from npm format to SEA */
  migration?: boolean;
}): Promise<void> {
  const versionInfo = readVersionInfo();
  const currentVersion = versionInfo?.version ?? 'unknown';
  output.info(`  Current version: ${currentVersion}`);
  output.info(`  Install format:  ${options.migration ? 'npm → SEA migration' : 'SEA binary'}`);

  if (!options.local) {
    // TODO: Download pre-built SEA binary from GitHub Releases
    throw new CliError(
      'Remote SEA binary upgrades are not yet supported. Use --local to build from monorepo.',
      'SEA_REMOTE_NOT_SUPPORTED',
    );
  }

  const repoRoot = findMonorepoRoot();
  if (!repoRoot) {
    throw new CliError(
      'Could not find monorepo root (no package.json with workspaces field).',
      'MONOREPO_NOT_FOUND',
    );
  }

  let targetVersion: string;
  try {
    const cliPkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'libs', 'cli', 'package.json'), 'utf-8'),
    );
    targetVersion = cliPkg.version || 'unknown';
  } catch {
    targetVersion = 'unknown';
  }

  output.info(`  Local version:   ${targetVersion}`);

  if (currentVersion === targetVersion && !options.force) {
    output.info('');
    output.success(`Already at latest version (${currentVersion}).`);
    output.info('  Use --force to re-build.');
    return;
  }

  // Ensure sudo credentials are cached before stopping the daemon,
  // otherwise launchctl calls may hang waiting for a password prompt.
  const { ensureSudoAccess, startSudoKeepalive } = await import('../utils/privileges.js');
  ensureSudoAccess();
  const keepalive = startSudoKeepalive();

  try {

  // Stop daemon if running
  const wasDaemonRunning = (await getDaemonStatus()).running;
  if (wasDaemonRunning) {
    const stopSpinner = await createSpinner('Stopping daemon...');
    const stopResult = await stopDaemon();
    if (!stopResult.success && stopResult.message !== 'Daemon is not running') {
      stopSpinner.fail(stopResult.message);
      throw new CliError(stopResult.message, 'DAEMON_STOP_FAILED');
    }
    stopSpinner.succeed(stopResult.message);
  }

  // Backup current binaries (multi-binary layout)
  const binDir = getBinDir();
  const binaryNames = ['agenshield', 'agenshield-daemon', 'agenshield-broker'];
  for (const name of binaryNames) {
    const binPath = path.join(binDir, name);
    const backupPath = `${binPath}.bak`;
    if (fs.existsSync(binPath)) {
      try {
        fs.copyFileSync(binPath, backupPath);
      } catch { /* best effort */ }
    }
  }

  const dlSpinner = await createSpinner(`Installing agenshield@${targetVersion} SEA binaries from local build...`);
  const result = await buildAndInstallSEAFromLocal(repoRoot, (step) => dlSpinner.update(step));

  if (!result.success) {
    dlSpinner.fail(`SEA build failed: ${result.error}`);

    // Restore backups
    let restored = false;
    for (const name of binaryNames) {
      const binPath = path.join(binDir, name);
      const bkPath = `${binPath}.bak`;
      if (fs.existsSync(bkPath)) {
        fs.copyFileSync(bkPath, binPath);
        fs.chmodSync(binPath, 0o755);
        restored = true;
      }
    }
    if (restored) {
      output.info('  Restoring previous binaries...');
      output.success('Restored successfully.');
    }

    if (wasDaemonRunning) {
      output.info('  Restarting daemon with previous version...');
      await startDaemon();
    }
    throw new CliError(`SEA build failed: ${result.error}`, 'SEA_BUILD_FAILED');
  }

  dlSpinner.succeed(`Built agenshield@${targetVersion} SEA binary`);

  // Clean up backups
  for (const name of binaryNames) {
    const bkPath = path.join(binDir, name) + '.bak';
    try {
      if (fs.existsSync(bkPath)) fs.unlinkSync(bkPath);
    } catch { /* ignore */ }
  }

  // Update version.json
  writeVersionInfo({
    version: targetVersion,
    channel: versionInfo?.channel ?? 'local',
    installedAt: versionInfo?.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    format: 'sea',
  });
  output.success(`Updated version.json (${currentVersion} → ${targetVersion})`);

  // If migrating from npm, clean up old dist directory
  if (options.migration) {
    const distDir = getDistDir();
    if (fs.existsSync(distDir)) {
      output.info('  Cleaning up old npm installation...');
      try {
        fs.rmSync(distDir, { recursive: true, force: true });
        output.success('Removed ~/.agenshield/dist/ (no longer needed with SEA binary)');
      } catch {
        output.warn('Could not remove old dist directory — you can delete it manually');
      }
    }
  }

  if (wasDaemonRunning) {
    const restartSpinner = await createSpinner('Restarting daemon...');
    const startResult = await startDaemon();
    if (startResult.success) {
      const url = `http://${DAEMON_CONFIG.DISPLAY_HOST}:${DAEMON_CONFIG.PORT}`;
      restartSpinner.succeed(startResult.message);
      output.info(`  URL: ${url}`);
      await runPostUpgrade();
    } else {
      restartSpinner.fail(startResult.message);
    }
  }

  output.info('');
  output.success(`Upgrade complete! (${currentVersion} → ${targetVersion})`);

  } finally {
    clearInterval(keepalive);
  }
}

// ---------------------------------------------------------------------------
// Legacy upgrade (stop -> update engine -> restart)
// ---------------------------------------------------------------------------

async function upgradeLegacy(options: {
  dryRun?: boolean;
  verbose?: boolean;
  force?: boolean;
  cli?: boolean;
  local?: boolean;
}): Promise<void> {
  const wasDaemonRunning = (await getDaemonStatus()).running;

  if (wasDaemonRunning && !options.dryRun) {
    output.info('Stopping daemon before upgrade...');
    const stopResult = await stopDaemon();
    if (!stopResult.success && stopResult.message !== 'Daemon is not running') {
      throw new CliError(stopResult.message, 'DAEMON_STOP_FAILED');
    }
    output.success(stopResult.message);
    output.info('');
  }

  await runUpdate({
    dryRun: options.dryRun,
    verbose: options.verbose,
    force: options.force,
    cli: options.cli,
    local: options.local,
  });

  if (!options.dryRun) {
    const status = await getDaemonStatus();
    if (!status.running) {
      output.info('Restarting daemon...');
      const startResult = await startDaemon();
      if (startResult.success) {
        const url = `http://${DAEMON_CONFIG.DISPLAY_HOST}:${DAEMON_CONFIG.PORT}`;
        output.success(startResult.message);
        output.info(`  URL: ${url}`);
        await runPostUpgrade();
      } else {
        output.error(startResult.message);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export function registerUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description('Upgrade AgenShield (stop, update, restart) (requires setup)')
    .option('--dry-run', 'Show what would be done without making changes', false)
    .option('-v, --verbose', 'Show verbose output', false)
    .option('--force', 'Re-apply even if already at latest version', false)
    .option('--local', 'Upgrade from local monorepo build output instead of npm', false)
    .option('--cli', 'Use terminal mode instead of web browser', false)
    .option('--sea', 'Migrate to Single Executable Application binary format', false)
    .action(withGlobals(async (opts) => {
      ensureSetupComplete();

      const format = detectInstallFormat();
      const requestSEA = opts['sea'] as boolean;

      // If --sea flag is set and current format is npm, migrate to SEA
      if (requestSEA && format !== 'sea') {
        output.info('');
        output.info('  AgenShield Upgrade (npm \u2192 SEA migration)');
        output.info('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
        output.info('');
        await upgradeSEAInstall({
          force: opts['force'] as boolean,
          verbose: opts['verbose'] as boolean,
          local: opts['local'] as boolean,
          migration: true,
        });
        return;
      }

      if (format === 'sea') {
        output.info('');
        output.info('  AgenShield Upgrade (SEA binary)');
        output.info('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
        output.info('');
        await upgradeSEAInstall({
          force: opts['force'] as boolean,
          verbose: opts['verbose'] as boolean,
          local: opts['local'] as boolean,
        });
      } else if (isLocalInstall()) {
        output.info('');
        output.info('  AgenShield Upgrade (local install)');
        output.info('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
        output.info('');
        await upgradeLocalInstall({
          force: opts['force'] as boolean,
          verbose: opts['verbose'] as boolean,
          local: opts['local'] as boolean,
        });
      } else {
        await upgradeLegacy({
          dryRun: opts['dryRun'] as boolean,
          verbose: opts['verbose'] as boolean,
          force: opts['force'] as boolean,
          cli: opts['cli'] as boolean,
          local: opts['local'] as boolean,
        });
      }
    }));
}
