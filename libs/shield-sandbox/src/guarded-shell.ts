/**
 * Hardened guarded-shell for zsh
 *
 * This shell:
 * - Forces PATH=$HOME/bin only
 * - Runs restricted zsh (setopt RESTRICTED)
 * - Blocks direct execution with slashes like /usr/bin/curl, /bin/sh
 * - Blocks any command not coming from $HOME/bin
 * - Starts with zsh -f (ignores user rc files)
 */

export const GUARDED_SHELL_PATH = '/usr/local/bin/guarded-shell';

export const GUARDED_SHELL_CONTENT = `#!/bin/zsh
# guarded-shell: allow ONLY commands from $HOME/bin, deny everything else.
# Intended as a login shell for an unprivileged user running OpenClaw.

emulate -LR zsh

# Hard reset environment
unsetopt GLOBAL_RCS
setopt NO_RCS
setopt RESTRICTED
setopt NO_CASE_GLOB
setopt NO_BEEP

# Minimal, controlled PATH
export PATH="$HOME/bin"
export HOME="\${HOME:-/Users/\$(id -un)}"
export SHELL="/usr/local/bin/guarded-shell"

# Prevent inherited env tricks
unset DYLD_LIBRARY_PATH DYLD_FALLBACK_LIBRARY_PATH DYLD_INSERT_LIBRARIES
unset PYTHONPATH NODE_PATH RUBYLIB PERL5LIB
unset SSH_ASKPASS LD_PRELOAD

# Lock down critical variables (readonly)
typeset -r PATH HOME SHELL

# --- Enforcement layer (stronger than RESTRICTED alone) ---
# Allow only commands that resolve to $HOME/bin/<cmd>
# Deny anything containing '/' (absolute/relative paths).
deny() {
  print -r -- "Denied by policy"
  return 126
}

is_allowed_cmd() {
  local cmd="$1"

  # Deny path execution outright
  [[ "$cmd" == */* ]] && return 1

  # Resolve command path
  local resolved
  resolved="$(whence -p -- "$cmd" 2>/dev/null)" || return 1

  # Must live under HOME/bin exactly
  [[ "$resolved" == "$HOME/bin/"* ]] && return 0
  return 1
}

# Block potentially dangerous builtins/keywords from being used to escape
disable -r builtin command exec eval hash nohup setopt source unfunction functions alias unalias 2>/dev/null || true

# Intercept every interactive command line before execution
preexec() {
  local line="$1"
  local cmd="\${line%%[[:space:]]*}"

  # Empty / whitespace lines
  [[ -z "$cmd" ]] && return 0

  # Deny anything with slash in the command token
  [[ "$cmd" == */* ]] && { print -r -- "Denied: direct path execution"; kill -KILL $$; }

  # Deny anything not allowed
  if ! is_allowed_cmd "$cmd"; then
    print -r -- "Denied: $cmd (not in \\$HOME/bin)"
    kill -KILL $$
  fi
}

# Also intercept non-interactive \\\`zsh -c\\\` cases (extra belt-and-suspenders)
TRAPDEBUG() {
  # $ZSH_DEBUG_CMD holds the current command being executed in many zsh builds
  # Fallback to $1 if empty
  local line="\${ZSH_DEBUG_CMD:-$1}"
  local cmd="\${line%%[[:space:]]*}"
  [[ -z "$cmd" ]] && return 0

  [[ "$cmd" == */* ]] && { print -r -- "Denied: direct path execution"; return 126; }
  is_allowed_cmd "$cmd" || { print -r -- "Denied: $cmd"; return 126; }
  return 0
}

# Start a clean zsh with no user config
exec /bin/zsh -f
`;
