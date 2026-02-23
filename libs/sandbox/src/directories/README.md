# Directories

Directory structure and permissions management for AgenShield sandboxes. Creates the complete directory tree under the agent user's home with correct ownership, mode bits, setgid flags, and macOS ACLs.

## Public API

### Functions

#### Structure Definition

- **`createDirectoryStructure(config?)`** -- Returns a `DirectoryStructure` with `system` and `agent` directory maps. Each entry specifies `mode`, `owner`, `group`, and optional `acl` entries.
- **`createPathsConfig(config?)`** -- Returns a `PathsConfig` with resolved paths for socket, config, policies, seatbelt, log, and home directories.

#### Creation

- **`createDirectory(dirPath, options, verboseOptions?)`** -- Create a single directory with `sudo mkdir -p`, then apply ownership, mode, and optional macOS ACL entries.
- **`createSystemDirectories(config?, options?)`** -- Create all system-level directories.
- **`createAgentDirectories(config?, options?)`** -- Create all agent-level directories, including seeding config files.
- **`createAllDirectories(config?, options?)`** -- Create system directories followed by agent directories.
- **`seedConfigFiles(config?, options?)`** -- Create empty config files (e.g., `openclaw.json`) with broker ownership so the broker can read/write at runtime without needing root.
- **`setupSocketDirectory(config?)`** -- Configure the socket directory with setgid + group-writable permissions (`2770`).

#### Verification

- **`verifyDirectories(config?)`** -- Verify all directories exist with correct modes. Falls back to `sudo stat` when running as non-root. Returns `{ valid, missing, incorrect }`.

#### Inspection

- **`getDirectoryInfo(dirPath)`** -- Returns `{ exists, mode?, owner?, group? }` for a directory.

#### Cleanup

- **`removeAllDirectories(config?)`** -- Remove the agent home and legacy system directories. WARNING: destructive.

### Types

- **`DirectoryDefinition`** -- `{ mode, owner, group, acl? }`
- **`DirectoryStructure`** -- `{ system: Record<string, DirectoryDefinition>, agent: Record<string, DirectoryDefinition> }`
- **`DirectoryResult`** -- `{ success, path, message, error? }`

## Internal Dependencies

- `users/users.ts` -- `createUserConfig` (for default config fallback)
- `@agenshield/ipc` -- `UserConfig`, `PathsConfig` types

## Directory Layout

The agent home (`/Users/ash_{baseName}_agent`) contains:

```
~agent/
  bin/                     # Command wrappers (setgid, broker-owned)
  workspace/               # Agent working directory
  .openclaw/               # Target app config (broker-writable via ACL)
    workspace/skills/      # Skill directories
    openclaw.json          # Seeded config file
  .nvm/                    # NVM + Node.js versions
  .zdot/                   # Per-target ZDOTDIR (root-owned)
  .agenshield/
    bin/                   # Guarded shell, shield-exec
    seatbelt/              # Seatbelt profiles
      ops/                 # Per-operation profiles
    logs/                  # Broker and audit logs
    run/                   # Unix socket (setgid 2770)
    config/                # Shield config
    policies/              # Policy files
      custom/              # Custom policies
    ops/                   # Operation logs
    quarantine/            # Quarantined items (root-only)
      skills/              # Quarantined skills
```

## Testing

Tests should verify directory structure definitions and mode calculations. Actual creation tests require sudo access.

## Notes

- System directories under `/opt/agenshield` and `/etc/agenshield` have been removed from the structure. Shared binaries now live under `{hostHome}/.agenshield/bin/` and per-target files under `{agentHome}/.agenshield/`.
- The `.openclaw` directory uses macOS ACLs with `file_inherit,directory_inherit` to ensure the broker retains write access even if the target application resets ownership.
