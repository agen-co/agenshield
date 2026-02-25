/**
 * Update command
 *
 * Non-destructive update that preserves all users, groups, configs, and data.
 * Runs version-specific migrations, redeploys artifacts, and restarts services.
 * Shows release notes and progress via Web UI (same pattern as setup).
 */

import { Command } from 'commander';
import { createUpdateEngine } from '../update/engine.js';
import type { UpdateEngineOptions } from '../update/types.js';

/**
 * Run the update in web UI mode
 */
async function runUpdateWebUI(engineOptions: UpdateEngineOptions): Promise<void> {
  const { createUpdateServer } = await import('../update-server/index.js');

  console.log('');
  console.log('  Starting AgenShield Update...');
  console.log('');

  // Create engine and run preflight
  const engine = createUpdateEngine(engineOptions);
  const preflight = await engine.preflight();

  if (!preflight.updateNeeded && !engineOptions.force && !engineOptions.local) {
    console.log(`  Already at latest version (${preflight.currentVersion}).`);
    console.log('  Use --force to re-apply the update.');
    return;
  }

  console.log(`  Updating: ${preflight.currentVersion} -> ${preflight.targetVersion}`);
  console.log(`  Pending migrations: ${preflight.pendingMigrationCount}`);
  console.log('');

  // Acquire sudo credentials in the terminal (skip in local mode)
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
      console.log(`  Stopping existing process on port ${port} (PID: ${pids.split('\n').join(', ')})...`);
      execSync(`lsof -ti :${port} -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true`, { encoding: 'utf-8' });
      await new Promise(r => setTimeout(r, 500));
    }
  } catch { /* ignore */ }

  // Create and start the update server
  const server = createUpdateServer(engine);
  const url = await server.start(port);

  console.log(`  Update UI is running at: ${url}`);
  console.log('');
  console.log('  Opening browser...');
  console.log('  (If the browser does not open, visit the URL above manually)');
  console.log('');

  // Open browser
  try {
    const { exec } = await import('node:child_process');
    exec(`open "${url}"`);
  } catch { /* non-fatal */ }

  // Wait for completion or signal
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
    console.log('\n  Update cancelled.');
    process.exit(130);
  }

  if (engine.state.hasError) {
    console.log('  Update completed with errors. Check the UI for details.');
    process.exit(1);
  }

  console.log('  Update complete!');

  // Force exit after grace period
  setTimeout(() => process.exit(0), 500).unref();
}

/**
 * Run the update in CLI mode (terminal output)
 */
async function runUpdateCLI(engineOptions: UpdateEngineOptions): Promise<void> {
  console.log('');
  console.log('  AgenShield Update (CLI mode)');
  console.log('');

  const engine = createUpdateEngine(engineOptions);
  const preflight = await engine.preflight();

  if (!preflight.updateNeeded && !engineOptions.force && !engineOptions.local) {
    console.log(`  Already at latest version (${preflight.currentVersion}).`);
    console.log('  Use --force to re-apply the update.');
    return;
  }

  console.log(`  Updating: ${preflight.currentVersion} -> ${preflight.targetVersion}`);
  console.log(`  Pending migrations: ${preflight.pendingMigrationCount}`);
  console.log('');

  // Show release notes
  if (preflight.releaseNotes && preflight.releaseNotes !== 'No new release notes.') {
    console.log('  Release Notes:');
    console.log('  ─────────────');
    for (const line of preflight.releaseNotes.split('\n')) {
      console.log(`  ${line}`);
    }
    console.log('');
  }

  if (engineOptions.dryRun) {
    console.log('  [dry-run] Steps that would be executed:');
    for (const step of engine.state.steps) {
      console.log(`    - ${step.name}: ${step.description}`);
    }

    engine.onStateChange = (state) => {
      const running = state.steps.find(s => s.status === 'running');
      if (running) {
        console.log(`  [dry-run] ${running.name}`);
      }
    };

    await engine.execute();
  } else {
    // Acquire sudo (skip in local mode)
    const keepalive = engineOptions.local
      ? undefined
      : await (async () => {
          const { ensureSudoAccess, startSudoKeepalive } = await import('../utils/privileges.js');
          ensureSudoAccess();
          return startSudoKeepalive();
        })();

    try {
      // Wire up terminal progress
      engine.onStateChange = (state) => {
        const running = state.steps.find(s => s.status === 'running');
        if (running) {
          process.stdout.write(`\r  ⏳ ${running.name}...`);
        }

        const justCompleted = state.steps.filter(s => s.status === 'completed' || s.status === 'skipped');
        const justErrored = state.steps.filter(s => s.status === 'error');
        const total = state.steps.length;
        const done = justCompleted.length;
        const errored = justErrored.length;

        if (done + errored === total) {
          console.log('');
          if (errored > 0) {
            console.log(`  \x1b[31m✗ Update completed with ${errored} error(s)\x1b[0m`);
            for (const s of justErrored) {
              console.log(`    - ${s.name}: ${s.error}`);
            }
          } else {
            console.log(`  \x1b[32m✓ Update completed successfully (${done} steps)\x1b[0m`);
          }
        }
      };

      await engine.execute();
    } finally {
      if (keepalive) clearInterval(keepalive);
    }
  }

  console.log('');

  // Force exit after grace period
  setTimeout(() => process.exit(0), 500).unref();
}

/**
 * Run the update flow — shared entry point for both `agenshield update` and
 * `agenshield setup` when the user chooses "Update" on an existing installation.
 */
export async function runUpdate(options: {
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

/**
 * Create the update command
 */
export function createUpdateCommand(): Command {
  const cmd = new Command('update')
    .description('Update AgenShield without reinstalling (preserves users, data, configs)')
    .option('--cli', 'Use terminal mode instead of web browser')
    .option('--dry-run', 'Show what would be done without making changes')
    .option('-v, --verbose', 'Show verbose output')
    .option('--force', 'Re-apply even if already at latest version')
    .option('--local', 'Run full pipeline from local build (dev testing)')
    .action(async (options) => {
      await runUpdate({
        dryRun: options.dryRun,
        verbose: options.verbose,
        force: options.force,
        cli: options.cli,
        local: options.local,
      });
    });

  return cmd;
}
