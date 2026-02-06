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
 * - .zshrc applies RESTRICTED mode, hooks, and builtin lockdown
 * - Both files are root-owned (0644) so the agent cannot modify them
 */

export const GUARDED_SHELL_PATH = '/usr/local/bin/guarded-shell';
export const ZDOT_DIR = '/etc/agenshield/zdot';

/**
 * Guarded shell launcher — minimal, just sets ZDOTDIR and execs zsh.
 * Restrictions are applied by ZDOT_ZSHENV_CONTENT and ZDOT_ZSHRC_CONTENT.
 */
export const GUARDED_SHELL_CONTENT = `#!/bin/zsh
# guarded-shell: launcher for restricted agent shell.
# All restrictions live in ZDOTDIR files (root-owned, immutable to agent).
emulate -LR zsh

# Prevent inherited env tricks before handing off to zsh
unset HOME
unset DYLD_LIBRARY_PATH DYLD_FALLBACK_LIBRARY_PATH DYLD_INSERT_LIBRARIES
unset PYTHONPATH NODE_PATH RUBYLIB PERL5LIB
unset SSH_ASKPASS LD_PRELOAD

# Point zsh at our restricted config directory
export ZDOTDIR="/etc/agenshield/zdot"

# Start zsh — it will read ZDOTDIR/.zshenv then ZDOTDIR/.zshrc
exec /bin/zsh
`;

/**
 * ZDOTDIR .zshenv — runs after /etc/zshenv (which calls path_helper on macOS).
 * Overrides PATH to only include $HOME/bin.
 */
export const ZDOT_ZSHENV_CONTENT = `# AgenShield restricted .zshenv
# Runs AFTER /etc/zshenv — overrides path_helper's full system PATH.

# ALWAYS set HOME based on actual user, never inherit
export HOME="/Users/\$(id -un)"
export PATH="$HOME/bin"
export SHELL="/usr/local/bin/guarded-shell"

# Clear any leftover env tricks
unset DYLD_LIBRARY_PATH DYLD_FALLBACK_LIBRARY_PATH DYLD_INSERT_LIBRARIES
unset PYTHONPATH NODE_PATH RUBYLIB PERL5LIB
unset SSH_ASKPASS LD_PRELOAD
`;

/**
 * ZDOTDIR .zshrc — interactive shell restrictions.
 * Applies RESTRICTED mode, locks variables, disables builtins, installs hooks.
 */
export const ZDOT_ZSHRC_CONTENT = `# AgenShield restricted .zshrc
# Applied to every interactive shell for the agent user.

emulate -LR zsh

# ---- Shell options ----
# Note: NOT using setopt RESTRICTED as it disables cd entirely.
# Instead we use preexec hooks and builtin disable for enforcement.
setopt NO_CASE_GLOB
setopt NO_BEEP

# ---- Lock critical variables (readonly) ----
typeset -r PATH HOME SHELL

# ---- Enforcement helpers ----
deny() {
  print -r -- "Denied by policy"
  return 126
}

is_allowed_cmd() {
  local cmd="$1"

  # Allow shell builtins we explicitly permit
  case "\\$cmd" in
    cd|pwd|echo|printf|test|true|false|exit|return|break|continue|shift|set|unset|export|typeset|local|declare|readonly|let|read|print|pushd|popd|dirs|jobs|fg|bg|kill|wait|times|ulimit|umask|history|fc|type|whence|which|where|rehash)
      return 0
      ;;
  esac

  # Deny path execution outright
  [[ "$cmd" == */* ]] && return 1

  # Resolve command path
  local resolved
  resolved="\\$(whence -p -- "\\$cmd" 2>/dev/null)" || return 1

  # Must live under HOME/bin exactly
  [[ "\\$resolved" == "$HOME/bin/"* ]] && return 0
  return 1
}

# ---- Block dangerous builtins ----
disable -r builtin command exec eval hash nohup setopt source unfunction functions alias unalias 2>/dev/null || true

# ---- Intercept every interactive command before execution ----
preexec() {
  local line="$1"
  local cmd="\${line%%[[:space:]]*}"

  # Empty / whitespace lines
  [[ -z "\\$cmd" ]] && return 0

  # Deny anything with slash in the command token (direct path execution)
  [[ "\\$cmd" == */* ]] && { print -r -- "Denied: direct path execution"; kill -KILL $$; }

  # Deny anything not allowed
  if ! is_allowed_cmd "\\$cmd"; then
    print -r -- "Denied: \\$cmd (not in \\$HOME/bin)"
    kill -KILL $$
  fi
}

# ---- Also intercept non-interactive \\\`zsh -c\\\` cases ----
TRAPDEBUG() {
  local line="\${ZSH_DEBUG_CMD:-$1}"
  local cmd="\${line%%[[:space:]]*}"
  [[ -z "\\$cmd" ]] && return 0

  [[ "\\$cmd" == */* ]] && { print -r -- "Denied: direct path execution"; return 126; }
  is_allowed_cmd "\\$cmd" || { print -r -- "Denied: \\$cmd"; return 126; }
  return 0
}

# ---- Ensure accessible working directory ----
cd "$HOME" 2>/dev/null || cd /
`;
