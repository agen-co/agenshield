# Enforcement

Kernel-level sandboxing via macOS seatbelt profiles and LaunchDaemon lifecycle management. Seatbelt profiles enforce static deny rules at the kernel level, while LaunchDaemon manages the broker process.

## Public API

### Seatbelt Profiles (`seatbelt.ts`)

#### Functions

- **`generateAgentProfile(options)`** -- Generate the main agent seatbelt profile. Accepts `workspacePath`, `socketPath`, `agentHome?`, and `additionalReadPaths?`. Returns a SBPL string with deny-default rules, workspace read/write, socket access, and network denial.
- **`generateOperationProfile(operation, target?)`** -- Generate a per-operation profile. Supported operations: `file_read`, `file_write`, `http_request`, `exec`. Falls back to a minimal profile for unknown operations.
- **`installProfiles(options)`** -- Install the agent profile and all per-operation profiles to the seatbelt directory. Returns `ProfileResult[]`.
- **`installSeatbeltProfiles(config, profiles)`** -- Install profiles using `UserConfig` with sudo. Writes to `{agentHome}/.agenshield/seatbelt/`.
- **`verifyProfile(profilePath)`** -- Basic syntax verification (version 1 check, balanced parentheses).
- **`getInstalledProfiles()`** -- List all installed `.sb` profile paths.

#### Types

- **`ProfileResult`** -- `{ success, path, message, error? }`

### LaunchDaemon (`launchdaemon.ts`)

#### Functions

- **`generateBrokerPlist(config, options?)`** -- Generate the broker LaunchDaemon plist XML from `UserConfig`. Configurable broker path, config path, socket path, node binary, log directory, and host home.
- **`installLaunchDaemon(plistContent)`** -- Write plist to `/Library/LaunchDaemons/`, set root ownership, and bootstrap via `launchctl`.
- **`loadLaunchDaemon()`** -- Bootstrap the LaunchDaemon.
- **`unloadLaunchDaemon()`** -- Unload the LaunchDaemon.
- **`uninstallLaunchDaemon()`** -- Unload and remove the plist file.
- **`isDaemonRunning()`** -- Check if the LaunchDaemon is running via `launchctl list`.
- **`getDaemonStatus()`** -- Returns `{ installed, running, pid?, lastExitStatus? }`.
- **`restartDaemon()`** -- Unload then reload.
- **`fixSocketPermissions(config?, overrides?)`** -- Wait for the broker socket to appear (up to 10s), then set permissions to `666` and correct ownership. Required after broker starts because the socket is created by the broker process.

#### Types

- **`DaemonResult`** -- `{ success, message, plistPath?, loaded?, error? }`

## Internal Dependencies

- `@agenshield/ipc` -- `UserConfig` type
- `node:child_process` -- `exec` for `launchctl` and `dscl` commands

## Security Model

The seatbelt profile uses a hybrid approach:
- **Seatbelt (kernel)**: Static deny rules for dangerous system paths (`/usr/bin`, `/sbin`, `/etc`, etc.), network denial, and write protection for agent bin/config directories.
- **ACLs (runtime)**: Dynamic allow rules for fine-grained access control.

Critical denials are kernel-enforced and cannot be bypassed at runtime:
- System binaries (`/usr/bin`, `/sbin`, `/bin`) are read-denied (with specific exceptions for `/bin/sh`, `/bin/bash`, `/usr/bin/env`).
- The agent cannot write to its own `bin/`, `.openclaw/`, `.zdot/`, or `.agenshield/` directories.
- All network access is denied (communication goes through the Unix socket only).

## Testing

Profile generation functions are pure and can be unit tested by verifying the output SBPL string. LaunchDaemon tests require macOS with `launchctl` access.

## Notes

- The plist label is `com.agenshield.broker` (with optional `.{baseName}` suffix).
- The plist includes `AssociatedBundleIdentifiers` linking to `com.frontegg.AgenShieldES` for the host app.
- The broker intentionally runs without `NODE_OPTIONS`/interceptor since it IS the enforcement point.
