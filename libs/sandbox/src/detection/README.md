# Detection

Read-only host inspection utilities. Detects existing target application installations, checks security status, scans the host for environment variables and secrets, and discovers binaries and skills. This module never writes to any file or modifies source data.

## Public API

### OpenClaw Detection (`detect.ts`)

#### Functions

- **`detectOpenClaw()`** -- Detect OpenClaw installations (npm and git methods). Returns `DetectionResult` with installation info, errors, and warnings. Prefers npm when both methods are found.
- **`checkPrerequisites()`** -- Check system prerequisites (Node.js 22+, macOS, `dscl` availability). Returns `{ ok, missing }`.

#### Types

- **`InstallMethod`** -- `'npm' | 'git' | 'unknown'`
- **`OpenClawInstallation`** -- `{ found, method, packagePath?, binaryPath?, configPath?, version?, gitRepoPath? }`
- **`DetectionResult`** -- `{ installation, errors, warnings }`
- **`PrerequisitesResult`** -- `{ ok, missing }`

### Security Status (`security.ts`)

#### Functions

- **`checkSecurityStatus(options?)`** -- Comprehensive security check. Detects: running-as-root, sandbox user existence, process isolation, guarded shell, exposed secrets, and running processes. Returns a `SecurityStatus` with level (`secure`, `partial`, `unprotected`, `critical`).
- **`isSecretEnvVar(name)`** -- Check if an environment variable name matches known secret patterns (API keys, tokens, passwords, etc.).

#### Types

- **`SecurityStatus`** -- `{ runningAsRoot, currentUser, sandboxUserExists, isIsolated, guardedShellInstalled, exposedSecrets, warnings, critical, recommendations, level }`
- **`SecurityCheckOptions`** -- `{ knownSandboxUsers?, processPatterns?, targets? }`
- **`TargetProcessMapping`** -- `{ agentUsername, processNames }`

### Host Scanner (`host-scanner.ts`)

Scans the host system for environment variables, secrets, and skills from multiple sources. Strictly read-only.

#### Functions

- **`scanHost(options?)`** -- Perform a complete host scan. Returns `MigrationScanResult` with skills and env vars from all sources.
- **`scanOpenClawConfig(configJsonPath)`** -- Read an OpenClaw config file and extract skills and env vars.
- **`scanProcessEnv()`** -- Scan `process.env` for known secret env vars.
- **`scanShellProfiles(home)`** -- Scan shell profile files (`.bashrc`, `.zshrc`, `.zprofile`, `.bash_profile`, `.profile`) for env var exports.
- **`maskSecretValue(value)`** -- Mask a secret value for display (shows first/last 2 characters).
- **`resolveEnvVarValue(name, sources)`** -- Resolve the current value of an env var from process.env or shell profile files.

#### Types

- **`ScanHostOptions`** -- `{ configJsonPath?, home?, skipProcessEnv?, skipShellProfiles? }`

### Discovery (`discovery/`)

Binary and skill scanning for the agent's sandbox environment.

#### Functions

- **`scanDiscovery(options)`** -- Full discovery scan: binaries + skills.
- **`scanBinaries(options)`** -- Scan directories for binaries, classify them (wrapper, symlink, native, script), and detect protection status.
- **`scanSkills(options)`** -- Scan skill directories for `SKILL.md` files.
- **`parseSkillMd(content)`** -- Parse a `SKILL.md` file into structured skill metadata.
- **`extractSkillInfo(skillDir)`** -- Extract skill information from a directory.
- **`classifyDirectory(dir)`** -- Classify a directory as bin, config, workspace, etc.
- **`stripEnvFromSkillMd(content)`** -- Remove env var blocks from SKILL.md content.

## Internal Dependencies

- `users/users.ts` -- `userExistsSync` (for security checks)
- `shell/guarded-shell.ts` -- `GUARDED_SHELL_PATH` (for guarded shell detection)
- `@agenshield/ipc` -- `ScannedSkill`, `ScannedEnvVar`, `MigrationScanResult` types

## Testing

All detection functions are read-only and can be tested by mocking filesystem reads and command execution. No sudo required.

## Notes

- `detectOpenClaw()` checks standard npm global directories and common git install locations (`~/openclaw`, `~/.openclaw-src`, `~/code/openclaw`, `~/src/openclaw`).
- `checkSecurityStatus()` uses `dscl` to discover sandbox users and `ps aux` to check process isolation.
- The host scanner handles `SUDO_USER` to resolve the real home directory when running under sudo.
- Secret patterns match common prefixes (`TWILIO_`, `OPENAI_`, `AWS_`, etc.) and suffixes (`_API_KEY`, `_SECRET`, `_TOKEN`, `_PASSWORD`).
