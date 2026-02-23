# Backup

Backup, restore, and file migration utilities. Saves installation state before migration to enable safe uninstall, and provides the restore flow that reverses the shielding process.

## Public API

### Backup (`backup.ts`)

#### Functions

- **`saveBackup(params)`** -- Save installation backup before migration. Stores the backup as JSON at `~/.agenshield/backup.json` (root-owned, mode 600). Includes original installation info, sandbox user details, and migrated paths.
- **`loadBackup()`** -- Load the backup from disk. Returns `InstallationBackup | null`.
- **`deleteBackup()`** -- Remove the backup file.
- **`restoreOriginalConfig(backup)`** -- Restore the original application config from backup.

#### Types

- **`SaveBackupParams`** -- `{ originalInstallation, sandboxUser, migratedPaths }`

### Restore (`restore.ts`)

#### Functions

- **`fullRestore(backup, onProgress)`** -- Execute the full restore/uninstall flow. Steps: validate backup, stop daemon, stop broker, kill agent processes, restore config, restore package, delete user, remove guarded shell, cleanup router wrappers and registry, verify. Reports progress via callback.

#### Types

- **`RestoreStep`** -- Union of step identifiers: `'validate'`, `'stop-daemon'`, `'stop-broker'`, `'kill-processes'`, `'restore-config'`, `'restore-package'`, `'delete-user'`, `'remove-shell'`, `'cleanup'`, `'verify'`.
- **`RestoreProgress`** -- `{ step, success, message, error? }`
- **`RestoreResult`** -- `{ success, steps, error? }`

### Migration (`migration.ts`)

#### Functions

- **`migrateFiles(source, user, dirs)`** -- Copy target application files from the original user to the sandboxed user. Handles both npm and git install methods. Creates wrapper scripts for the sandbox entry point. Never modifies the original source directory.

#### Types

- **`MigrationSource`** -- `{ method, packagePath, binaryPath?, configPath?, gitRepoPath?, selection? }`
- **`MigrationResult`** -- `{ success, error?, newPaths? }`

## Internal Dependencies

- `exec/sudo.ts` -- `sudoExec` for privileged operations
- `legacy.ts` -- `deleteSandboxUser`, `GUARDED_SHELL_PATH`, `PATH_REGISTRY_PATH` for restore flow
- `wrappers/path-override.ts` -- `scanForRouterWrappers`, `ROUTER_MARKER`, `pathRegistryPath` for cleanup
- `@agenshield/ipc` -- `InstallationBackup`, `OriginalInstallation`, `SandboxUserInfo`, `MigratedPaths`, `BACKUP_CONFIG`, `backupConfigPath`, `MigrationSelection` types

## Restore Flow

The restore process executes these steps in order:

1. **validate** -- Load and verify backup exists
2. **stop-daemon** -- Unload LaunchDaemon via `launchctl`
3. **stop-broker** -- Kill broker processes by PID or port
4. **kill-processes** -- Terminate any remaining agent user processes
5. **restore-config** -- Copy config files back to original location
6. **restore-package** -- Restore package files (npm or git method)
7. **delete-user** -- Remove sandbox user and home directory
8. **remove-shell** -- Remove guarded shell from `/etc/shells` and delete binary
9. **cleanup** -- Remove router wrappers, path registry, legacy system directories, and backup file
10. **verify** -- Confirm sandbox user no longer exists

## Testing

Backup save/load can be tested with temp directories. Restore flow tests should mock system commands (`launchctl`, `dscl`, `kill`).

## Notes

- The backup file is root-owned with mode `600` to prevent tampering by non-root users.
- Migration copies files using `sudo cp -R` and never modifies the original source directory.
- The restore flow uses `lsof` as a fallback to find daemon PIDs when `launchctl` status is unavailable.
