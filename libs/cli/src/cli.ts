#!/usr/bin/env node
/**
 * AgenShield CLI
 *
 * Security CLI for AI agents. Provides commands for setting up, managing,
 * and monitoring the AgenShield security sandbox.
 *
 * @example
 * ```bash
 * # Show help
 * agenshield --help
 *
 * # Check status
 * agenshield status
 *
 * # Run setup wizard (requires root)
 * sudo agenshield setup
 *
 * # Manage daemon
 * sudo agenshield daemon start
 * agenshield daemon status
 * ```
 */

import { Command } from 'commander';
import { detectPrivileges } from './utils/privileges.js';
import {
  createSetupCommand,
  createStatusCommand,
  createDoctorCommand,
  createDaemonCommand,
  createUninstallCommand,
  createDevCommand,
} from './commands/index.js';

// Package version - will be replaced during build
const VERSION = '0.1.0';

/**
 * Create and configure the main CLI program
 */
function createProgram(): Command {
  const program = new Command();
  const priv = detectPrivileges();

  program
    .name('agenshield')
    .description('AgenShield - Security CLI for AI agents')
    .version(VERSION, '-V, --version', 'Output the version number')
    .addHelpText(
      'after',
      `
Current user: ${priv.username} (UID: ${priv.uid})${priv.isRoot ? ' [ROOT]' : ''}

Examples:
  $ agenshield status               Check current status
  $ agenshield doctor               Run diagnostics
  $ sudo agenshield setup           Run setup wizard
  $ sudo agenshield daemon start    Start daemon
  $ sudo agenshield dev             Dev mode with interactive TUI
  $ sudo agenshield dev clean       Clean dev environment
  $ sudo agenshield uninstall       Reverse isolation
`
    );

  // Register commands
  program.addCommand(createSetupCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createDoctorCommand());
  program.addCommand(createDaemonCommand());
  program.addCommand(createUninstallCommand());
  program.addCommand(createDevCommand());

  return program;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    console.error('Error:', (err as Error).message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
