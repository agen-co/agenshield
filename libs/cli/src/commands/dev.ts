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
import { output } from '../utils/output.js';
import { ensureSetupComplete } from '../utils/setup-guard.js';
import { CliError } from '../errors.js';
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
  const { createSetupServer } = await import('../setup-server/server.js');
  const { createWizardEngine } = await import('../wizard/engine.js');

  const engine = createWizardEngine({
    prefix: options.prefix || DEV_PREFIX,
    baseName: options.baseName || DEV_BASE_NAME,
    baseUid: options.baseUid || DEV_BASE_UID,
    baseGid: DEV_BASE_GID,
  });
  const detectionResult = await engine.runDetectionPhase();
  if (!detectionResult.success) {
    output.warn(`Detection phase issue: ${detectionResult.error}`);
  }

  ensureSudoAccess();

  const server = createSetupServer(engine);
  const url = await server.start(5200);
  output.info(`Web UI available at: ${url}`);

  try {
    execSync(`open ${url}`, { stdio: 'pipe' });
  } catch { /* Non-macOS or open failed */ }

  const completionOrSignal = Promise.race([
    server.waitForCompletion(),
    new Promise<void>((resolve) => {
      process.on('SIGINT', resolve);
      process.on('SIGTERM', resolve);
    }),
  ]);

  await completionOrSignal;
  output.info('\nShutting down Web UI server...');
  await server.stop();

  output.info('Starting daemon...');
  const daemonResult = await startDaemon();
  if (daemonResult.success) {
    output.info(`Daemon started (PID: ${daemonResult.pid})`);
  } else {
    output.warn(daemonResult.message);
  }

  setTimeout(() => process.exit(0), 1000).unref();
}

/**
 * Run dev mode: detect state -> wizard setup or skip -> start daemon -> render TUI -> stop daemon
 */
async function runDevMode(options: {
  baseName?: string;
  prefix?: string;
  baseUid?: number;
  tui: boolean;
}): Promise<void> {
  let state: DevState | null = null;

  if (devStateExists()) {
    state = loadDevState();
    if (state) {
      const exists = await userExists(state.agentUsername);
      if (!exists) {
        output.info(`Dev user ${state.agentUsername} no longer exists. Re-creating...`);
        output.info('');
        state = null;
        deleteDevState();
      } else {
        output.info(`Resuming dev session (user: ${state.agentUsername})`);

        const cfg = createUserConfig({
          prefix: state.prefix,
          baseName: state.baseName,
          baseUid: state.baseUid,
          baseGid: state.baseGid,
        });

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

        if (!state.skillsDir) {
          state.skillsDir = path.join(cfg.agentUser.home, '.openclaw-dev', 'skills');
        }
        if (!state.installedSkills) {
          state.installedSkills = [];
        }

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

        state.lastUsedAt = new Date().toISOString();
        saveDevState(state);
      }
    }
  }

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
      output.info('Setup cancelled.');
      return;
    }

    state = resolvedState;

    const saveResult = saveDevState(state);
    if (!saveResult.success) {
      output.warn(`could not persist dev state: ${saveResult.error}`);
    }
  }

  output.info('Starting daemon...');
  const daemonResult = await startDaemon();
  if (!daemonResult.success) {
    output.warn(daemonResult.message);
    output.info('TUI will start but daemon status may show as stopped.');
  } else {
    output.info(`Daemon: ${daemonResult.message}`);
  }
  output.info('');

  if (options.tui) {
    const { waitUntilExit } = render(React.createElement(DevApp, { devState: state }));
    await waitUntilExit();
  } else {
    output.info('Dev environment running. Press Ctrl+C to stop.');
    await new Promise<void>((resolve) => {
      process.on('SIGINT', resolve);
      process.on('SIGTERM', resolve);
    });
  }

  output.info('');
  output.info('Stopping daemon...');
  const stopResult = await stopDaemon();
  output.info(stopResult.message);
}

/**
 * Clean dev environment: stop daemon, remove users/groups, delete state
 */
async function runDevClean(): Promise<void> {
  output.info('Cleaning dev environment...');
  output.info('');

  output.info('Stopping daemon...');
  const stopResult = await stopDaemon();
  output.info(`  ${stopResult.message}`);

  const state = loadDevState();
  const config = createUserConfig({
    prefix: state?.prefix || DEV_PREFIX,
    baseName: state?.baseName || DEV_BASE_NAME,
    baseUid: state?.baseUid || DEV_BASE_UID,
    baseGid: state?.baseGid || DEV_BASE_GID,
  });

  if (state?.skillsDir) {
    const devConfigDir = path.dirname(state.skillsDir);
    output.info('Removing dev skills directory...');
    try {
      execSync(`rm -rf "${devConfigDir}"`, { stdio: 'pipe' });
      output.info('  \u2713 Dev skills directory removed');
    } catch {
      output.info('  \u2717 Could not remove dev skills directory');
    }
  }

  output.info('Removing directories...');
  const dirResults = await removeAllDirectories(config);
  for (const r of dirResults) {
    output.info(`  ${r.success ? '\u2713' : '\u2717'} ${r.message}`);
  }

  output.info('Removing users and groups...');
  const deleteResult = await deleteAllUsersAndGroups(config);
  for (const r of deleteResult.users) {
    output.info(`  ${r.success ? '\u2713' : '\u2717'} ${r.message}`);
  }
  for (const r of deleteResult.groups) {
    output.info(`  ${r.success ? '\u2713' : '\u2717'} ${r.message}`);
  }

  output.info('Removing dev state...');
  deleteDevState();

  output.info('');
  output.info('Dev environment cleaned. You can start fresh with: agenshield dev');
}

/**
 * Open an interactive login shell as the sandboxed agent user
 */
async function runDevShell(options: { noDaemon: boolean }): Promise<void> {
  if (!devStateExists()) {
    throw new CliError('Dev environment not set up. Run "agenshield dev" first to create the sandbox.', 'DEV_NOT_SETUP');
  }

  const state = loadDevState();
  if (!state) {
    throw new CliError('Dev state could not be loaded. Run "agenshield dev" to set up.', 'DEV_STATE_ERROR');
  }

  const exists = await userExists(state.agentUsername);
  if (!exists) {
    throw new CliError(`Agent user ${state.agentUsername} does not exist. Run "agenshield dev" to re-create.`, 'DEV_USER_MISSING');
  }

  if (!fs.existsSync(GUARDED_SHELL_PATH)) {
    output.info('Installing guarded-shell...');
    const gsResult = await installGuardedShell();
    if (!gsResult.success) {
      throw new CliError(`Failed to install guarded-shell: ${gsResult.message}`, 'SHELL_INSTALL_FAILED');
    }
    output.info('Guarded-shell installed.');
  }

  let daemonStartedByUs = false;
  if (!options.noDaemon) {
    const status = await getDaemonStatus();
    if (!status.running) {
      output.info('Starting daemon...');
      const daemonResult = await startDaemon();
      if (daemonResult.success) {
        output.info(`Daemon started (PID: ${daemonResult.pid})`);
        daemonStartedByUs = true;
      } else {
        output.warn(daemonResult.message);
      }
    }
  }

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

  output.info('');
  output.info('Opening sandboxed shell');
  output.info(`  User:  ${state.agentUsername}`);
  output.info(`  Home:  ${agentHome}`);
  output.info(`  PATH:  $HOME/bin`);
  output.info(`  Shell: ${GUARDED_SHELL_PATH}`);
  output.info('');
  if (binContents.length > 0) {
    output.info(`  Available commands (${binContents.length}):`);
    for (const cmd of binContents) {
      output.info(`    - ${cmd}`);
    }
  } else {
    output.info('  No commands found in $HOME/bin');
  }
  output.info('');
  output.info('Type exit to leave the sandboxed shell.');
  output.info('---');

  spawnSync('sudo', ['-u', state.agentUsername, '-i'], { stdio: 'inherit' });

  output.info('');
  output.info('Shell session ended.');

  if (daemonStartedByUs) {
    output.info('Stopping daemon...');
    const stopResult2 = await stopDaemon();
    output.info(stopResult2.message);
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
      ensureSetupComplete();
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
