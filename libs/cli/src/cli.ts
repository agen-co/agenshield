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
 * # Run setup wizard
 * agenshield setup
 * ```
 */

import { Command } from 'commander';
import { detectPrivileges } from './utils/privileges.js';
import { resolveGlobalOptions } from './utils/globals.js';
import { configureOutput } from './utils/output.js';
import { CliError } from './errors.js';
import {
  createSetupCommand,
  createStatusCommand,
  createDoctorCommand,
  createUninstallCommand,
  createDevCommand,
  createStartCommand,
  createStopCommand,
  createUpgradeCommand,
  createInstallCommand,
  createLogsCommand,
  createExecCommand,
  createAuthCommand,
  createCompletionCommand,
} from './commands/index.js';
import { getVersion } from './utils/version.js';

const VERSION = getVersion();

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
    .option('--json', 'Output machine-readable JSON to stdout')
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('--no-color', 'Disable colors (also respects NO_COLOR env)')
    .option('--debug', 'Show stack traces on errors')
    .addHelpText(
      'after',
      `
Current user: ${priv.username} (UID: ${priv.uid})${priv.isRoot ? ' [ROOT]' : ''}

Examples:
  $ agenshield start                Start daemon and open dashboard
  $ agenshield stop                 Stop daemon
  $ agenshield upgrade              Stop, update, and restart
  $ agenshield status               Check current status
  $ agenshield status --json        Machine-readable status
  $ agenshield doctor               Run diagnostics
  $ agenshield setup                Interactive setup wizard
  $ agenshield setup --mode local   Skip mode prompt (local)
  $ agenshield setup --mode cloud   Skip mode prompt (cloud)
  $ agenshield logs                 Stream daemon logs
  $ agenshield exec <target>        Open guarded shell for an agent user
  $ agenshield auth token ui        Print admin JWT for dashboard login
  $ agenshield auth token broker <id>  Generate broker JWT for a target
  $ agenshield install              Install locally to ~/.agenshield/
  $ agenshield dev                  Dev mode with interactive TUI
  $ agenshield dev clean            Clean dev environment
  $ agenshield completion zsh       Generate shell completions
  $ agenshield uninstall            Reverse isolation
`
    );

  // Register commands
  program.addCommand(createStartCommand());
  program.addCommand(createStopCommand());
  program.addCommand(createUpgradeCommand());
  program.addCommand(createSetupCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createDoctorCommand());
  program.addCommand(createUninstallCommand());
  program.addCommand(createDevCommand());
  program.addCommand(createInstallCommand());
  program.addCommand(createLogsCommand());
  program.addCommand(createExecCommand());
  program.addCommand(createAuthCommand());
  program.addCommand(createCompletionCommand());

  return program;
}

/**
 * Central error handler
 *
 * Formats errors per --json and --debug flags, exits with proper code.
 * Exit codes: 0 success, 1 general error, 2 usage error, 130 SIGINT.
 */
function handleError(err: unknown, debug: boolean, json: boolean): never {
  const error = err instanceof CliError ? err : new CliError(
    (err as Error).message ?? String(err),
    'UNKNOWN_ERROR',
  );

  if (json) {
    process.stdout.write(JSON.stringify(error.toJSON(), null, 2) + '\n');
  } else {
    process.stderr.write(`\x1b[31m\u2717 ${error.message}\x1b[0m\n`);
    if (debug && error.stack) {
      process.stderr.write(`\n${error.stack}\n`);
    }
  }

  process.exit(error.exitCode);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const program = createProgram();

  // Hook into Commander's pre-action to resolve global options
  program.hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    const globalOpts = resolveGlobalOptions(opts);
    configureOutput(globalOpts);
  });

  // Handle SIGINT gracefully
  process.on('SIGINT', () => {
    process.exit(130);
  });

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const opts = program.opts();
    handleError(err, !!opts['debug'], !!opts['json']);
  }
}

main().catch((err) => {
  handleError(err, false, false);
});
