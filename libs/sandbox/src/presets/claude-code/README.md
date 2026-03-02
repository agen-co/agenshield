# Claude Code Interception Architecture

This directory (`libs/sandbox/src/presets/claude-code/`) contains the Claude Code preset for AgenShield. Its most critical responsibility is **patching Claude Code's bundled Node.js binary** to inject the AgenShield runtime interceptor, ensuring policy enforcement even for Claude's internal operations.

## Why Patching Is Needed

Claude Code bundles its own Node.js binary at `~/.local/share/claude/node` (or similar paths under `~/.local/`). This embedded binary:

- **Bypasses NVM and the system PATH** — `NODE_OPTIONS` set in the shell environment never reaches it.
- **Ignores wrapper scripts** — standard `$HOME/bin/node` wrappers only apply when `node` is resolved via PATH.
- **Skips proxy settings** — while `HTTP_PROXY`/`HTTPS_PROXY` catch outbound HTTP, they do not enable the interceptor's `exec`/`spawn`/`fetch` hooks inside the Node process.

Without the patch, the interceptor's child-process and network hooks are inactive for any code Claude runs through its embedded Node.js.

## Architecture

End-to-end flow from user invocation to policy enforcement:

```
User runs: /usr/local/bin/claude
  |
  v
Router wrapper (path-registry.json lookup)
  |  sudo -u ash_claudecode_agent
  v
Guarded shell ($agentHome/.agenshield/bin/guarded-shell)
  |  sets ZDOTDIR, restricted PATH, HTTP_PROXY
  v
App wrapper ($agentHome/bin/claude)
  |
  v
Claude Code binary ($agentHome/.local/bin/claude)
  |  spawns embedded Node.js
  v
Patched node ($agentHome/.local/.../node)
  |  bash wrapper -> NODE_OPTIONS="--require register.cjs"
  |  exec node.real "$@"
  v
register.cjs -> installInterceptors()
  |
  |-- FetchInterceptor       (globalThis.fetch)
  |-- HttpInterceptor        (http/https.request)
  |-- WebSocketInterceptor   (globalThis.WebSocket)
  |-- ChildProcessInterceptor (exec/spawn/fork)
  |-- FsInterceptor          (optional, disabled by default)
  |
  v
Policy checks via AsyncClient
  -> Unix socket ($agentHome/.agenshield/run/agenshield.sock)
  -> HTTP fallback (localhost:5201)
```

## How the Patch Works

Reference: `patch-claude-node.ts`

The patch step runs as root during Phase 9 of the install pipeline. It is best-effort and non-fatal.

### Step-by-step

1. **Find candidates** — search for executable files named `node` under `$agentHome/.local`:
   ```bash
   find "$agentHome/.local" -name "node" -type f -perm +111 2>/dev/null | head -5
   ```

2. **Skip already-patched binaries** — run `file` on each candidate; if the output contains `text` or `script`, it is already a wrapper:
   ```bash
   file "/path/to/node"
   # Already patched: "ASCII text executable" or "Bourne-Again shell script"
   # Not patched: "Mach-O 64-bit executable arm64"
   ```

3. **Backup the original** — copy the real binary to `node.real`:
   ```bash
   cp node node.real
   chmod 755 node.real
   ```

4. **Write a bash wrapper** in place of the original binary:
   ```bash
   #!/bin/bash
   # AgenShield node wrapper — injects interceptor into Claude's embedded node
   SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
   NODE_REAL="$SCRIPT_DIR/$(basename "$0").real"
   if [ -f "<hostHome>/.agenshield/lib/interceptor/register.cjs" ]; then
     export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require <hostHome>/.agenshield/lib/interceptor/register.cjs"
   fi
   exec "$NODE_REAL" "$@"
   ```

5. **Set permissions** — `chmod 755` and `chown agentUsername:socketGroupName`.

### Skip conditions

The step is skipped entirely when:
- Platform is not `darwin` (`process.platform !== 'darwin'`)
- Enforcement mode is `'proxy'` (proxy-only mode does not need interceptor injection)

## The Interceptor Bootstrap Chain

Reference: `register.ts` / `require.ts` -> `installer.ts`

1. **Entry** — the `--require register.cjs` flag causes Node.js to load the interceptor before the application.

2. **Re-entrancy guard** — `AGENSHIELD_INTERCEPTOR_REGISTERED` env var prevents duplicate installation in child processes that inherit `NODE_OPTIONS`.

3. **`installInterceptors()`** creates shared infrastructure:
   - `AsyncClient` — communicates with the broker via Unix socket, with HTTP fallback.
   - `PolicyEvaluator` — queries the broker for allow/deny decisions.
   - `EventReporter` — batched audit event reporting.

4. **Conditional interceptor installation** based on `AGENSHIELD_INTERCEPT_*` env vars:
   - `FetchInterceptor` — patches `globalThis.fetch`
   - `HttpInterceptor` — patches `http.request` / `https.request`
   - `WebSocketInterceptor` — patches `globalThis.WebSocket`
   - `ChildProcessInterceptor` — patches `child_process.exec` / `spawn` / `fork`
   - `FsInterceptor` — patches `fs` / `fs/promises` (disabled by default)

5. Each interceptor is reversible — `uninstallInterceptors()` restores original implementations.

## Environment Variables

Variables set by wrapper scripts and consumed by the interceptor:

| Variable | Purpose | Default |
|----------|---------|---------|
| `NODE_OPTIONS` | Injects `--require register.cjs` | Set by patch wrapper |
| `AGENSHIELD_SOCKET` | Unix socket path to broker | `$HOME/.agenshield/run/agenshield.sock` |
| `AGENSHIELD_HOST` | HTTP fallback host | `localhost` |
| `AGENSHIELD_PORT` | HTTP fallback port | `5201` |
| `AGENSHIELD_INTERCEPT_FETCH` | Enable fetch hook | `true` (disable with `false`) |
| `AGENSHIELD_INTERCEPT_HTTP` | Enable http/https hook | `true` (disable with `false`) |
| `AGENSHIELD_INTERCEPT_WS` | Enable WebSocket hook | `true` (disable with `false`) |
| `AGENSHIELD_INTERCEPT_EXEC` | Enable child_process hook | `true` (disable with `false`) |
| `AGENSHIELD_INTERCEPT_FS` | Enable fs hook | `false` |
| `AGENSHIELD_CONTEXT_TYPE` | Execution context: `agent` or `skill` | `agent` |
| `AGENSHIELD_SEATBELT` | Enable macOS seatbelt wrapping for exec | `true` on darwin |
| `AGENSHIELD_FAIL_OPEN` | Allow operations if broker unreachable | `false` |
| `AGENSHIELD_LOG_LEVEL` | Interceptor log verbosity | `warn` |
| `AGENSHIELD_TIMEOUT` | Broker request timeout (ms) | `5000` |
| `AGENSHIELD_INTERCEPTOR_REGISTERED` | Re-entrancy guard (set internally) | Unset |

## Defense-in-Depth Layers

Five enforcement layers work together for Claude Code:

1. **Embedded Node binary patch** — ensures the interceptor loads inside Claude's own Node.js process. Catches exec/spawn/fetch calls that originate from Claude's internal code.

2. **Wrapper scripts** (`$agentHome/bin/node`, `$agentHome/bin/npm`, etc.) — set `NODE_OPTIONS` and env vars for any Node.js resolved via PATH. Covers NVM-installed node and explicit `node` invocations.

3. **HTTP Proxy** — `HTTP_PROXY`/`HTTPS_PROXY` set in the guarded shell environment catch all outbound HTTP traffic at the network level, routing it through the broker.

4. **Seatbelt profiles** — kernel-enforced deny rules (via `sandbox-exec`) that block network access, system binary execution, and writes to protected directories. Cannot be bypassed from userspace.

5. **Guarded shell** — restricted zsh with locked PATH, disabled builtins, `TRAPDEBUG` hook, and `ZDOTDIR` override. Prevents shell escapes and PATH manipulation.

## Pipeline Integration

Reference: `pipeline.ts`

The Claude Code pipeline (`getClaudeCodePipeline()`) runs these steps in order:

| Phase | Step | Weight | Description |
|-------|------|--------|-------------|
| 6 | `saveHostShellConfigStep` | 1 | Back up host shell config (`.zshrc`, `.zprofile`) |
| 8 | `installClaudeCodeStep` | 30 | Download and install Claude Code |
| 8 | `createRestoreShellConfigStep` | 1 | Restore shell config after Claude installer modifies it |
| 8 | `verifyClaudeBinaryStep` | 5 | Verify the installed binary works |
| 8 | `copyClaudeNodeBinStep` | 3 | Copy embedded Node.js to `bin/node-bin` for shield-client |
| 9 | `createAppWrapperStep` | 2 | Write `$agentHome/bin/claude` wrapper script |
| 9 | `createStopHostProcessesStep` | 3 | Stop host Claude processes before config copy |
| 9 | `detectHostClaudeStep` | 2 | Detect host Claude config, resolve copy + rewrite steps |
| 9 | `copyClaudeCredentialsStep` | 2 | Extract OAuth credentials from macOS Keychain |
| 9 | **`patchClaudeNodeStep`** | 2 | **Patch embedded Node.js (this README's main topic)** |

The patch step:
- Runs as **root** (Phase 9, `runsAs: 'root'`)
- Is **skipped** on non-darwin platforms
- Is **skipped** when `enforcementMode === 'proxy'`
- Is **non-fatal** — Claude Code updates may relocate the binary; the step catches all errors
- Has a **20-second timeout** with a 10-second inner timeout on the `find` command

## Key Files

| File | Purpose |
|------|---------|
| `preset.ts` | Preset definition: `detect()`, `migrate()`, `getEntryCommand()`, `install()` |
| `pipeline.ts` | Ordered step array (`getClaudeCodePipeline()`) |
| `copy-claude-node-bin.ts` | Copies Claude's embedded Node.js to `bin/node-bin` for shield-client |
| `patch-claude-node.ts` | Embedded Node.js binary wrapping (this README's main topic) |
| `install-claude-code.ts` | Downloads and installs Claude Code via official installer |
| `verify-claude-binary.ts` | Post-install binary verification |
| `detect-host-claude.ts` | Detects host Claude config, resolves copy + rewrite steps |
| `copy-claude-credentials.ts` | Extracts OAuth credentials from macOS Keychain |
| `copy-claude-config.ts` | Copies Claude configuration files to the sandbox |
| `rewrite-claude-paths.ts` | Rewrites hardcoded paths in copied config |
| `claude-paths.ts` | PATH construction helpers for Claude binary resolution |
| `index.ts` | Barrel export for the preset |

## Contribution Guidelines

- **Adding a new pipeline step:** Create a new file in this directory, implement the `InstallStep` interface (from `../types.ts`), and add it to the array in `pipeline.ts`.

- **Modifying the patch:** Keep it:
  - **Idempotent** — check `file` output before patching; skip if already a text/script wrapper.
  - **Non-fatal** — catch all errors; the step must never fail the entire pipeline.
  - **Backwards-compatible** — never overwrite `node.real` if it already exists.

- **Testing:** `npx nx build sandbox` to verify compilation. Manual testing requires a shielded Claude Code target with a real `~/.local` directory.

- **Fragility warning:** Claude Code updates may relocate the embedded node binary. The `find` command is the detection heuristic — update the search path if Claude changes its directory layout.

- **Enforcement mode awareness:** Always check `ctx.enforcementMode` before injecting interceptor-related artifacts. Proxy-only mode (`'proxy'`) should skip interceptor injection entirely.

## Related Libraries

| Library | Relationship |
|---------|-------------|
| `libs/shield-interceptor` | The interceptor loaded by the patch (`register.cjs` -> `installInterceptors()`) |
| `libs/sandbox/src/enforcement/seatbelt.ts` | Kernel-level sandbox profiles applied to Claude's processes |
| `libs/sandbox/src/wrappers/` | Wrapper script definitions for `node`, `npm`, `curl`, etc. |
| `libs/sandbox/src/shell/` | Restricted zsh shell environment (guarded shell) |
| `libs/sandbox/src/presets/types.ts` | `InstallStep`, `InstallContext`, `TargetPreset` type definitions |
| `libs/shield-daemon/src/routes/target-lifecycle.ts` | Daemon endpoint that orchestrates the full shielding lifecycle |
