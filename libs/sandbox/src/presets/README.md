# Presets

Target application preset system. Defines how to detect, migrate, install, and run specific target applications within the AgenShield sandbox. The sandboxing infrastructure (users, groups, seatbelt, wrappers) is universal; presets customize the application-specific layer.

## Public API

### Preset Registry (`index.ts`)

#### Functions

- **`getPreset(id)`** -- Get a preset by ID. Returns `TargetPreset | undefined`.
- **`resolvePresetId(instanceId)`** -- Resolve an instance ID (e.g., `'claude-code-1'`) to its base preset ID (`'claude-code'`).
- **`listPresets()`** -- Return all available presets.
- **`listAutoDetectablePresets()`** -- Return presets that support auto-detection (excludes `custom`).
- **`autoDetectPreset()`** -- Auto-detect which preset matches the current system. Returns the first match.
- **`formatPresetList()`** -- Format preset list for CLI display.

#### Constants

- **`PRESETS`** -- Record of all presets: `openclaw`, `claude-code`, `dev-harness`, `custom`.

#### Preset Instances

- **`openclawPreset`** -- OpenClaw target preset.
- **`claudeCodePreset`** -- Claude Code target preset.
- **`devHarnessPreset`** -- Development harness preset.
- **`customPreset`** -- Custom entry-point preset (requires `--entry-point`).

### Preset Interface (`types.ts`)

#### `TargetPreset`

```ts
interface TargetPreset {
  id: string;
  name: string;
  description: string;
  requiredBins: string[];
  optionalBins?: string[];
  policyPresetIds?: string[];
  detect(): Promise<PresetDetectionResult | null>;
  scan?(detection): Promise<MigrationScanResult | null>;
  migrate(context: MigrationContext): Promise<PresetMigrationResult>;
  getEntryCommand(context: MigrationContext): string;
  install?(context: InstallContext): Promise<InstallResult>;
}
```

#### Related Types

- **`PresetDetectionResult`** -- `{ found, version?, packagePath?, binaryPath?, configPath?, method? }`
- **`MigrationDirectories`** -- `{ binDir, wrappersDir, configDir, packageDir?, npmDir }`
- **`MigrationContext`** -- `{ agentUser, directories, entryPoint?, detection?, selection? }`
- **`PresetMigrationResult`** -- `{ success, error?, newPaths? }`
- **`InstallContext`** -- `{ agentHome, agentUsername, socketGroupName, detection?, hostUsername, hostHome, requestedVersion?, execAsRoot, execAsUser, onProgress, onLog, profileBaseName, freshInstall? }`
- **`InstallResult`** -- `{ success, failedStep?, error?, appBinaryPath?, version?, gatewayPlistPath?, manifestEntries? }`

### Install Pipeline (`actions/`)

Step-based install pipeline using an Ansible-inspired check-then-act pattern with optional saga-style rollback.

#### Functions

- **`runPipeline(steps, ctx, options?)`** -- Execute an ordered array of `InstallStep` objects sequentially. Supports idempotency checks, skip predicates, dynamic step injection, weight-based progress tracking, and optional rollback.
- **`getOpenclawPipeline()`** -- Get the OpenClaw install pipeline steps.
- **`getClaudeCodePipeline()`** -- Get the Claude Code install pipeline steps.

#### Rollback Registry

- **`registerRollback(stepId, handler)`** -- Register a rollback handler for a step ID.
- **`getRollbackHandler(stepId)`** -- Get a rollback handler by step ID.
- **`getRegisteredRollbackSteps()`** -- List all registered rollback step IDs.
- **`ROLLBACK_HANDLERS_REGISTERED`** -- Side-effect import that registers all rollback handlers.

#### Pipeline Types

- **`InstallStep`** -- `{ id, name, description, phase, progressMessage, runsAs, timeout, weight, versionRange?, check?, skip?, resolve?, run, rollback? }`
- **`StepUser`** -- `'root' | 'agent' | 'mixed'`
- **`CheckResult`** -- `'needed' | 'satisfied' | 'error'`
- **`StepResult`** -- `{ changed, outputs?, warnings? }`
- **`PipelineState`** -- `{ outputs, shellBackups? }`
- **`PipelineOptions`** -- `{ version?, onStepStart?, onStepComplete?, rollbackOnFailure? }`
- **`PipelineResult`** -- Extends `InstallResult` with `manifestEntries`
- **`RollbackContext`** -- `{ execAsRoot, onLog, agentHome, agentUsername, profileBaseName, hostHome, hostUsername }`
- **`RollbackHandler`** -- `(ctx, entry) => Promise<void>`

#### Shared Steps (`actions/shared/`)

Reusable step factories shared across preset pipelines:

- `installHomebrewStep` -- Install Homebrew in the agent user's home
- `createInstallNvmAndNodeStep()` -- Install NVM and Node.js
- `copyNodeBinaryStep` -- Copy node binary to shared bin
- `patchNvmNodeStep` -- Patch NVM node with interceptor wrapper
- `saveHostShellConfigStep` -- Save host shell config before modification
- `createRestoreShellConfigStep()` -- Restore host shell config
- `createStopHostProcessesStep()` -- Stop host processes before migration
- `createCopyHostConfigStep()` -- Copy host config to agent home

## Internal Dependencies

- `errors.ts` -- `StepExecutionError` for pipeline failures
- `wrappers/wrappers.ts` -- `installPresetBinaries`, `patchNvmNode`, etc.
- `shell/guarded-shell.ts` -- Shell path helpers
- `presets/install-helpers.ts` -- `HostShellConfigBackup` and shared install utilities
- `@agenshield/ipc` -- `ManifestEntry`, `PrivilegeExecResult` types

## Testing

- Preset detection functions can be tested by mocking filesystem and command execution.
- Pipeline runner can be tested with mock `InstallStep` objects.
- Rollback handlers can be tested independently with mock `RollbackContext`.

## Notes

- Pipeline steps use `versionRange` for semver filtering (e.g., skip steps for old versions).
- The `resolve()` hook on `InstallStep` enables dynamic step injection at runtime.
- Rollback handlers are registered as a side-effect when `rollbacks/index.ts` is imported. They are used by manifest-driven unshield flows where no live `PipelineState` is available.
- The `custom` preset is excluded from auto-detection and requires an explicit `--entry-point` flag.
