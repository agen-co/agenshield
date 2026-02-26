#!/usr/bin/env node
/**
 * AgenShield CLI
 *
 * Security CLI for AI agents. Uses Commander.js for command routing.
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
import { getVersion } from './utils/version.js';

import { registerStartCommand } from './commands/start.js';
import { registerStopCommand } from './commands/stop.js';
import { registerUpgradeCommand } from './commands/upgrade.js';
import { registerSetupCommand } from './commands/setup.js';
import { registerStatusCommand } from './commands/status.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerUninstallCommand } from './commands/uninstall.js';
import { registerDevCommands } from './commands/dev.js';
import { registerInstallCommand } from './commands/install.js';
import { registerLogsCommand } from './commands/logs.js';
import { registerExecCommand } from './commands/exec.js';
import { registerAuthCommands } from './commands/auth-cmd.js';
import { registerCompletionCommand } from './commands/completion.js';

const VERSION = getVersion();

const program = new Command()
  .name('agenshield')
  .version(VERSION)
  .description('Security CLI for AI agents')
  .option('--json', 'Output machine-readable JSON', false)
  .option('-q, --quiet', 'Suppress non-essential output', false)
  .option('--no-color', 'Disable colors')
  .option('--debug', 'Show stack traces on errors', false);

// Daemon
registerStartCommand(program);
registerStopCommand(program);
registerUpgradeCommand(program);
registerStatusCommand(program);

// Setup & Maintenance
registerSetupCommand(program);
registerDoctorCommand(program);
registerUninstallCommand(program);
registerInstallCommand(program);
registerCompletionCommand(program);

// Development
registerDevCommands(program);
registerExecCommand(program);
registerLogsCommand(program);

// Authentication
registerAuthCommands(program);

// Handle SIGINT gracefully
process.on('SIGINT', () => {
  process.exit(130);
});

program.parseAsync(process.argv);
