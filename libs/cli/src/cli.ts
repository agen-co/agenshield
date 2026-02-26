#!/usr/bin/env node
/**
 * AgenShield CLI
 *
 * Security CLI for AI agents. Uses Clipanion v4 for class-based command routing.
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

import { Cli, Builtins } from 'clipanion';
import { getVersion } from './utils/version.js';

import { StartCommand } from './commands/start.js';
import { StopCommand } from './commands/stop.js';
import { UpgradeCommand } from './commands/upgrade.js';
import { SetupCommand } from './commands/setup.js';
import { StatusCommand } from './commands/status.js';
import { DoctorCommand } from './commands/doctor.js';
import { UninstallCommand } from './commands/uninstall.js';
import { DevCommand, DevCleanCommand, DevShellCommand } from './commands/dev.js';
import { InstallCommand } from './commands/install.js';
import { LogsCommand } from './commands/logs.js';
import { ExecCommand } from './commands/exec.js';
import { AuthHelpCommand, AuthTokenUiCommand, AuthTokenBrokerCommand } from './commands/auth-cmd.js';
import { CompletionCommand } from './commands/completion.js';

const VERSION = getVersion();

const cli = new Cli({
  binaryLabel: 'AgenShield',
  binaryName: 'agenshield',
  binaryVersion: VERSION,
  enableCapture: false,
});

// Builtins
cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);

// Daemon
cli.register(StartCommand);
cli.register(StopCommand);
cli.register(UpgradeCommand);
cli.register(StatusCommand);

// Setup & Maintenance
cli.register(SetupCommand);
cli.register(DoctorCommand);
cli.register(UninstallCommand);
cli.register(InstallCommand);
cli.register(CompletionCommand);

// Development
cli.register(DevCommand);
cli.register(DevCleanCommand);
cli.register(DevShellCommand);
cli.register(ExecCommand);
cli.register(LogsCommand);

// Authentication
cli.register(AuthHelpCommand);
cli.register(AuthTokenUiCommand);
cli.register(AuthTokenBrokerCommand);

// Handle SIGINT gracefully
process.on('SIGINT', () => {
  process.exit(130);
});

cli.runExit(process.argv.slice(2));
