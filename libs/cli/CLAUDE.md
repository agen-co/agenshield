# AgenShield CLI - Development Guide

This document provides guidance for Claude and other AI assistants working on the AgenShield CLI.

## Architecture Overview

The CLI uses [Commander.js](https://www.npmjs.com/package/commander) for command-line argument parsing and command organization. The architecture follows a modular pattern where each command is defined in its own file.

### Directory Structure

```
libs/cli/
├── src/
│   ├── cli.ts              # Main entry point - creates program and registers commands
│   ├── index.ts            # Library exports
│   ├── commands/           # Command definitions (one file per command)
│   │   ├── index.ts        # Exports all command creators
│   │   ├── setup.ts        # Setup wizard command
│   │   ├── status.ts       # Status display command
│   │   ├── doctor.ts       # Diagnostic command
│   │   ├── daemon.ts       # Daemon management (with subcommands)
│   │   └── uninstall.ts    # Uninstall command
│   ├── utils/              # Shared utilities
│   │   ├── index.ts        # Exports all utilities
│   │   ├── privileges.ts   # Privilege detection
│   │   └── daemon.ts       # Daemon management functions
│   ├── wizard/             # Interactive setup wizard (Ink/React)
│   │   ├── index.tsx       # Wizard React component
│   │   ├── engine.ts       # Wizard step execution engine
│   │   └── types.ts        # TypeScript types for wizard
│   └── detect/             # OpenClaw detection utilities
│       └── index.ts
├── package.json
├── tsconfig.json
├── CLAUDE.md               # This file
└── README.md
```

## Command Structure Pattern

Each command file follows this pattern:

```typescript
import { Command } from 'commander';

/**
 * Create the <name> command
 */
export function create<Name>Command(): Command {
  const cmd = new Command('<name>')
    .description('Description of what the command does')
    .option('-f, --flag', 'Option description')
    .action(async (options) => {
      // Command implementation
    });

  return cmd;
}
```

### Subcommands

For commands with subcommands (like `daemon`), use Commander's `.command()` method:

```typescript
export function createDaemonCommand(): Command {
  const cmd = new Command('daemon')
    .description('Parent command description');

  cmd.command('start')
    .description('Subcommand description')
    .action(async () => { /* ... */ });

  cmd.command('stop')
    .description('Stop the daemon')
    .action(async () => { /* ... */ });

  // Default action when no subcommand provided
  cmd.action(async () => {
    // Show status or help
  });

  return cmd;
}
```

## Adding a New Command

1. Create a new file in `src/commands/<name>.ts`
2. Implement the command following the pattern above
3. Export the creator function from `src/commands/index.ts`
4. Register the command in `src/cli.ts`:

```typescript
import { createNewCommand } from './commands';
// ...
program.addCommand(createNewCommand());
```

## Privilege Detection

Commands requiring root privileges should use the `ensureRoot()` utility:

```typescript
import { ensureRoot } from '../utils/privileges';

cmd.action(async () => {
  ensureRoot('command-name');  // Exits if not root
  // ... proceed with privileged operation
});
```

This provides consistent error messages and guidance to users.

## Interactive Components

The CLI uses [Ink](https://github.com/vadimdemedes/ink) for interactive components like the setup wizard. Ink allows building CLI UIs with React components.

Key components:
- `WizardApp` - Main wizard component with step navigation
- `ink-spinner` - Loading spinners
- `ink-select-input` - Selection menus
- `ink-text-input` - Text input fields

## Environment Variables

The CLI respects these environment variables:

| Variable | Purpose |
|----------|---------|
| `AGENSHIELD_PREFIX` | Custom prefix for users/groups |
| `AGENSHIELD_BASE_UID` | Base UID for created users |
| `AGENSHIELD_DRY_RUN` | Enable dry-run mode |
| `AGENSHIELD_SKIP_CONFIRM` | Skip confirmation prompts |
| `AGENSHIELD_VERBOSE` | Enable verbose output |

## Testing

### Manual Testing

```bash
# From project root, run development version
npm run cli:dev -- status
npm run cli:dev -- doctor
npm run cli:dev -- --help

# Run built version
npm run cli -- status
```

### Testing Commands Requiring Root

```bash
# Use dry-run mode when available
npm run cli:dev -- setup --dry-run

# Or use sudo
sudo npm run cli -- setup
```

## Best Practices

1. **Command Naming**: Use verb-noun pattern (e.g., `create-user`, `check-status`)
2. **Options**: Use short flags for common options (`-v` for verbose, `-f` for force)
3. **Output**: Use colored output sparingly, support `--json` for machine-readable output
4. **Errors**: Exit with non-zero code on failure, print helpful error messages
5. **Help**: Include examples in command descriptions
6. **Async**: All command actions should be async for consistency

## Dependencies

- `commander` - Command-line parsing
- `ink`, `react` - Interactive CLI components
- `@agenshield/sandbox` - Sandbox operations
- `@agenshield/ipc` - IPC types and schemas

## Related Documentation

- [Commander.js Guide](https://betterstack.com/community/guides/scaling-nodejs/commander-explained/)
- [Ink Documentation](https://github.com/vadimdemedes/ink)
- [Project Architecture](/docs/architecture.md)
