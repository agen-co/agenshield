# Shell

Guarded shell and command proxy. Provides the restricted zsh shell that agent users are assigned, and the shield-exec Node.js command proxy that routes all commands through the broker.

## Public API

### Guarded Shell (`guarded-shell.ts`)

The guarded shell is a minimal launcher that sets `ZDOTDIR` to a root-owned config directory, then execs `/bin/zsh`. Restrictions are applied by the `.zshenv` and `.zshrc` files in ZDOTDIR.

#### Functions

- **`guardedShellPath(agentHome)`** -- Per-target guarded shell path: `{agentHome}/.agenshield/bin/guarded-shell`.
- **`zdotDir(agentHome)`** -- Per-target ZDOTDIR path: `{agentHome}/.zdot`.
- **`zdotZshenvContent(agentHome)`** -- Generate per-target `.zshenv` content with correct SHELL path.

#### Constants

- **`GUARDED_SHELL_CONTENT`** -- The shell launcher script content.
- **`ZDOT_ZSHRC_CONTENT`** -- Interactive shell restrictions: readonly PATH/HOME/SHELL, `TRAPDEBUG` enforcement hook, disabled dangerous builtins.

### Shield-Exec (`shield-exec.ts`)

A unified Node.js command proxy installed at `{hostHome}/.agenshield/bin/shield-exec`. All command wrappers in `$HOME/bin/` are symlinks to this binary. It detects the invoked command via `process.argv[1]` (symlink name) and routes through the broker via Unix socket JSON-RPC.

#### Functions

- **`shieldExecPath(hostHome?)`** -- Resolve shield-exec path under `~/.agenshield/`.
- **`generateShieldExecContent(hostHome?)`** -- Generate shield-exec content with the correct shebang for the given host home.

#### Constants

- **`PROXIED_COMMANDS`** -- Commands routed through shield-exec: `bash`, `curl`, `wget`, `git`, `ssh`, `scp`, `rsync`, `brew`, `npm`, `npx`, `pip`, `pip3`, `open-url`, `shieldctl`, `agenco`.

## Internal Dependencies

- `node:net` -- Unix socket communication (shield-exec)

## Security Model

The ZDOTDIR approach guarantees:
1. `.zshenv` runs AFTER `/etc/zshenv`, so it overrides `path_helper`'s PATH.
2. `.zshrc` applies enforcement: readonly variables, disabled builtins, `TRAPDEBUG` hook that blocks unapproved commands.
3. Both files are root-owned (`0644`) so the agent cannot modify them.
4. Dangerous environment variables (`DYLD_INSERT_LIBRARIES`, `LD_PRELOAD`, etc.) are explicitly unset.

## Testing

Shell content generation functions are pure and can be unit tested. Testing the actual shell enforcement requires spawning a restricted shell process as the agent user.

## Notes

- New targets use per-target `guardedShellPath(agentHome)` and `zdotDir(agentHome)`.
- Legacy shared paths (`GUARDED_SHELL_PATH`, `ZDOT_DIR`, `ZDOT_ZSHENV_CONTENT`, `createGuardedShell`) live in `legacy.ts`.
- The `.zshrc` intentionally does NOT use `setopt RESTRICTED` because it disables `cd` entirely. Instead, enforcement is done via `TRAPDEBUG` hooks and selective builtin disabling.
