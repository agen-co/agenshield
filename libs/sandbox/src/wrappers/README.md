# Wrappers

Command wrapper scripts and PATH management. Generates, installs, and manages bash wrapper scripts that route operations through the broker, plus the PATH router override system for multi-instance support.

## Public API

### Wrapper Scripts (`wrappers.ts`)

#### Core Types

- **`WrapperDefinition`** -- `{ description, usesSeatbelt?, usesInterceptor?, generate(config) }`. Defines a wrapper with a content generator function.
- **`WrapperConfig`** -- Configuration for wrapper generation: agent home, username, socket path, HTTP port, interceptor path, seatbelt dir, binary paths (python, node, npm, brew, nvm node dir, shield-client, node-bin).
- **`WrapperResult`** -- `{ success, name, path, message, error? }`

#### Constants

- **`WRAPPER_DEFINITIONS`** -- Record of all wrapper definitions. Keys: `shieldctl`, `curl`, `wget`, `git`, `npm`, `pip`, `python`, `python3`, `node`, `npx`, `brew`, `open-url`, `ssh`, `scp`.
- **`WRAPPERS`** -- Legacy static export with pre-rendered content (for backward compatibility).
- **`BASIC_SYSTEM_COMMANDS`** -- Array of basic commands (`ls`, `cat`, `grep`, etc.) installed as direct symlinks.

#### Functions -- Installation

- **`installWrapper(name, content, targetDir)`** -- Write a single wrapper script.
- **`installWrapperWithSudo(name, content, targetDir, owner?, group?)`** -- Write a wrapper with sudo (for root-owned directories).
- **`installWrappers(targetDir?, config?)`** -- Install all wrappers. Falls back to sudo on EACCES.
- **`installSpecificWrappers(names, targetDir, config?)`** -- Install named wrappers only.
- **`installAllWrappers(userConfig, directories)`** -- Install all wrappers using UserConfig.
- **`installGuardedShell(userConfig?, options?)`** -- Install the guarded shell launcher plus ZDOTDIR files.
- **`installShieldExec(userConfig, binDir)`** -- Install shield-exec and create symlinks for PROXIED_COMMANDS, plus node/python/python3 as separate bash wrappers.
- **`installBasicCommands(binDir, options?)`** -- Create symlinks for basic system commands.
- **`installPresetBinaries(options)`** -- Full pipeline: install NVM + node, deploy interceptor, install wrappers, install seatbelt profiles, install basic commands, lock down ownership.

#### Functions -- Uninstallation

- **`uninstallWrapper(name, targetDir)`** -- Remove a single wrapper.
- **`uninstallWrappers(targetDir?)`** -- Remove all wrappers.

#### Functions -- Verification

- **`verifyWrappers(targetDir?)`** -- Check which wrappers are installed. Returns `{ valid, installed, missing }`.

#### Functions -- Dynamic Management

- **`getAvailableWrappers()`** -- List all wrapper names.
- **`getWrapperDefinition(name)`** -- Get a wrapper definition by name.
- **`generateWrapperContent(name, config?)`** -- Generate wrapper content from a definition.
- **`getDefaultWrapperConfig(userConfig?, hostHome?)`** -- Build default WrapperConfig.
- **`wrapperUsesSeatbelt(name)`** -- Check if a wrapper uses seatbelt.
- **`wrapperUsesInterceptor(name)`** -- Check if a wrapper uses the Node.js interceptor.
- **`addDynamicWrapper(name, content, targetDir, useSudo?, owner?, group?)`** -- Add a wrapper at runtime.
- **`removeDynamicWrapper(name, targetDir, useSudo?)`** -- Remove a wrapper at runtime.
- **`updateWrapper(name, targetDir, config?, useSudo?)`** -- Update an existing wrapper with regenerated content.

#### Functions -- Binary Deployment

- **`deployInterceptor(userConfig?, hostHome?)`** -- Copy `@agenshield/interceptor/register` to `{hostHome}/.agenshield/lib/interceptor/register.cjs`.
- **`copyNodeBinary(userConfig?, sourcePath?, hostHome?)`** -- Copy a Node.js binary to `{hostHome}/.agenshield/bin/node-bin`. Also copies dynamically-linked dylibs.
- **`copyBrokerBinary(userConfig?, hostHome?)`** -- Copy the broker binary to `{hostHome}/.agenshield/bin/agenshield-broker`.
- **`copyShieldClient(userConfig?, hostHome?)`** -- Copy shield-client with rewritten shebang (uses `node-bin` to avoid interceptor recursion).
- **`installAgentNvm(options)`** -- Install NVM and a Node.js version for the agent user. Returns `NvmInstallResult`.
- **`patchNvmNode(options)`** -- Replace the NVM node binary with an interceptor wrapper script.
- **`execWithProgress(command, log, opts?)`** -- Execute a command with real-time progress logging via spawn.

### PATH Router Override (`path-override.ts`)

Manages router wrappers at `/usr/local/bin/<command>` that route to shielded target instances. Supports single-instance direct routing and multi-instance selection prompts.

#### Types

- **`PathRegistry`** -- `Record<binName, PathRegistryEntry>`
- **`PathRegistryEntry`** -- `{ originalBinary, instances: PathRegistryInstance[] }`
- **`PathRegistryInstance`** -- `{ targetId, profileId, name, agentBinPath, baseName, agentUsername, agentHome? }`

#### Constants

- **`ROUTER_MARKER`** -- `'AGENSHIELD_ROUTER'` marker string in wrapper scripts.
- **`pathRegistryPath(hostHome?)`** -- Resolve registry path under `~/.agenshield/`.

#### Functions

- **`readPathRegistry(hostHome?)`** -- Read registry from disk. Returns empty object on missing/malformed files.
- **`writePathRegistry(registry, hostHome?)`** -- Write registry to disk (creates parent directory if needed).
- **`addRegistryInstance(binName, instance, originalBinary, hostHome?)`** -- Add/replace an instance in the registry.
- **`removeRegistryInstance(binName, targetId, hostHome?)`** -- Remove an instance. Returns remaining count and original binary path.
- **`findOriginalBinary(binName)`** -- Use `which -a` to find the original binary, skipping router wrappers.
- **`isRouterWrapper(filePath)`** -- Check if a file contains the `AGENSHIELD_ROUTER` marker.
- **`generateRouterWrapper(binName)`** -- Generate the bash router wrapper script.
- **`buildInstallRouterCommands(binName, wrapperContent)`** -- Build shell commands to install a router wrapper (backup original, write wrapper, chmod).
- **`buildRemoveRouterCommands(binName)`** -- Build shell commands to restore the original binary.
- **`scanForRouterWrappers()`** -- Scan `/usr/local/bin` for installed router wrappers.

## Internal Dependencies

- `shell/guarded-shell.ts` -- Guarded shell content constants
- `shell/shield-exec.ts` -- Shield-exec content and path helpers
- `enforcement/seatbelt.ts` -- Profile generation and installation
- `@agenshield/ipc` -- `UserConfig` type
- `@agenshield/interceptor` -- Source for interceptor CJS bundle
- `@agenshield/broker` -- Source for broker and shield-client binaries

## Testing

Wrapper content generation is testable via `generateWrapperContent()`. PATH registry operations are file-based and can be tested with temp directories.

## Notes

- Wrapper scripts all include a working directory safety check: `if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi`.
- The `node` wrapper uses `NODE_OPTIONS --require` to load the interceptor. The NVM node binary is patched in-place after all npm installs complete (to avoid interceptor timeouts during installation).
- `installPresetBinaries()` is the high-level entry point that orchestrates NVM install, node copy, interceptor deploy, wrapper install, seatbelt profiles, basic commands, and ownership lockdown.
