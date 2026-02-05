# @agenshield/sandbox

OS-level sandboxing utilities for AgenShield. This package orchestrates user/group creation, directory layout, wrapper scripts, seatbelt profiles, LaunchDaemon setup, and security checks. It is macOS-focused.

## Purpose
- Create and manage isolated users/groups for agent workloads.
- Generate a guarded shell and wrapper scripts that route through the broker.
- Install macOS seatbelt profiles and LaunchDaemons.
- Detect and migrate existing OpenClaw installs.
- Provide security status checks and backup/restore support.

## Key Modules
- `src/users.ts` - User/group definitions and creation helpers.
- `src/directories.ts` - Directory structure and permissions.
- `src/guarded-shell.ts` / `src/macos.ts` - Guarded shell and macOS user creation.
- `src/wrappers.ts` - Wrapper script generation/installation.
- `src/seatbelt.ts` - Seatbelt profile generation/installation.
- `src/launchdaemon.ts` - LaunchDaemon plist and lifecycle helpers.
- `src/security.ts` - Security status checks.
- `src/detect.ts` - OpenClaw installation detection + prerequisites.
- `src/backup.ts` / `src/restore.ts` - Backup and uninstall support.
- `src/presets/*` - Preset configuration (openclaw/custom).
- `src/skill-injector.ts` - AgentLink skill injection utilities.

## Usage Examples
### Create users and directories
```ts
import { createUserConfig, createAllUsersAndGroups, createAllDirectories } from '@agenshield/sandbox';

const config = createUserConfig({ baseName: 'agenshield' });
await createAllUsersAndGroups(config);
await createAllDirectories(config);
```

### Install wrappers and seatbelt profiles
```ts
import { installAllWrappers, installSeatbeltProfiles } from '@agenshield/sandbox';

await installAllWrappers();
await installSeatbeltProfiles();
```

### Detect OpenClaw and check security
```ts
import { detectOpenClaw, checkSecurityStatus, checkPrerequisites } from '@agenshield/sandbox';

const prereqs = checkPrerequisites();
const detection = detectOpenClaw();
const status = checkSecurityStatus();
```

### Backup and restore (used by CLI uninstall)
```ts
import { saveBackup, loadBackup, restoreInstallation } from '@agenshield/sandbox';

const backup = loadBackup();
if (backup) {
  restoreInstallation(backup, (progress) => console.log(progress));
}
```

## Wrapper Definitions
Wrappers are generated from `WRAPPER_DEFINITIONS` in `src/wrappers.ts`. Notable wrappers include:
- `shieldctl` (broker CLI)
- `curl`, `wget`, `git`
- `npm`, `python`, `pip` (with interceptor/seatbelt integration)

## Limitations and Caveats
- macOS-only: relies on `dscl`, `launchctl`, and `sandbox-exec`.
- Requires root for most operations (users, groups, system directories, LaunchDaemon).
- Hardcoded paths for system directories (`/opt/agenshield`, `/etc/agenshield`, `/var/run/agenshield`).
- Seatbelt profiles are restrictive and static; updates require regeneration.
- Security checks focus on OpenClaw naming (`openclaw`) and known patterns.
- Wrapper target paths and defaults are opinionated and may need customization for other environments.

## Roadmap (Ideas)
- Linux support (user/group tooling + seccomp/apparmor).
- Fully configurable paths via `@agenshield/ipc` config.
- Improved idempotence and rollback for partial installs.
- Expanded tests around system mutations.

## Development
```bash
# Build
npx nx build shield-sandbox
```

## Contribution Guide
- Changes that affect system paths should update `@agenshield/ipc` config types.
- Keep wrappers deterministic and avoid shell injection risks.
- Ensure any `sudo` command failures are surfaced clearly to callers.

## Agent Notes
- `checkPrerequisites()` enforces macOS and Node 22+.
- User/group naming is derived from `createUserConfig()`; changing it affects many paths.
- Wrapper install/update flows are used by the daemon API; keep them idempotent.
- Backup/restore is the uninstall source of truth; keep schema changes in sync with `@agenshield/ipc`.
