/**
 * Hardened guarded-shell for zsh (ZDOTDIR approach)
 *
 * The guarded-shell is a minimal launcher that sets ZDOTDIR to a root-owned
 * config directory, then execs /bin/zsh. The actual restrictions live in
 * .zshenv and .zshrc inside that ZDOTDIR, which zsh reads on startup.
 *
 * This avoids the previous bug where `exec /bin/zsh -f` discarded all
 * shell-level restrictions (RESTRICTED, preexec hooks, disabled builtins)
 * and macOS /etc/zshenv restored the full system PATH via path_helper.
 *
 * ZDOTDIR approach guarantees:
 * - .zshenv runs AFTER /etc/zshenv, so we override path_helper's PATH
 * - .zshenv applies enforcement (TRAPDEBUG, builtin lockdown) for ALL shells
 *   including non-interactive `zsh -c '...'` invocations
 * - .zshrc applies interactive-only settings (cd, shell options)
 * - Both files are root-owned (0644) so the agent cannot modify them
 *
 * Security model for wrappers:
 * Wrappers in ~/bin/ use "#!/bin/bash" + "exec /usr/bin/<cmd>". When the agent
 * runs "curl", TRAPDEBUG sees "curl" (no path) -> is_allowed_cmd finds ~/bin/curl
 * -> allowed -> zsh fork/execs the bash wrapper -> bash runs "exec /usr/bin/curl"
 * which replaces the process entirely outside zsh scope. TRAPDEBUG never sees the
 * inner /usr/bin/curl. If the agent directly types "/usr/bin/curl", TRAPDEBUG
 * catches the "*\/*" pattern and denies it.
 */

/**
 * Shell feature flags for target-aware configuration.
 * Controls which toolchains are included in the guarded shell environment.
 */
export interface ShellFeatures {
  /** Include Homebrew in PATH and env vars (default: false) */
  homebrew?: boolean;
  /** Include NVM initialization and Node.js (default: false) */
  nvm?: boolean;
  /** Set HTTP_PROXY/HTTPS_PROXY to route all traffic through broker (default: false) */
  proxy?: boolean;
}

/**
 * Compute the per-target guarded-shell binary path under the agent's home directory.
 * Each target gets its own copy so they can be independently managed in /etc/shells.
 */
export function guardedShellPath(agentHome: string): string {
  return `${agentHome}/.agenshield/bin/guarded-shell`;
}

/**
 * Compute the per-target ZDOTDIR path under the agent's home directory.
 * This isolates per-agent env vars, session identification, and Node.js versions.
 */
export function zdotDir(agentHome: string): string {
  return `${agentHome}/.zdot`;
}

/**
 * Guarded shell launcher — minimal, just sets ZDOTDIR and execs zsh.
 * Restrictions are applied by ZDOT_ZSHENV_CONTENT and ZDOT_ZSHRC_CONTENT.
 */
export const GUARDED_SHELL_CONTENT = `#!/bin/zsh
# guarded-shell: launcher for restricted agent shell.
# All restrictions live in ZDOTDIR files (root-owned, immutable to agent).
emulate -LR zsh

# Prevent inherited env tricks before handing off to zsh
unset DYLD_LIBRARY_PATH DYLD_FALLBACK_LIBRARY_PATH DYLD_INSERT_LIBRARIES
unset PYTHONPATH NODE_PATH RUBYLIB PERL5LIB
unset SSH_ASKPASS LD_PRELOAD

# Dynamically resolve the calling user's home for per-target ZDOTDIR
_ASH_HOME="$(/usr/bin/dscl . -read /Users/$(/usr/bin/id -un) NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}')"
[ -z "$_ASH_HOME" ] && _ASH_HOME="/Users/$(/usr/bin/id -un)"
export HOME="\${_ASH_HOME}"

# Per-target ZDOTDIR under agent home
export ZDOTDIR="\${_ASH_HOME}/.zdot"

# Start zsh — it will read ZDOTDIR/.zshenv then ZDOTDIR/.zshrc
exec /bin/zsh "$@"
`;

/**
 * Generate per-target ZDOTDIR .zshenv content with the correct SHELL path.
 * Uses the per-target guardedShellPath instead of the shared /usr/local/bin path.
 *
 * .zshenv runs for ALL shell types (interactive, non-interactive, `zsh -c`).
 * All enforcement (TRAPDEBUG, builtin lockdown, is_allowed_cmd) lives here
 * so that `zsh -c '/usr/bin/curl ...'` is blocked just like interactive use.
 *
 * When features.homebrew is false, omits Homebrew env vars and PATH entries.
 * When features.nvm is false, omits NVM initialization.
 */
export function zdotZshenvContent(agentHome: string, features: ShellFeatures = {}): string {
  const { homebrew = false, nvm = false, proxy = false } = features;

  const pathParts = ['$HOME/bin', '$HOME/.local/bin'];
  if (homebrew) pathParts.push('$HOME/homebrew/bin');
  const pathLine = `export PATH="${pathParts.join(':')}"`;

  const brewSection = homebrew ? `
# Homebrew environment (agent-local prefix)
export HOMEBREW_PREFIX="$HOME/homebrew"
export HOMEBREW_CELLAR="$HOME/homebrew/Cellar"
export HOMEBREW_REPOSITORY="$HOME/homebrew"
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_FROM_API=1
` : '';

  const nvmSection = nvm ? `
# NVM fast-PATH (resolve default version onto PATH without sourcing nvm.sh)
export NVM_DIR="$HOME/.nvm"
if [ -d "$NVM_DIR/versions/node" ]; then
  _NVM_ALIAS=$(cat "$NVM_DIR/alias/default" 2>/dev/null)
  _NVM_DIRS=("$NVM_DIR/versions/node/v\${_NVM_ALIAS}"*(N/))
  _NVM_VER=\${_NVM_DIRS[-1]}
  if [ -n "$_NVM_VER" ] && [ -d "$_NVM_VER/bin" ]; then
    export PATH="$_NVM_VER/bin:$PATH"
  fi
  unset _NVM_ALIAS _NVM_DIRS _NVM_VER
fi
` : '';

  const proxySection = proxy ? `
# Route all HTTP traffic through broker proxy (catches embedded Node.js, etc.)
export HTTP_PROXY="http://127.0.0.1:5201"
export HTTPS_PROXY="http://127.0.0.1:5201"
export NO_PROXY="localhost,127.0.0.1"
export NODE_EXTRA_CA_CERTS="/etc/ssl/cert.pem"
` : '';

  // Readonly vars: always lock PATH, HOME, SHELL, HISTFILE; add NVM_DIR if nvm enabled
  const readonlyVars = ['PATH', 'HOME', 'SHELL', 'HISTFILE'];
  if (nvm) readonlyVars.push('NVM_DIR');
  if (proxy) readonlyVars.push('NODE_EXTRA_CA_CERTS');
  const readonlyLine = `typeset -r ${readonlyVars.join(' ')}`;

  // is_allowed_cmd: additional path checks based on features
  const homebrewCheck = homebrew ? `  [[ -x "$HOME/homebrew/bin/$cmd" ]] && return 0\n` : '';
  const nvmCheck = nvm ? `
  # NVM: check via whence (nvm commands are real binaries, not symlinks)
  local resolved
  resolved="$(whence -p -- "$cmd" 2>/dev/null)" || return 1
  [[ "$resolved" == "$HOME/.nvm/"* ]] && return 0` : '';

  return `# AgenShield restricted .zshenv
# Runs AFTER /etc/zshenv — overrides path_helper's full system PATH.
# Contains ALL enforcement (TRAPDEBUG, builtin lockdown) so that both
# interactive shells and non-interactive \`zsh -c '...'\` are restricted.

# ALWAYS set HOME based on actual user, never inherit
export HOME="/Users/$(/usr/bin/id -un)"
export HISTFILE="$HOME/.zsh_history"

# Suppress locale to prevent /etc/zshrc from calling locale command
export LC_ALL=C LANG=C

${pathLine}
export SHELL="${guardedShellPath(agentHome)}"
${brewSection}${nvmSection}${proxySection}
# Clear any leftover env tricks
unset DYLD_LIBRARY_PATH DYLD_FALLBACK_LIBRARY_PATH DYLD_INSERT_LIBRARIES
unset PYTHONPATH NODE_PATH RUBYLIB PERL5LIB
unset SSH_ASKPASS LD_PRELOAD

# ---- Lock critical variables (readonly) ----
${readonlyLine}

# ---- Enforcement helpers ----
deny() {
  print -r -- "Denied by policy"
  return 126
}

is_allowed_cmd() {
  local cmd="$1"

  # Allow zsh reserved words (if, for, while, [[, case, etc.)
  [[ "$(whence -w "$cmd" 2>/dev/null)" == *": reserved" ]] && return 0

  # Allow shell builtins we explicitly permit
  case "$cmd" in
    cd|pwd|echo|printf|test|true|false|exit|return|break|continue|shift|set|unset|export|typeset|local|declare|readonly|let|read|print|pushd|popd|dirs|jobs|fg|bg|kill|wait|times|ulimit|umask|history|fc|type|whence|which|where|rehash|setopt|unsetopt)
      return 0
      ;;
  esac

  # Deny path execution outright (e.g. /usr/bin/curl, ./script.sh)
  # Wrappers are safe: ~/bin/curl is #!/bin/bash + exec /usr/bin/curl,
  # so zsh fork/execs bash which replaces the process — TRAPDEBUG
  # never sees the inner /usr/bin/curl call.
  [[ "$cmd" == */* ]] && return 1

  # Allow if command exists in any allowed directory (handles symlinks correctly)
  # -x checks file existence + execute permission at the symlink path, not the target
  [[ -x "$HOME/bin/$cmd" ]] && return 0
  [[ -x "$HOME/.local/bin/$cmd" ]] && return 0
${homebrewCheck}${nvmCheck}
  return 1
}

# ---- Block dangerous builtins ----
# Disable as reserved words (command, exec, builtin ARE reserved words in zsh)
disable -r command exec builtin 2>/dev/null || true
# Disable as builtins (eval, source, hash, etc.)
disable eval hash nohup source unfunction functions alias unalias 2>/dev/null || true

# ---- TRAPDEBUG: intercept ALL commands (interactive AND non-interactive) ----
typeset -gi __ash_guard=0

TRAPDEBUG() {
  # Prevent recursion when our own checks invoke whence/is_allowed_cmd
  (( __ash_guard )) && return 0

  local line="${'$'}{ZSH_DEBUG_CMD:-$1}"
  local cmd="${'$'}{line%%[[:space:]]*}"
  [[ -z "$cmd" ]] && return 0

  # Skip variable assignments (e.g. resolved="$(whence ...)")
  [[ "$cmd" == *=* ]] && return 0

  # Skip zsh reserved words ([[, if, for, while, case, etc.)
  __ash_guard=1
  [[ "$(whence -w "$cmd" 2>/dev/null)" == *": reserved" ]] && { __ash_guard=0; return 0; }

  [[ "$cmd" == */* ]] && { __ash_guard=0; print -r -- "Denied: direct path execution"; return 126; }
  is_allowed_cmd "$cmd" || { __ash_guard=0; print -r -- "Denied: $cmd"; return 126; }
  __ash_guard=0
  return 0
}

# Skip system rc files (/etc/zprofile, /etc/zshrc, /etc/zlogin)
# They may call commands not in our restricted PATH (e.g. locale).
# ZDOTDIR files (.zshrc) are still read.
setopt NO_GLOBAL_RCS
`;
}

/**
 * Generate per-target ZDOTDIR .zshrc content.
 * Interactive-only settings: shell options, working directory, defense-in-depth re-locks.
 *
 * All enforcement (TRAPDEBUG, builtin lockdown) is in .zshenv so it applies
 * to non-interactive shells too. .zshrc only adds interactive niceties.
 *
 * When features.homebrew is false, omits Homebrew env/PATH re-assertion.
 * When features.nvm is false, omits NVM PATH re-assertion.
 */
export function zdotZshrcContent(features: ShellFeatures = {}): string {
  const { homebrew = false, nvm = false, proxy = false } = features;

  const pathParts = ['$HOME/bin', '$HOME/.local/bin'];
  if (homebrew) pathParts.push('$HOME/homebrew/bin');
  const pathLine = `PATH="${pathParts.join(':')}"`;
  const pathComment = homebrew
    ? '# Re-set PATH (~/bin + ~/.local/bin + ~/homebrew/bin — override anything that may have been added)'
    : '# Re-set PATH (~/bin + ~/.local/bin — override anything that may have been added)';

  const brewSection = homebrew ? `
# Homebrew environment (agent-local prefix)
export HOMEBREW_PREFIX="$HOME/homebrew"
export HOMEBREW_CELLAR="$HOME/homebrew/Cellar"
export HOMEBREW_REPOSITORY="$HOME/homebrew"
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_FROM_API=1
` : '';

  const nvmSection = nvm ? `
# NVM fast-PATH (no full sourcing — just resolve default version)
export NVM_DIR="$HOME/.nvm"
if [ -d "$NVM_DIR/versions/node" ]; then
  _NVM_ALIAS=$(cat "$NVM_DIR/alias/default" 2>/dev/null)
  _NVM_DIRS=("$NVM_DIR/versions/node/v\${_NVM_ALIAS}"*(N/))
  _NVM_VER=\${_NVM_DIRS[-1]}
  if [ -n "$_NVM_VER" ] && [ -d "$_NVM_VER/bin" ]; then
    PATH="$_NVM_VER/bin:$PATH"
  fi
  unset _NVM_ALIAS _NVM_DIRS _NVM_VER
fi
` : '';

  // Re-assert readonly for defense-in-depth (already set in .zshenv)
  const readonlyVars = ['PATH', 'HOME', 'SHELL', 'HISTFILE'];
  if (nvm) readonlyVars.push('NVM_DIR');
  if (proxy) readonlyVars.push('NODE_EXTRA_CA_CERTS');
  const readonlyLine = `typeset -r ${readonlyVars.join(' ')} 2>/dev/null || true`;

  return `# AgenShield restricted .zshrc
# Interactive-only settings. All enforcement lives in .zshenv.

emulate -LR zsh

# Re-set HISTFILE (safety: ensure it points to agent's home, not ZDOTDIR)
HISTFILE="$HOME/.zsh_history"

${pathComment}
${pathLine}
${brewSection}${nvmSection}
# ---- Shell options ----
# Note: NOT using setopt RESTRICTED as it disables cd entirely.
setopt NO_CASE_GLOB
setopt NO_BEEP

# ---- Re-assert readonly (defense-in-depth, already set in .zshenv) ----
${readonlyLine}

# ---- Intercept every interactive command before execution ----
preexec() {
  # Enforcement handled by the debug trap in .zshenv (which can cancel via return 126).
  # preexec cannot prevent execution, so we don't enforce here.
  return 0
}

# ---- Ensure accessible working directory ----
if [[ -n "$AGENSHIELD_HOST_CWD" ]] && [[ -d "$AGENSHIELD_HOST_CWD" ]]; then
  if ! cd "$AGENSHIELD_HOST_CWD" 2>/dev/null; then
    print -r -- "AgenShield: Cannot access $AGENSHIELD_HOST_CWD — using home directory" >&2
    cd "$HOME" 2>/dev/null || cd /
  fi
else
  cd "$HOME" 2>/dev/null || cd /
fi
unset AGENSHIELD_HOST_CWD
`;
}

/**
 * Legacy constant — equivalent to zdotZshrcContent({ homebrew: true, nvm: true }).
 * Kept for backwards compatibility with existing consumers.
 * @deprecated Use zdotZshrcContent(features) instead.
 */
export const ZDOT_ZSHRC_CONTENT = zdotZshrcContent({ homebrew: true, nvm: true });
