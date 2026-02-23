# @agenshield/sandbox

User isolation and sandboxing library for AgenShield. Creates restricted macOS users, guarded shells, directory structures, kernel-level enforcement profiles, and command wrappers for sandboxed agent execution.

## Architecture

```
libs/sandbox/src/
  index.ts              # Root barrel (re-exports from all domains)
  legacy.ts             # Legacy constants & functions (single-file removal target)
  errors.ts             # 8 typed error classes
  types.ts              # SandboxUser, SandboxConfig, CreateUserResult, DirectoryStructure

  exec/                 # Sudo execution helper
  users/                # macOS user & group lifecycle
  directories/          # Directory structure & permissions
  shell/                # Guarded shell & command proxy
  enforcement/          # Kernel-level sandboxing (seatbelt + launchdaemon)
  wrappers/             # Command wrappers & PATH management
  detection/            # Host inspection (read-only)
    discovery/          # Binary & skill scanning
  backup/               # Backup, restore & migration
  inject/               # Skill injection & ES extension resolver
  presets/              # Preset system (target app definitions)
    actions/            # Step-based install pipeline
      shared/           # Reusable pipeline steps
      openclaw/         # OpenClaw-specific pipeline steps
      claude-code/      # Claude Code-specific pipeline steps
      rollbacks/        # Manifest-driven rollback handlers
```

## Domain Summary

| Folder | Purpose | Key Exports |
|--------|---------|-------------|
| `exec/` | Canonical sudo helper | `sudoExec`, `SudoResult` |
| `users/` | macOS user & group CRUD | `createUserConfig`, `createAllUsersAndGroups`, `deleteAllUsersAndGroups`, `verifyUsersAndGroups` |
| `directories/` | Directory tree with ownership/ACLs | `createDirectoryStructure`, `createAllDirectories`, `verifyDirectories`, `createPathsConfig` |
| `shell/` | Restricted zsh shell + command proxy | `GUARDED_SHELL_CONTENT`, `guardedShellPath`, `SHIELD_EXEC_CONTENT`, `shieldExecPath`, `PROXIED_COMMANDS` |
| `enforcement/` | Seatbelt profiles + LaunchDaemon | `generateAgentProfile`, `installSeatbeltProfiles`, `generateBrokerPlist`, `installLaunchDaemon` |
| `wrappers/` | Wrapper scripts + PATH router | `WRAPPER_DEFINITIONS`, `installWrappers`, `installPresetBinaries`, `generateRouterWrapper`, `readPathRegistry` |
| `detection/` | Read-only host inspection | `detectOpenClaw`, `checkSecurityStatus`, `scanHost`, `scanDiscovery` |
| `backup/` | Backup, restore & file migration | `saveBackup`, `loadBackup`, `fullRestore`, `migrateFiles` |
| `inject/` | Skill injection into sandbox | `injectAgenCoSkill`, `getESExtensionAppPath`, `updateOpenClawMcpConfig` |
| `presets/` | Target app preset system | `PRESETS`, `getPreset`, `autoDetectPreset`, `TargetPreset`, `runPipeline` |

## Error Hierarchy

All errors extend `SandboxError` (base class with `.code` property):

```
SandboxError
  InstallError              (.step, .targetId)
    HomebrewInstallError
    NvmInstallError
    TargetAppInstallError   (.appName)
    GuardedShellInstallError
    StepExecutionError      (.stepName)
  GatewayPreflightError     (.failures)
```

## Usage Examples

### Create sandbox users and directories

```ts
import {
  createUserConfig,
  createAllUsersAndGroups,
  createAllDirectories,
  createPathsConfig,
} from '@agenshield/sandbox';

const config = createUserConfig({ baseName: 'myapp' });
await createAllUsersAndGroups(config);
await createAllDirectories(config);
const paths = createPathsConfig(config);
```

### Install wrappers and enforcement profiles

```ts
import {
  installPresetBinaries,
  installSeatbeltProfiles,
  generateAgentProfile,
} from '@agenshield/sandbox';

await installPresetBinaries({
  requiredBins: ['node', 'npm', 'git', 'curl'],
  userConfig: config,
  binDir: `${config.agentUser.home}/bin`,
  socketGroupName: config.groups.socket.name,
});
```

### Detect existing installations

```ts
import { detectOpenClaw, checkSecurityStatus, checkPrerequisites } from '@agenshield/sandbox';

const prereqs = checkPrerequisites();
const result = detectOpenClaw();
if (result.installation.found) {
  console.log(`Found ${result.installation.method} install at ${result.installation.packagePath}`);
}

const security = checkSecurityStatus();
console.log(`Security level: ${security.level}`);
```

### Use the preset system

```ts
import { autoDetectPreset, getPreset, runPipeline, getOpenclawPipeline } from '@agenshield/sandbox';

// Auto-detect which preset matches the host
const match = await autoDetectPreset();

// Or get by ID
const preset = getPreset('openclaw');

// Run step-based install pipeline
const pipeline = getOpenclawPipeline();
const result = await runPipeline(pipeline, installContext);
```

### PATH router override

```ts
import {
  generateRouterWrapper,
  buildInstallRouterCommands,
  addRegistryInstance,
  writePathRegistry,
} from '@agenshield/sandbox';

const wrapper = generateRouterWrapper('openclaw');
const cmds = buildInstallRouterCommands('openclaw', wrapper);
// Execute cmds as root

const registry = addRegistryInstance('openclaw', {
  targetId: 'oc-1',
  profileId: 'prof-1',
  name: 'My OpenClaw',
  agentBinPath: '/Users/ash_default_agent/bin/openclaw',
  baseName: 'default',
  agentUsername: 'ash_default_agent',
}, '/usr/local/bin/openclaw');
writePathRegistry(registry);
```

### Backup and restore

```ts
import { saveBackup, loadBackup, fullRestore } from '@agenshield/sandbox';

const backup = loadBackup();
if (backup) {
  fullRestore(backup, (progress) => console.log(progress));
}
```

## Build & Test

```bash
npx nx build sandbox
npx nx test sandbox
```

## Platform

macOS only. Uses `dscl` for user management, `sandbox-exec` for seatbelt profiles, and `launchctl` for daemon lifecycle. Requires root for most operations.

## Limitations

- macOS-only: relies on `dscl`, `launchctl`, and `sandbox-exec`.
- Requires root for user/group creation, system directories, and LaunchDaemon management.
- Per-target paths are under `$agentHome/.agenshield/` (legacy `/opt/agenshield` and `/etc/agenshield` paths are deprecated).
- Seatbelt profiles are static; updates require regeneration and reinstallation.
- Security checks focus on known patterns (OpenClaw naming, common secret env vars).

## Agent Notes

- `checkPrerequisites()` enforces macOS and Node 22+.
- User/group naming is derived from `createUserConfig()`; the `ASH_PREFIX` (`ash_`) is mandatory.
- Wrapper install/update flows are used by the daemon API; keep them idempotent.
- Backup/restore is the uninstall source of truth; keep schema in sync with `@agenshield/ipc`.
- Changes that affect system paths should update `@agenshield/ipc` config types.
