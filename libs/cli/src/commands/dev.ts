/**
 * Dev command
 *
 * Runs AgenShield in dev mode with an interactive TUI for testing sandbox actions.
 *
 * First run: wizard-like interactive setup (prerequisites, mode selection, confirmation).
 * Subsequent runs: detects existing dev user, skips setup, starts daemon, opens TUI.
 * `agenshield dev clean`: stops daemon, removes dev users/groups, cleans state.
 */

import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { ensureSudoAccess } from '../utils/privileges.js';
import { startDaemon, stopDaemon, getDaemonStatus } from '../utils/daemon.js';
import {
  loadDevState,
  saveDevState,
  deleteDevState,
  devStateExists,
  DevApp,
  DevSetupApp,
  type DevState,
} from '../dev-tui/index.js';
import {
  createUserConfig,
  deleteAllUsersAndGroups,
  removeAllDirectories,
  userExists,
  installGuardedShell,
  GUARDED_SHELL_PATH,
} from '@agenshield/sandbox';
import { findTestHarness } from '../utils/find-test-harness.js';

const DEV_PREFIX = 'dev';
const DEV_BASE_NAME = 'default';
const DEV_BASE_UID = 5400;
const DEV_BASE_GID = 5300;

/**
 * Launch the Web UI setup server in the browser
 */
async function runDevWebUI(options: { baseName?: string; prefix?: string; baseUid?: number; tui: boolean }): Promise<void> {
  // Dynamic import to avoid pulling in server deps unless needed
  const { createSetupServer } = await import('../setup-server/server.js');
  const { createWizardEngine } = await import('../wizard/engine.js');

  // The wizard engine will auto-detect the dev-harness preset
  const engine = createWizardEngine({
    prefix: options.prefix || DEV_PREFIX,
    baseName: options.baseName || DEV_BASE_NAME,
    baseUid: options.baseUid || DEV_BASE_UID,
    baseGid: DEV_BASE_GID,
  });
  const detectionResult = await engine.runDetectionPhase();
  if (!detectionResult.success) {
    console.log(`Warning: Detection phase issue: ${detectionResult.error}`);
  }

  // Acquire sudo credentials now (in the terminal) before opening the browser,
  // so the setup phase can use cached credentials without a TTY prompt.
  ensureSudoAccess();

  const server = createSetupServer(engine);
  const url = await server.start(5200);
  console.log(`Web UI available at: ${url}`);

  // Open browser (already running as user, so default browser is correct)
  try {
    execSync(`open ${url}`, { stdio: 'pipe' });
  } catch { /* Non-macOS or open failed */ }

  // Wait for setup completion OR SIGINT
  const completionOrSignal = Promise.race([
    server.waitForCompletion(),
    new Promise<void>((resolve) => {
      process.on('SIGINT', resolve);
      process.on('SIGTERM', resolve);
    }),
  ]);

  await completionOrSignal;
  console.log('\nShutting down Web UI server...');
  await server.stop();

  // Start daemon now that port is free
  console.log('Starting daemon...');
  const daemonResult = await startDaemon();
  if (daemonResult.success) {
    console.log(`Daemon started (PID: ${daemonResult.pid})`);
  } else {
    console.warn(`Warning: ${daemonResult.message}`);
  }

  // Force exit after grace period
  setTimeout(() => process.exit(0), 1000).unref();
}

/**
 * Run dev mode: detect state → wizard setup or skip → start daemon → render TUI → stop daemon
 */
async function runDevMode(options: {
  baseName?: string;
  prefix?: string;
  baseUid?: number;
  tui: boolean;
}): Promise<void> {
  let state: DevState | null = null;

  // Check for existing dev state
  if (devStateExists()) {
    state = loadDevState();
    if (state) {
      // Verify user still exists
      const exists = await userExists(state.agentUsername);
      if (!exists) {
        console.log(`Dev user ${state.agentUsername} no longer exists. Re-creating...`);
        console.log('');
        state = null;
        deleteDevState();
      } else {
        console.log(`Resuming dev session (user: ${state.agentUsername})`);

        const cfg = createUserConfig({
          prefix: state.prefix,
          baseName: state.baseName,
          baseUid: state.baseUid,
          baseGid: state.baseGid,
        });

        // Ensure nodePath is set (backcompat with older state files)
        if (!state.nodePath) {
          const agentBinDir = path.join(cfg.agentUser.home, 'bin');
          const nodeDest = path.join(agentBinDir, 'node');
          if (!fs.existsSync(nodeDest)) {
            try {
              execSync(`sudo mkdir -p "${agentBinDir}"`, { stdio: 'pipe' });
              execSync(`sudo cp "${process.execPath}" "${nodeDest}"`, { stdio: 'pipe' });
              execSync(`sudo chmod 755 "${nodeDest}"`, { stdio: 'pipe' });
            } catch {
              // Best effort
            }
          }
          state.nodePath = nodeDest;
        }

        // Backcompat: ensure skillsDir is set
        if (!state.skillsDir) {
          state.skillsDir = path.join(cfg.agentUser.home, '.openclaw-dev', 'skills');
        }
        if (!state.installedSkills) {
          state.installedSkills = [];
        }

        // Re-copy test harness if path points outside agent home
        if (state.testHarnessPath && !state.testHarnessPath.startsWith(cfg.agentUser.home)) {
          const harnessSource = findTestHarness();
          if (harnessSource) {
            const harnessDestPath = path.join(cfg.agentUser.home, 'bin', 'dummy-openclaw.js');
            try {
              execSync(`sudo cp "${harnessSource}" "${harnessDestPath}"`, { stdio: 'pipe' });
              execSync(`sudo chmod 755 "${harnessDestPath}"`, { stdio: 'pipe' });
              state.testHarnessPath = harnessDestPath;
            } catch { /* best effort */ }
          }
        }

        // Update lastUsedAt
        state.lastUsedAt = new Date().toISOString();
        saveDevState(state);
      }
    }
  }

  // First run: interactive wizard-like setup
  if (!state) {
    let resolvedState: DevState | null = null;
    let webuiRequested = false;

    const { waitUntilExit } = render(
      React.createElement(DevSetupApp, {
        options: {
          prefix: options.prefix || DEV_PREFIX,
          baseName: options.baseName,
          baseUid: options.baseUid,
          baseGid: DEV_BASE_GID,
        },
        onComplete: (devState: DevState) => {
          resolvedState = devState;
        },
        onWebUI: () => {
          webuiRequested = true;
        },
      })
    );
    await waitUntilExit();

    if (webuiRequested) {
      await runDevWebUI(options);
      return;
    }

    if (!resolvedState) {
      console.log('Setup cancelled.');
      process.exit(0);
    }

    state = resolvedState;

    const saveResult = saveDevState(state);
    if (!saveResult.success) {
      console.log(`Warning: could not persist dev state: ${saveResult.error}`);
    }
  }

  // Start daemon
  console.log('Starting daemon...');
  const daemonResult = await startDaemon();
  if (!daemonResult.success) {
    console.log(`Warning: ${daemonResult.message}`);
    console.log('TUI will start but daemon status may show as stopped.');
  } else {
    console.log(`Daemon: ${daemonResult.message}`);
  }
  console.log('');

  if (options.tui) {
    // Render interactive TUI
    const { waitUntilExit } = render(React.createElement(DevApp, { devState: state }));
    await waitUntilExit();
  } else {
    // Headless mode: wait for SIGINT/SIGTERM
    console.log('Dev environment running. Press Ctrl+C to stop.');
    await new Promise<void>((resolve) => {
      process.on('SIGINT', resolve);
      process.on('SIGTERM', resolve);
    });
  }

  // Stop daemon on exit
  console.log('');
  console.log('Stopping daemon...');
  const stopResult = await stopDaemon();
  console.log(stopResult.message);
}

/**
 * Clean dev environment: stop daemon, remove users/groups, delete state
 */
async function runDevClean(): Promise<void> {
  console.log('Cleaning dev environment...');
  console.log('');

  // Stop daemon first
  console.log('Stopping daemon...');
  const stopResult = await stopDaemon();
  console.log(`  ${stopResult.message}`);

  // Load state to get config
  const state = loadDevState();
  const config = createUserConfig({
    prefix: state?.prefix || DEV_PREFIX,
    baseName: state?.baseName || DEV_BASE_NAME,
    baseUid: state?.baseUid || DEV_BASE_UID,
    baseGid: state?.baseGid || DEV_BASE_GID,
  });

  // Remove dev skills/config directory
  if (state?.skillsDir) {
    const devConfigDir = path.dirname(state.skillsDir); // .openclaw-dev
    console.log('Removing dev skills directory...');
    try {
      execSync(`rm -rf "${devConfigDir}"`, { stdio: 'pipe' });
      console.log('  ✓ Dev skills directory removed');
    } catch {
      console.log('  ✗ Could not remove dev skills directory');
    }
  }

  // Remove directories
  console.log('Removing directories...');
  const dirResults = await removeAllDirectories(config);
  for (const r of dirResults) {
    console.log(`  ${r.success ? '✓' : '✗'} ${r.message}`);
  }

  // Delete users and groups
  console.log('Removing users and groups...');
  const deleteResult = await deleteAllUsersAndGroups(config);
  for (const r of deleteResult.users) {
    console.log(`  ${r.success ? '✓' : '✗'} ${r.message}`);
  }
  for (const r of deleteResult.groups) {
    console.log(`  ${r.success ? '✓' : '✗'} ${r.message}`);
  }

  // Delete state file
  console.log('Removing dev state...');
  deleteDevState();

  console.log('');
  console.log('Dev environment cleaned. You can start fresh with: agenshield dev');
}

/**
 * Open an interactive login shell as the sandboxed agent user
 */
async function runDevShell(options: { noDaemon: boolean }): Promise<void> {
  // 1. Verify dev environment is set up
  if (!devStateExists()) {
    console.error('Dev environment not set up. Run "agenshield dev" first to create the sandbox.');
    process.exit(1);
  }

  const state = loadDevState();
  if (!state) {
    console.error('Dev state could not be loaded. Run "agenshield dev" to set up.');
    process.exit(1);
  }

  // 2. Verify agent user exists
  const exists = await userExists(state.agentUsername);
  if (!exists) {
    console.error(`Agent user ${state.agentUsername} does not exist. Run "agenshield dev" to re-create.`);
    process.exit(1);
  }

  // 3. Ensure guarded-shell is installed
  if (!fs.existsSync(GUARDED_SHELL_PATH)) {
    console.log('Installing guarded-shell...');
    const gsResult = await installGuardedShell();
    if (!gsResult.success) {
      console.error(`Failed to install guarded-shell: ${gsResult.message}`);
      process.exit(1);
    }
    console.log('Guarded-shell installed.');
  }

  // 4. Start daemon if needed (unless --no-daemon)
  let daemonStartedByUs = false;
  if (!options.noDaemon) {
    const status = await getDaemonStatus();
    if (!status.running) {
      console.log('Starting daemon...');
      const daemonResult = await startDaemon();
      if (daemonResult.success) {
        console.log(`Daemon started (PID: ${daemonResult.pid})`);
        daemonStartedByUs = true;
      } else {
        console.warn(`Warning: ${daemonResult.message}`);
      }
    }
  }

  // 5. Resolve agent home and list available commands
  const cfg = createUserConfig({
    prefix: state.prefix,
    baseName: state.baseName,
    baseUid: state.baseUid,
    baseGid: state.baseGid,
  });
  const agentHome = cfg.agentUser.home;
  const binDir = path.join(agentHome, 'bin');
  let binContents: string[] = [];
  try {
    binContents = fs.readdirSync(binDir);
  } catch {
    // bin dir may not exist
  }

  // 6. Print info
  console.log('');
  console.log('Opening sandboxed shell');
  console.log(`  User:  ${state.agentUsername}`);
  console.log(`  Home:  ${agentHome}`);
  console.log(`  PATH:  $HOME/bin`);
  console.log(`  Shell: ${GUARDED_SHELL_PATH}`);
  console.log('');
  if (binContents.length > 0) {
    console.log(`  Available commands (${binContents.length}):`);
    for (const cmd of binContents) {
      console.log(`    - ${cmd}`);
    }
  } else {
    console.log('  No commands found in $HOME/bin');
  }
  console.log('');
  console.log('Type exit to leave the sandboxed shell.');
  console.log('---');

  // 7. Spawn interactive login shell as agent user
  spawnSync('sudo', ['-u', state.agentUsername, '-i'], { stdio: 'inherit' });

  // 8. Shell exited
  console.log('');
  console.log('Shell session ended.');

  // 9. Stop daemon if we started it
  if (daemonStartedByUs) {
    console.log('Stopping daemon...');
    const stopResult = await stopDaemon();
    console.log(stopResult.message);
  }
}

/**
 * Create the dev command
 */
export function createDevCommand(): Command {
  const cmd = new Command('dev')
    .description('Run AgenShield in dev mode with interactive TUI for testing sandbox actions')
    .option('--base-name <name>', 'Base name for users/groups (skip mode selection prompt)')
    .option('--prefix <prefix>', 'Custom prefix (default: dev)')
    .option('--base-uid <uid>', 'Base UID for users', parseInt)
    .option('--no-tui', 'Start daemon without interactive TUI')
    .action(async (opts) => {
      await runDevMode({
        baseName: opts.baseName,
        prefix: opts.prefix,
        baseUid: opts.baseUid,
        tui: opts.tui !== false,
      });
    });

  cmd
    .command('clean')
    .description('Stop daemon, remove dev users/groups, and clean up dev state')
    .action(async () => {
      ensureSudoAccess();
      await runDevClean();
    });

  cmd
    .command('shell')
    .description('Open an interactive login shell as the sandboxed agent user')
    .option('--no-daemon', 'Skip automatic daemon start/stop')
    .action(async (opts) => {
      ensureSudoAccess();
      await runDevShell({ noDaemon: opts.daemon === false });
    });

  return cmd;
}
