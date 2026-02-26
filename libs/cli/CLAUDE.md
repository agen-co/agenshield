# AgenShield CLI - Development Guide

This document provides guidance for Claude and other AI assistants working on the AgenShield CLI.

## Architecture Overview

The CLI uses [Commander.js](https://github.com/tj/commander.js/) for command routing and argument parsing. Each command file exports a `register*Command(program)` function that registers the command on the root Commander program. Global options and error handling are provided by `withGlobals()` and `handleError()` from `base.ts`.

### Directory Structure

```
libs/cli/
├── src/
│   ├── cli.ts              # Main entry point - creates Commander program and registers commands
│   ├── index.ts            # Library exports
│   ├── errors.ts           # Typed CLI error classes (CliError, UsageError, etc.)
│   ├── commands/           # Command definitions (one file per command)
│   │   ├── index.ts        # Exports all register functions + withGlobals/handleError
│   │   ├── base.ts         # withGlobals() HOF + handleError() utility
│   │   ├── start.ts        # registerStartCommand
│   │   ├── stop.ts         # registerStopCommand
│   │   ├── upgrade.ts      # registerUpgradeCommand
│   │   ├── setup.ts        # registerSetupCommand
│   │   ├── status.ts       # registerStatusCommand
│   │   ├── doctor.ts       # registerDoctorCommand
│   │   ├── uninstall.ts    # registerUninstallCommand
│   │   ├── install.ts      # registerInstallCommand
│   │   ├── dev.ts          # registerDevCommands (dev, dev clean, dev shell)
│   │   ├── logs.ts         # registerLogsCommand
│   │   ├── exec.ts         # registerExecCommand
│   │   ├── auth-cmd.ts     # registerAuthCommands (auth, auth token ui, auth token broker)
│   │   └── completion.ts   # registerCompletionCommand
│   ├── prompts/            # Interactive prompt helpers
│   │   ├── index.ts        # Barrel exports
│   │   ├── ink-select.tsx   # Single-select (arrow keys)
│   │   ├── ink-multiselect.tsx # Multi-select (checkboxes)
│   │   ├── ink-input.tsx    # Text input
│   │   ├── ink-browser-link.tsx # Browser link with auto-open
│   │   └── readline-fallback.ts # Non-TTY fallbacks
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

Each command file exports a `register*Command(program)` function:

```typescript
import type { Command } from 'commander';
import { withGlobals } from './base.js';

export function registerMyCommand(program: Command): void {
  program
    .command('my-command')
    .description('What this command does')
    .option('-f, --flag', 'Option description', false)
    .option('--name <name>', 'A string option')
    .action(withGlobals(async (opts) => {
      // Command implementation
      // Access options via opts['flag'], opts['name']
      // Global options available via opts (merged with .optsWithGlobals())
    }));
}
```

For commands with positional arguments, use `withGlobalsPositional`:

```typescript
import { withGlobalsPositional } from './base.js';

export function registerExecCommand(program: Command): void {
  program
    .command('exec')
    .argument('<target>', 'Target name')
    .action(withGlobalsPositional(async (target, opts) => {
      // target is the positional arg string
    }));
}
```

### withGlobals() and handleError()

`withGlobals(handler)` wraps Commander action handlers to:
- Resolve global options (`--json`, `--quiet`, `--no-color`, `--debug`) via `.optsWithGlobals()`
- Configure the output module before the handler runs
- Catch errors and route them through `handleError()`

`handleError(err, globals)` formats errors per `--json` / `--debug` and exits with the proper code.

### Subcommands

Commander handles subcommands via nesting:

```typescript
export function registerDevCommands(program: Command): void {
  const dev = program
    .command('dev')
    .description('Dev mode')
    .action(withGlobals(async (opts) => { /* main dev command */ }));

  dev.command('clean')
    .description('Clean dev environment')
    .action(withGlobals(async () => { /* clean subcommand */ }));

  dev.command('shell')
    .description('Open agent shell')
    .option('--no-daemon', 'Skip daemon')
    .action(withGlobals(async (opts) => { /* shell subcommand */ }));
}
```

## Adding a New Command

1. Create a new file in `src/commands/<name>.ts`
2. Export a `register<Name>Command(program: Command)` function
3. Use `withGlobals()` or `withGlobalsPositional()` to wrap the action handler
4. Export from `src/commands/index.ts`
5. Import and call in `src/cli.ts`: `registerMyCommand(program);`

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

ensureSudoAccess();
// ... proceed with privileged operation
```

## Error Handling

All commands should throw typed errors from `errors.ts`:

```typescript
import { CliError, SetupRequiredError, DaemonNotRunningError } from '../errors.js';

throw new CliError('Something went wrong', 'ERROR_CODE');
throw new SetupRequiredError();
throw new DaemonNotRunningError();
```

`handleError()` catches these and formats output per `--json`/`--debug`.

## Interactive Prompts

The `prompts/` directory provides Ink-based interactive components with readline fallbacks:

- `inkSelect(options, config?)` — Single-select with arrow keys
- `inkMultiSelect(options, config?)` — Multi-select with checkboxes (Space to toggle, 'a' for all)
- `inkInput(config)` — Text input
- `inkBrowserLink(config)` — Browser link with auto-open offer

All fall back to readline when not in an interactive TTY.

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

- `commander` - Command routing and argument parsing
- `ora` - Terminal spinners
- `ink`, `react` - Interactive CLI components (dev TUI, setup wizard, prompts)
- `@agenshield/sandbox` - Sandbox operations
- `@agenshield/ipc` - IPC types and schemas

## Related Documentation

- [Commander.js Documentation](https://github.com/tj/commander.js/)
- [Ink Documentation](https://github.com/vadimdemedes/ink)
- [Project Architecture](/docs/architecture.md)
