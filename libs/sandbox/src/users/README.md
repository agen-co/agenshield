# Users

macOS user and group lifecycle management. Creates, verifies, and deletes AgenShield sandbox users and groups using `dscl` (Directory Service command line). Supports dynamic configuration with custom prefixes, base names, and UID/GID ranges.

## Public API

### Functions

#### Configuration

- **`createUserConfig(options?)`** -- Build a `UserConfig` object with agent user, broker user, and socket group definitions. Options: `prefix`, `baseUid`, `baseGid`, `baseName`.

#### Group Management

- **`createGroup(name, gid, description?, options?)`** -- Create a single macOS group via `dscl`.
- **`createGroups(config?, options?)`** -- Create all required groups from a `UserConfig`.
- **`deleteGroup(name)`** -- Delete a macOS group.
- **`deleteGroups(config?)`** -- Delete all groups from a `UserConfig`.
- **`groupExists(name)`** -- Check if a group exists (async).

#### User Management

- **`createUser(userDef, options?)`** -- Create a macOS user from a `UserDefinition`. Creates home directory and `.agenshield/meta.json` marker.
- **`createAgentUser(config?, options?)`** -- Create the agent user.
- **`createBrokerUser(config?, options?)`** -- Create the broker user.
- **`createUsers(config?)`** -- Create both agent and broker users.
- **`deleteUser(username)`** -- Delete a macOS user and clean up the `.agenshield` marker.
- **`deleteUsers(config?)`** -- Delete both agent and broker users.
- **`userExists(username)`** -- Check if a user exists (async).

#### Composite Operations

- **`createAllUsersAndGroups(config?)`** -- Create all groups then all users.
- **`deleteAllUsersAndGroups(config?)`** -- Delete all users then all groups.

#### Inspection

- **`getUserInfo(username)`** -- Read user attributes from `dscl` as a key-value record.
- **`getGroupInfo(name)`** -- Read group attributes from `dscl`.
- **`verifyUsersAndGroups(config?)`** -- Verify all expected users and groups exist. Returns `{ valid, missingGroups, missingUsers }`.
- **`isAgenshieldUser(username)`** -- Check for the `.agenshield/meta.json` marker directory.
- **`listAgenshieldUsers()`** -- Scan `/Users/ash_*` directories and return usernames with parsed metadata.

### Types

- **`CreateResult`** -- `{ success, message, error? }`
- **`AgenshieldUserMeta`** -- `{ createdAt, version, username, uid }`

### Constants

- **`DEFAULT_BASE_UID`** -- `5200`
- **`DEFAULT_BASE_GID`** -- `5100`
- **`DEFAULT_BASE_NAME`** -- `'default'`
- **`ASH_PREFIX`** -- `'ash_'` (required prefix for all AgenShield users/groups)

## Internal Dependencies

- `shell/guarded-shell.ts` -- `guardedShellPath` (to set agent user's shell)
- `@agenshield/ipc` -- `UserConfig`, `UserDefinition`, `GroupDefinition` types

## Naming Convention

All users and groups follow the pattern: `{prefix?_}ash_{baseName}_{role}`

```
ash_default_agent       # Default agent user
ash_default_broker      # Default broker user
ash_default             # Default socket group
test1_ash_myapp_agent   # Prefixed agent user (for testing)
```

## Testing

Tests should mock `dscl` and `dseditgroup` calls. The async API is preferred for new test suites.

## Notes

- Legacy sync helpers (`createSandboxUser`, `deleteSandboxUser`, `userExistsSync`) live in `legacy.ts`.
- Each created user gets a root-owned `.agenshield/meta.json` marker in their home directory for identification.
