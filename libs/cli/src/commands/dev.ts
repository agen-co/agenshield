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
import { ensureRoot } from '../utils/privileges.js';
import { startDaemon, stopDaemon } from '../utils/daemon.js';
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
} from '@agenshield/sandbox';

const DEV_PREFIX = 'dev';
const DEV_BASE_NAME = 'default';
const DEV_BASE_UID = 5400;
const DEV_BASE_GID = 5300;

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

        // Ensure nodePath is set (backcompat with older state files)
        if (!state.nodePath) {
          const cfg = createUserConfig({
            prefix: state.prefix,
            baseName: state.baseName,
            baseUid: state.baseUid,
            baseGid: state.baseGid,
          });
          const agentBinDir = path.join(cfg.agentUser.home, 'bin');
          const nodeDest = path.join(agentBinDir, 'node');
          if (!fs.existsSync(nodeDest)) {
            try {
              fs.mkdirSync(agentBinDir, { recursive: true });
              fs.copyFileSync(process.execPath, nodeDest);
              fs.chmodSync(nodeDest, 0o755);
            } catch {
              // Best effort
            }
          }
          state.nodePath = nodeDest;
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
      })
    );
    await waitUntilExit();

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
      ensureRoot('dev');
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
      ensureRoot('dev clean');
      await runDevClean();
    });

  return cmd;
}
