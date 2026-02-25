/**
 * Upgrade command
 *
 * Dual-path upgrade logic:
 *  - Local install (~/.agenshield/dist/) -> npm-pack download with rollback
 *  - Legacy (global npm / monorepo)      -> stop + update engine + restart
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { stopDaemon, startDaemon, getDaemonStatus, DAEMON_CONFIG } from '../utils/daemon.js';
import {
  isLocalInstall,
  readVersionInfo,
  writeVersionInfo,
  getDistDir,
  queryLatestVersion,
  downloadAndExtract,
  installFromLocal,
  findMonorepoRoot,
  writeShim,
  getLocalCliEntry,
} from '../utils/home.js';
import { output } from '../utils/output.js';
import { ensureSetupComplete } from '../utils/setup-guard.js';
import { CliError } from '../errors.js';
import type { UpdateEngineOptions } from '../update/types.js';

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
    output.info('  Checking npm registry for latest version...');
    try {
      targetVersion = queryLatestVersion();
    } catch (err) {
      throw new CliError(`Failed to query npm registry: ${(err as Error).message}`, 'REGISTRY_ERROR');
    }

    output.info(`  Latest version:  ${targetVersion}`);
  }

  if (currentVersion === targetVersion && !options.force) {
    output.info('');
    output.success(`Already at latest version (${currentVersion}).`);
    output.info('  Use --force to re-download.');
    return;
  }

  // Stop daemon if running
  const wasDaemonRunning = (await getDaemonStatus()).running;
  if (wasDaemonRunning) {
    output.info('  Stopping daemon...');
    const stopResult = await stopDaemon();
    if (!stopResult.success && stopResult.message !== 'Daemon is not running') {
      throw new CliError(stopResult.message, 'DAEMON_STOP_FAILED');
    }
    output.success(stopResult.message);
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

  if (options.local) {
    const repoRoot = findMonorepoRoot()!;
    output.info(`  Installing agenshield@${targetVersion} from local build...`);
    result = installFromLocal(repoRoot);
  } else {
    output.info(`  Downloading agenshield@${targetVersion}...`);
    result = downloadAndExtract(targetVersion);
  }

  if (!result.success) {
    output.error(`Install failed: ${result.error}`);
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
    output.error(`CLI entry point not found at ${cliEntry}`);
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

  output.success(`Installed agenshield@${targetVersion}`);

  writeShim();
  writeVersionInfo({
    ...versionInfo,
    version: targetVersion,
    updatedAt: new Date().toISOString(),
  });
  output.success(`Updated version.json (${currentVersion} \u2192 ${targetVersion})`);

  if (wasDaemonRunning) {
    output.info('  Restarting daemon...');
    const startResult = await startDaemon();
    if (startResult.success) {
      const url = `http://${DAEMON_CONFIG.DISPLAY_HOST}:${DAEMON_CONFIG.PORT}`;
      output.success(startResult.message);
      output.info(`  URL: ${url}`);
    } else {
      output.error(startResult.message);
    }
  }

  output.info('');
  output.success(`Upgrade complete! (${currentVersion} \u2192 ${targetVersion})`);
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
      } else {
        output.error(startResult.message);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

/**
 * Create the upgrade command
 */
export function createUpgradeCommand(): Command {
  const cmd = new Command('upgrade')
    .description('Upgrade AgenShield (stop, update, restart)')
    .option('--dry-run', 'Show what would be done without making changes')
    .option('-v, --verbose', 'Show verbose output')
    .option('--force', 'Re-apply even if already at latest version')
    .option('--local', 'Upgrade from local monorepo build output instead of npm')
    .option('--cli', 'Use terminal mode instead of web browser')
    .action(async (options) => {
      ensureSetupComplete();
      if (isLocalInstall()) {
        output.info('');
        output.info('  AgenShield Upgrade (local install)');
        output.info('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
        output.info('');
        await upgradeLocalInstall({
          force: options.force,
          verbose: options.verbose,
          local: options.local,
        });
      } else {
        await upgradeLegacy({
          dryRun: options.dryRun,
          verbose: options.verbose,
          force: options.force,
          cli: options.cli,
          local: options.local,
        });
      }
    });

  return cmd;
}
