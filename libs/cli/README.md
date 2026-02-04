# AgenShield CLI (agenshield)

AgenShield CLI is the operator-facing entry point for installing, diagnosing, and managing the AgenShield sandbox on a host machine. It wraps setup, status reporting, daemon lifecycle, and uninstall flows, and provides an interactive Ink-based wizard.

## Purpose
- Bootstrap a secure sandboxed environment for an agent runtime (presets like OpenClaw or custom targets).
- Report security posture and installation health.
- Start/stop the local AgenShield daemon service.
- Roll back an AgenShield installation using a recorded backup.

## Commands
- `setup` - Interactive setup wizard (Ink/React).
- `status` - Quick status summary (human or JSON).
- `doctor` - Diagnostics for prerequisites, installation, and security status.
- `daemon` - Start/stop/restart/status for the daemon service.
- `uninstall` - Roll back a prior installation (requires backup).

Run `agenshield --help` for the full help output and examples.

## Usage
```bash
# Show help
agenshield --help

# Status summary
agenshield status
agenshield status --json

# Diagnostics
agenshield doctor
agenshield doctor --json

# Setup (requires root unless --dry-run)
sudo agenshield setup

# Manage daemon
sudo agenshield daemon start
agenshield daemon status
sudo agenshield daemon stop

# Uninstall (requires backup created during setup)
sudo agenshield uninstall
```

## Configuration (Environment Variables)
The setup wizard consumes options through environment variables. The CLI sets these when you pass flags:

- `AGENSHIELD_TARGET` - preset name (e.g. `openclaw`, `custom`).
- `AGENSHIELD_ENTRY_POINT` - entry point for `custom` target.
- `AGENSHIELD_BASE_NAME` - base name for users/groups.
- `AGENSHIELD_PREFIX` - optional name prefix (useful for test installs).
- `AGENSHIELD_BASE_UID` - base UID for created users.
- `AGENSHIELD_DRY_RUN` - `true` to avoid making changes.
- `AGENSHIELD_SKIP_CONFIRM` - `true` to skip confirmations.
- `AGENSHIELD_VERBOSE` - `true` for verbose wizard output.

## Architecture
- `libs/cli/src/cli.ts` - Commander entry point and command registration.
- `libs/cli/src/commands/*` - Individual command implementations.
- `libs/cli/src/wizard/*` - Ink/React setup wizard UI and engine.
- `libs/cli/src/utils/privileges.ts` - Root checks and privilege helpers.
- `libs/cli/src/utils/daemon.ts` - Daemon lifecycle helpers.

The CLI relies on `@agenshield/sandbox` for detection, setup, uninstall, and security checks.

## Limitations and Caveats
- Many flows are macOS-specific because the underlying sandbox tooling is macOS-only (`dscl`, `sandbox-exec`, LaunchDaemons).
- `setup`, `daemon start/stop/restart`, and `uninstall` require root access.
- `doctor --fix` is accepted but currently does not perform any automatic fixes.
- `uninstall --prefix` is accepted but not yet wired into uninstall logic.
- The wizard reads configuration from environment variables only; it does not persist CLI flags on its own.

## Development
```bash
# Run in dev mode (no build)
npx nx run cli:dev

# Build
npx nx build cli
```

## Contribution Guide
- Keep CLI output deterministic; prefer JSON outputs for machine-readable modes.
- Reuse `ensureRoot()` for privileged operations for consistent messaging.
- Prefer adding new features as separate command files under `src/commands/`.

## Agent Notes
- Add a new command by creating `src/commands/<name>.ts`, exporting it in `src/commands/index.ts`, and registering it in `src/cli.ts`.
- The setup wizard is driven by `src/wizard/engine.ts`; it expects configuration via env vars listed above.
- `@agenshield/sandbox` is the authoritative source for user/group creation, directory layout, and security checks.
- The CLI itself does not talk to the broker directly; it primarily orchestrates system setup and daemon management.
