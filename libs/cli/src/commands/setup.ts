/**
 * Setup command
 *
 * Runs the interactive setup wizard to sandbox a target application.
 * Supports presets (openclaw, custom) and configurable naming.
 * With --ui flag, launches a web-based setup wizard.
 */

import { Command } from 'commander';
import React from 'react';
import readline from 'node:readline';
import { render } from 'ink';
import { WizardApp } from '../wizard/index.js';
import { formatPresetList, getPreset } from '@agenshield/sandbox';
import { createWizardEngine } from '../wizard/engine.js';
import type { WizardOptions } from '../wizard/types.js';

/**
 * Check for an existing AgenShield installation and offer to uninstall it.
 * Equivalent to running `agenshield uninstall --skip-backup --force` before setup.
 */
async function checkExistingInstallation(options: { skipConfirm?: boolean }): Promise<void> {
  const { ensureSudoAccess } = await import('../utils/privileges.js');
  ensureSudoAccess();

  const { canUninstall, forceUninstall } = await import('@agenshield/sandbox');
  const check = canUninstall();

  if (!check.hasBackup) return; // No existing installation

  console.log('');
  console.log('  AgenShield is already installed.');
  if (check.backup) {
    console.log(`  Backup from: ${check.backup.timestamp}`);
  }
  console.log('');

  if (!options.skipConfirm) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question('  Uninstall existing installation and re-setup? [y/N] ', (ans) => {
        rl.close();
        resolve(ans);
      });
    });
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('');
      console.log('  Setup cancelled.');
      process.exit(0);
    }
  } else {
    console.log('  --skip-confirm: auto-uninstalling existing installation...');
  }

  // Stop daemon
  console.log('');
  console.log('  Stopping daemon...');
  const { stopDaemon } = await import('../utils/daemon.js');
  await stopDaemon();

  // Force uninstall
  console.log('  Uninstalling existing installation...');
  console.log('');
  const result = forceUninstall((progress) => {
    const icon = progress.success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`  ${icon} ${progress.step}: ${progress.message || progress.error || ''}`);
  });

  if (!result.success) {
    console.error('');
    console.error(`  \x1b[31mUninstall failed: ${result.error}\x1b[0m`);
    process.exit(1);
  }

  console.log('');
  console.log('  \x1b[32mExisting installation removed.\x1b[0m');
  console.log('  Proceeding with fresh setup...');
  console.log('');

  // Re-exec the setup command so it starts fresh after uninstall.
  // All original flags (-v, --target, --skip-confirm, etc.) carry over
  // via process.argv. The re-exec'd process will call canUninstall()
  // again, which returns hasBackup=false (already removed), so no loop.
  const { spawnSync } = await import('node:child_process');
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(child.status ?? 1);
}

/**
 * Run the setup wizard (CLI/Ink mode)
 */
async function runSetup(): Promise<void> {
  const { waitUntilExit } = render(React.createElement(WizardApp));
  await waitUntilExit();
}

/**
 * Run the setup wizard in web UI mode
 */
async function runSetupWebUI(wizardOptions: WizardOptions): Promise<void> {
  const { createSetupServer } = await import('../setup-server/index.js');

  console.log('');
  console.log('  Starting Web UI Setup Wizard...');
  console.log('');

  // Create wizard engine and run detection phase BEFORE server starts
  const engine = createWizardEngine(wizardOptions);
  const detectionResult = await engine.runDetectionPhase();

  if (!detectionResult.success) {
    console.error(`  Detection failed: ${detectionResult.error}`);
    process.exit(1);
  }

  if (engine.context.presetDetection?.found) {
    console.log(`  Detected: ${engine.context.preset?.name ?? 'Unknown target'}`);
  } else if (engine.context.targetInstallable) {
    console.log(`  No target found — Web UI will offer installation.`);
  } else {
    console.error('  No supported target found. Use --target custom --entry-point <path> for custom applications.');
    process.exit(1);
  }
  console.log('');

  // Acquire sudo credentials now (in the terminal) before opening the browser,
  // so the setup phase can use cached credentials without a TTY prompt.
  if (!wizardOptions.dryRun) {
    const { ensureSudoAccess } = await import('../utils/privileges.js');
    ensureSudoAccess();
  }

  // Create and start the setup server on a different port than daemon (5200)
  const server = createSetupServer(engine);
  const port = 5200; // Setup wizard uses 5200, daemon uses 5200
  const url = await server.start(port);

  console.log(`  Setup wizard is running at: ${url}`);
  console.log('');
  console.log('  Opening browser...');
  console.log('  (If the browser does not open, visit the URL above manually)');
  console.log('');

  // Open browser (macOS)
  try {
    const { exec } = await import('node:child_process');
    exec(`open "${url}"`);
  } catch {
    // Non-fatal — user can open the URL manually
  }

  // Wait for setup to complete or be cancelled (SIGINT/SIGTERM)
  const completionOrSignal = Promise.race([
    server.waitForCompletion(),
    new Promise<void>((resolve) => {
      process.on('SIGINT', resolve);
      process.on('SIGTERM', resolve);
    }),
  ]);

  await completionOrSignal;
  console.log('  Setup complete! Shutting down server...');
  await server.stop();

  // Stop any existing daemon first
  console.log('  Stopping any existing daemon...');
  const { startDaemon, stopDaemon } = await import('../utils/daemon.js');
  await stopDaemon();

  // Kill any process on port 5200 (daemon port)
  try {
    const { execSync } = await import('node:child_process');
    execSync('lsof -i :5200 -t 2>/dev/null | xargs kill -9 2>/dev/null || true', { encoding: 'utf-8' });
    await new Promise(r => setTimeout(r, 500));
  } catch { /* ignore */ }

  // Start the daemon on port 5200
  console.log('  Starting daemon...');
  const daemonResult = await startDaemon();
  if (daemonResult.success) {
    console.log(`  Daemon started (PID: ${daemonResult.pid})`);
    console.log(`  Dashboard available at: http://localhost:5200`);
  } else {
    console.warn(`  Warning: ${daemonResult.message}`);
  }

  // Force exit after grace period
  setTimeout(() => process.exit(0), 500).unref();
}

/**
 * Build WizardOptions from CLI options
 */
function buildWizardOptions(options: Record<string, unknown>): WizardOptions {
  const wizardOptions: WizardOptions = {};
  if (options['target']) wizardOptions.targetPreset = options['target'] as string;
  if (options['entryPoint']) wizardOptions.entryPoint = options['entryPoint'] as string;
  if (options['baseName']) wizardOptions.baseName = options['baseName'] as string;
  if (options['prefix']) wizardOptions.prefix = options['prefix'] as string;
  if (options['baseUid']) wizardOptions.baseUid = options['baseUid'] as number;
  if (options['dryRun']) wizardOptions.dryRun = true;
  if (options['skipConfirm']) wizardOptions.skipConfirm = true;
  if (options['verbose']) wizardOptions.verbose = true;
  return wizardOptions;
}

/**
 * Create the setup command
 */
export function createSetupCommand(): Command {
  const cmd = new Command('setup')
    .description('Run the setup wizard to sandbox a target application')
    .option('--target <preset>', 'Target preset to use: openclaw, custom (default: auto-detect)')
    .option('--entry-point <path>', 'Entry point for custom target (Node.js file)')
    .option('--base-name <name>', 'Base name for users/groups (default: agenshield)')
    .option('--prefix <prefix>', 'Use a custom prefix for users/groups (for testing)')
    .option('--base-uid <uid>', 'Base UID for created users', parseInt)
    .option('--dry-run', 'Show what would be done without making changes')
    .option('--skip-confirm', 'Skip confirmation prompts')
    .option('-v, --verbose', 'Show verbose output')
    .option('--list-presets', 'List available presets and exit')
    .option('--cli', 'Use terminal/Ink UI instead of web browser')
    .action(async (options) => {
      // Handle --list-presets
      if (options.listPresets) {
        console.log(formatPresetList());
        return;
      }

      // Validate --target option
      if (options.target) {
        const preset = getPreset(options.target);
        if (!preset) {
          console.error(`Error: Unknown preset '${options.target}'`);
          console.error('');
          console.error(formatPresetList());
          process.exit(1);
        }

        // Custom preset requires --entry-point
        if (options.target === 'custom' && !options.entryPoint) {
          console.error('Error: --entry-point is required when using --target custom');
          console.error('');
          console.error('Example:');
          console.error('  agenshield setup --target custom --entry-point /path/to/my-app/dist/index.js');
          process.exit(1);
        }
      }

      // Check for existing installation (skip in dry-run mode)
      if (!options.dryRun) {
        await checkExistingInstallation({ skipConfirm: options.skipConfirm });
      }

      // Default to Web UI unless --cli is specified or env var opts out
      if (!options.cli && process.env['AGENSHIELD_WEBUI_REQUESTED'] !== 'false') {
        delete process.env['AGENSHIELD_WEBUI_REQUESTED'];
        await runSetupWebUI(buildWizardOptions(options));
        return;
      }

      // Store options in environment for wizard to pick up
      if (options.target) {
        process.env['AGENSHIELD_TARGET'] = options.target;
      }
      if (options.entryPoint) {
        process.env['AGENSHIELD_ENTRY_POINT'] = options.entryPoint;
      }
      if (options.baseName) {
        process.env['AGENSHIELD_BASE_NAME'] = options.baseName;
      }
      if (options.prefix) {
        process.env['AGENSHIELD_PREFIX'] = options.prefix;
      }
      if (options.baseUid) {
        process.env['AGENSHIELD_BASE_UID'] = String(options.baseUid);
      }
      if (options.dryRun) {
        process.env['AGENSHIELD_DRY_RUN'] = 'true';
      }
      if (options.skipConfirm) {
        process.env['AGENSHIELD_SKIP_CONFIRM'] = 'true';
      }
      if (options.verbose) {
        process.env['AGENSHIELD_VERBOSE'] = 'true';
      }

      await runSetup();
    });

  return cmd;
}
