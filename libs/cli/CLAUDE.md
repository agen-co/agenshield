# AgenShield CLI - Development Guide

This document provides guidance for Claude and other AI assistants working on the AgenShield CLI.

## Architecture Overview

The CLI uses [Clipanion v4](https://mael.dev/clipanion/) for class-based command routing and argument parsing. Each command is a class extending `BaseCommand`, which handles global options, output configuration, and error handling.

### Directory Structure

```
libs/cli/
├── src/
│   ├── cli.ts              # Main entry point - creates Cli instance and registers commands
│   ├── index.ts            # Library exports
│   ├── errors.ts           # Typed CLI error classes (CliError, UsageError, etc.)
│   ├── commands/           # Command definitions (one file per command)
│   │   ├── index.ts        # Exports all command classes
│   │   ├── base.ts         # Abstract BaseCommand with global options + error handling
│   │   ├── start.ts        # StartCommand
│   │   ├── stop.ts         # StopCommand
│   │   ├── upgrade.ts      # UpgradeCommand
│   │   ├── setup.ts        # SetupCommand
│   │   ├── status.ts       # StatusCommand
│   │   ├── doctor.ts       # DoctorCommand
│   │   ├── uninstall.ts    # UninstallCommand
│   │   ├── install.ts      # InstallCommand
│   │   ├── dev.ts          # DevCommand, DevCleanCommand, DevShellCommand
│   │   ├── logs.ts         # LogsCommand
│   │   ├── exec.ts         # ExecCommand
│   │   ├── auth-cmd.ts     # AuthHelpCommand, AuthTokenUiCommand, AuthTokenBrokerCommand
│   │   └── completion.ts   # CompletionCommand
│   ├── utils/              # Shared utilities
│   │   ├── output.ts       # Centralized output formatting (respects --json, --quiet, --no-color)
│   │   ├── globals.ts      # GlobalOptions interface and resolver
│   │   ├── spinner.ts      # Ora wrapper (respects json/quiet/no-tty)
│   │   ├── privileges.ts   # Privilege detection and sudo helpers
│   │   ├── daemon.ts       # Daemon management functions
│   │   ├── browser.ts      # Browser/URL helpers
│   │   ├── setup-guard.ts  # ensureSetupComplete() guard
│   │   ├── setup-state.ts  # Setup state persistence
│   │   ├── version.ts      # Version reader from package.json
│   │   └── home.ts         # ~/.agenshield/ directory helpers
│   ├── wizard/             # Interactive setup wizard (Ink/React)
│   ├── dev-tui/            # Dev mode TUI (Ink/React)
│   └── detect/             # OpenClaw detection utilities
├── package.json
├── tsconfig.json
├── CLAUDE.md               # This file
└── README.md
```

## Command Structure Pattern

Each command is a class extending `BaseCommand`:

```typescript
import { Option } from 'clipanion';
import { BaseCommand } from './base.js';

export class MyCommand extends BaseCommand {
  static override paths = [['my-command']];

  static override usage = BaseCommand.Usage({
    category: 'Category Name',
    description: 'What this command does',
    examples: [['Example description', '$0 my-command --flag']],
  });

  // Options as class properties
  flag = Option.Boolean('-f,--flag', false, { description: 'Option description' });
  name = Option.String('--name', { description: 'A string option' });
  target = Option.String({ required: true, name: 'target' }); // positional

  async run(): Promise<number | void> {
    // Command implementation
    // Access options via this.flag, this.name, this.target
    // Global options: this.json, this.quiet, this.noColor, this.debug
  }
}
```

### BaseCommand

All commands extend `BaseCommand` which provides:
- **Global options**: `--json`, `-q/--quiet`, `--no-color`, `--debug` as typed class properties
- **`execute()`**: Calls `configureGlobals()` → `run()` → `handleError(err)` on failure
- **`configureGlobals()`**: Wires up `output.ts` before the command runs
- **`handleError(err)`**: Formats errors per `--json` / `--debug`, exits with proper code

### Subcommands

For commands with subcommands, use separate classes with multi-segment paths:

```typescript
// `agenshield auth` — show help
export class AuthHelpCommand extends BaseCommand {
  static override paths = [['auth']];
  async run() { this.context.stdout.write(this.cli.usage(AuthHelpCommand, { detailed: true })); }
}

// `agenshield auth token ui`
export class AuthTokenUiCommand extends BaseCommand {
  static override paths = [['auth', 'token', 'ui']];
  async run() { /* ... */ }
}
```

### Categories

Commands are grouped by category in help output:
- **Setup & Maintenance**: install, setup, doctor, uninstall, completion
- **Daemon**: start, stop, upgrade, status
- **Development**: dev, dev clean, dev shell, exec, logs
- **Authentication**: auth, auth token ui, auth token broker

## Adding a New Command

1. Create a new file in `src/commands/<name>.ts`
2. Define a class extending `BaseCommand` with `static paths`, `static usage`, and `async run()`
3. Export the class from `src/commands/index.ts`
4. Register the class in `src/cli.ts`: `cli.register(MyCommand);`

## Spinners

Use `createSpinner()` from `utils/spinner.ts` for long-running operations:

```typescript
import { createSpinner } from '../utils/spinner.js';

const spinner = await createSpinner('Starting daemon...');
// ... do work ...
spinner.succeed('Daemon started');  // or spinner.fail('Failed')
spinner.update('New status text');  // update in-progress text
spinner.stop();                     // stop without message
```

The spinner automatically falls back to plain text in non-interactive mode (json, quiet, no-tty).

## Privilege Detection

Commands requiring root privileges should use `ensureSudoAccess()`:

```typescript
import { ensureSudoAccess } from '../utils/privileges.js';

async run() {
  ensureSudoAccess();
  // ... proceed with privileged operation
}
```

## Error Handling

All commands should throw typed errors from `errors.ts`:

```typescript
import { CliError, SetupRequiredError, DaemonNotRunningError } from '../errors.js';

throw new CliError('Something went wrong', 'ERROR_CODE');
throw new SetupRequiredError();
throw new DaemonNotRunningError();
```

`BaseCommand.handleError()` catches these and formats output per `--json`/`--debug`.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `AGENSHIELD_PREFIX` | Custom prefix for users/groups |
| `AGENSHIELD_BASE_UID` | Base UID for created users |
| `AGENSHIELD_DRY_RUN` | Enable dry-run mode |
| `AGENSHIELD_SKIP_CONFIRM` | Skip confirmation prompts |
| `AGENSHIELD_VERBOSE` | Enable verbose output |
| `AGENSHIELD_PORT` | Override daemon port |
| `AGENSHIELD_HOST` | Override daemon host |

## Dependencies

- `clipanion` - Class-based CLI framework (zero runtime deps)
- `ora` - Terminal spinners
- `ink`, `react` - Interactive CLI components (dev TUI, setup wizard)
- `@agenshield/sandbox` - Sandbox operations
- `@agenshield/ipc` - IPC types and schemas

## Related Documentation

- [Clipanion Documentation](https://mael.dev/clipanion/)
- [Ink Documentation](https://github.com/vadimdemedes/ink)
- [Project Architecture](/docs/architecture.md)
