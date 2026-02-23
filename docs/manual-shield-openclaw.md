# Manual Shield Commands — OpenClaw

Run every shell command from `POST /targets/lifecycle/openclaw/shield` one-by-one
to debug failures. Commands are in execution order and grouped by phase.

---

## Variables

```bash
BASE_NAME="openclaw"
AGENT_USER="ash_openclaw_agent"
BROKER_USER="ash_openclaw_broker"
AGENT_UID=5200
BROKER_UID=5201
AGENT_GID=5100          # socket group GID
AGENT_HOME="/Users/ash_openclaw_agent"
GROUP="ash_openclaw"
GROUP_GID=5100
SOCKET_DIR="$AGENT_HOME/.agenshield/run"
SOCKET_PATH="$AGENT_HOME/.agenshield/run/agenshield.sock"
CONFIG_DIR="$AGENT_HOME/.agenshield/config"
SEATBELT_DIR="$AGENT_HOME/.agenshield/seatbelt"
LOG_DIR="$AGENT_HOME/.agenshield/logs"
HOST_USER="${SUDO_USER:-$(stat -f '%Su' /dev/console 2>/dev/null || logname 2>/dev/null || whoami)}"
HOST_HOME="/Users/$HOST_USER"
PROFILE_BASE="openclaw"          # used in per-target LaunchDaemon labels
SHARED_BIN="$HOST_HOME/.agenshield/bin"
SHARED_LIB="$HOST_HOME/.agenshield/lib"
GUARDED_SHELL_PATH="$AGENT_HOME/.agenshield/bin/guarded-shell"
ZDOT_DIR="$AGENT_HOME/.zdot"
```

## Prerequisites

- macOS with SIP enabled (seatbelt enforcement)
- Either the AgenShield privilege helper running, or a root shell (`sudo -i`)
- All commands below are shown as plain `sudo` — substitute your executor if needed

---

## Running Commands as the Agent User

The agent user's login shell is the **guarded shell**, which blocks most commands
— anything outside `$HOME/bin`, `$HOME/homebrew/bin`, `$HOME/.nvm` is denied by
the TRAPDEBUG enforcement hook.

> **Do NOT use `sudo su ash_openclaw_agent`** — it enters the guarded shell and
> commands like `ls`, `curl`, `bash`, etc. will be denied.

Instead, run commands as the agent user from a **root shell** with:

```bash
cd / && sudo -H -u ash_openclaw_agent bash -c '<command>'
```

The `cd /` is required because `sudo -H -u` inherits the calling shell's working
directory. In a root shell the CWD is typically `/var/root` — a directory the
agent user cannot access, causing `getcwd: cannot access parent directories:
Permission denied`. Changing to `/` first avoids this. This mirrors the daemon's
privilege helper which spawns with `cwd: '/'`.

This invokes `bash` directly, bypassing the guarded login shell entirely. This is
the same mechanism the daemon's `execAsUser` uses internally (via the root
privilege helper).

All "Runs as: ash_openclaw_agent" steps below are already formatted this way so
you can copy-paste them directly from a root shell. For root commands, just run
them directly — no wrapper needed.

---

## Phase 0 — Stale Default Cleanup

Best-effort removal of `ash_default_*` users/groups from previous installations.

### 0.1 Check if stale default agent user exists

```bash
# Runs as: root | Timeout: 5s
dscl . -read /Users/ash_default_agent 2>/dev/null
```

### 0.2 Kill processes and delete stale default users

```bash
# Runs as: root | Timeout: 15s (per user)
ps -u $(id -u ash_default_agent 2>/dev/null) -o pid= 2>/dev/null | xargs kill 2>/dev/null; sleep 1; dscl . -delete /Users/ash_default_agent 2>/dev/null; true
ps -u $(id -u ash_default_broker 2>/dev/null) -o pid= 2>/dev/null | xargs kill 2>/dev/null; sleep 1; dscl . -delete /Users/ash_default_broker 2>/dev/null; true
```

### 0.3 Delete stale default groups

```bash
# Runs as: root | Timeout: 5s (per group)
dscl . -delete /Groups/ash_default 2>/dev/null; true
```

### 0.4 Clean up stale default home, LaunchDaemons, sudoers

```bash
# Runs as: root | Timeout: 15s
rm -rf /Users/ash_default_agent 2>/dev/null; \
launchctl bootout system/com.agenshield.broker.default 2>/dev/null; \
rm -f /Library/LaunchDaemons/com.agenshield.broker.default.plist 2>/dev/null; \
rm -f /etc/sudoers.d/agenshield-default 2>/dev/null; \
true
```

### 0.5 Check if target users already exist

```bash
# Runs as: root | Timeout: 5s
dscl . -read /Users/ash_openclaw_agent UniqueID 2>/dev/null && echo "ash_openclaw_agent EXISTS" || echo "ash_openclaw_agent: not found"
dscl . -read /Users/ash_openclaw_broker UniqueID 2>/dev/null && echo "ash_openclaw_broker EXISTS" || echo "ash_openclaw_broker: not found"
dscl . -read /Groups/ash_openclaw PrimaryGroupID 2>/dev/null && echo "ash_openclaw group EXISTS" || echo "ash_openclaw group: not found"
```

> If ALL three print "not found", skip step 0.6 and go straight to Phase 1.
> If ANY print "EXISTS", run step 0.6 to tear down the previous installation first.

### 0.6 Full target teardown (only if 0.5 found existing artifacts)

```bash
# Runs as: root | Timeout: 30s
# Kill agent processes (PID-targeted, no pkill -f)
ps -u $(id -u ash_openclaw_agent 2>/dev/null) -o pid= 2>/dev/null | xargs kill 2>/dev/null; sleep 1
ps -u $(id -u ash_openclaw_agent 2>/dev/null) -o pid= 2>/dev/null | xargs kill -9 2>/dev/null
ps -u $(id -u ash_openclaw_broker 2>/dev/null) -o pid= 2>/dev/null | xargs kill 2>/dev/null; sleep 1
# Unload LaunchDaemons
launchctl bootout system/com.agenshield.$PROFILE_BASE.gateway 2>/dev/null; true
launchctl bootout system/com.agenshield.broker.openclaw 2>/dev/null; true
rm -f /Library/LaunchDaemons/com.agenshield.$PROFILE_BASE.gateway.plist 2>/dev/null
rm -f /Library/LaunchDaemons/com.agenshield.broker.openclaw.plist 2>/dev/null
# Remove per-target guarded-shell from /etc/shells
sed -i '' '\|/Users/ash_openclaw_agent/.agenshield/bin/guarded-shell|d' /etc/shells 2>/dev/null; true
# Delete users
dscl . -delete /Users/ash_openclaw_agent 2>/dev/null; true
dscl . -delete /Users/ash_openclaw_broker 2>/dev/null; true
# Delete groups
dscl . -delete /Groups/ash_openclaw 2>/dev/null; true
# Remove home directory (Library items may resist — that's fine)
rm -rf /Users/ash_openclaw_agent 2>/dev/null; true
# Remove system artifacts
rm -f /etc/sudoers.d/agenshield-openclaw 2>/dev/null
# Remove path router backup + registry entry
rm -f /usr/local/bin/.openclaw.agenshield-backup 2>/dev/null
rm -f "$HOST_HOME/.agenshield/path-registry.json" 2>/dev/null; true
```

---

## Phase 1 — Create Sandbox Groups

### 1.1 Create socket group

```bash
# Runs as: root | Timeout: 30s
dscl . -create /Groups/$GROUP && \
dscl . -create /Groups/$GROUP PrimaryGroupID $GROUP_GID && \
dscl . -create /Groups/$GROUP RealName "AgenShield socket group for $BASE_NAME" && \
dscl . -create /Groups/$GROUP Password "*"
```

---

## Phase 2 — Create Sandbox Users

### 2.1 Create agent user (full record)

```bash
# Runs as: root | Timeout: 30s
dscl . -create /Users/$AGENT_USER && \
dscl . -create /Users/$AGENT_USER UniqueID $AGENT_UID && \
dscl . -create /Users/$AGENT_USER PrimaryGroupID $AGENT_GID && \
dscl . -create /Users/$AGENT_USER UserShell $AGENT_HOME/.agenshield/bin/guarded-shell && \
dscl . -create /Users/$AGENT_USER NFSHomeDirectory $AGENT_HOME && \
dscl . -create /Users/$AGENT_USER RealName "AgenShield agent ($BASE_NAME)" && \
dscl . -create /Users/$AGENT_USER Password "*" && \
dseditgroup -o edit -a $AGENT_USER -t user $GROUP
```

### 2.2 Create broker user (full record)

```bash
# Runs as: root | Timeout: 30s
dscl . -create /Users/$BROKER_USER && \
dscl . -create /Users/$BROKER_USER UniqueID $BROKER_UID && \
dscl . -create /Users/$BROKER_USER PrimaryGroupID $AGENT_GID && \
dscl . -create /Users/$BROKER_USER UserShell /usr/bin/false && \
dscl . -create /Users/$BROKER_USER NFSHomeDirectory /var/empty && \
dscl . -create /Users/$BROKER_USER RealName "AgenShield broker ($BASE_NAME)" && \
dscl . -create /Users/$BROKER_USER Password "*" && \
dseditgroup -o edit -a $BROKER_USER -t user $GROUP
```

---

## Phase 3 — Create Directories

### 3.1 Create agent home and .agenshield directories

```bash
# Runs as: root | Timeout: 30s
mkdir -p "/Users/ash_openclaw_agent" "/Users/ash_openclaw_agent/bin" "/Users/ash_openclaw_agent/.config" && \
mkdir -p "$AGENT_HOME/.agenshield/config" && \
mkdir -p "$SHARED_BIN" "$SHARED_LIB" && \
mkdir -p "/Users/ash_openclaw_agent/.agenshield/seatbelt" "/Users/ash_openclaw_agent/.agenshield/bin" && \
mkdir -p "/Users/ash_openclaw_agent/.agenshield/run" "/Users/ash_openclaw_agent/.agenshield/logs" && \
chown -R ash_openclaw_agent:ash_openclaw "/Users/ash_openclaw_agent" 2>/dev/null || true && \
chmod 2775 "/Users/ash_openclaw_agent" && \
chown root:wheel "/Users/ash_openclaw_agent/.agenshield/seatbelt" && \
chown root:wheel "/Users/ash_openclaw_agent/.agenshield/bin" && \
chown ash_openclaw_broker:ash_openclaw "/Users/ash_openclaw_agent/.agenshield/logs" && \
chown ash_openclaw_broker:ash_openclaw "/Users/ash_openclaw_agent/.agenshield/run" && \
chmod 2770 "/Users/ash_openclaw_agent/.agenshield/run"
```

### 3.2 Write .agenshield/meta.json

```bash
# Runs as: root | Timeout: 15s
cat > "$AGENT_HOME/.agenshield/meta.json" << AGSMETA
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "version": "1.0",
  "username": "$AGENT_USER",
  "uid": $AGENT_UID
}
AGSMETA
```

### 3.3 Lock down .agenshield marker (root-owned)

```bash
# Runs as: root | Timeout: 15s
chown root:wheel "/Users/ash_openclaw_agent/.agenshield" && \
chmod 755 "/Users/ash_openclaw_agent/.agenshield" && \
chown root:wheel "/Users/ash_openclaw_agent/.agenshield/meta.json" && \
chmod 644 "/Users/ash_openclaw_agent/.agenshield/meta.json"
```

---

## Phase 4 — Install Guarded Shell

### 4.1 Write guarded-shell launcher (per-target)

```bash
# Runs as: root | Timeout: 15s
cat > "$AGENT_HOME/.agenshield/bin/guarded-shell" << 'GSHELL_EOF'
#!/bin/zsh
# guarded-shell: launcher for restricted agent shell.
# All restrictions live in ZDOTDIR files (root-owned, immutable to agent).
emulate -LR zsh

# Prevent inherited env tricks before handing off to zsh
unset DYLD_LIBRARY_PATH DYLD_FALLBACK_LIBRARY_PATH DYLD_INSERT_LIBRARIES
unset PYTHONPATH NODE_PATH RUBYLIB PERL5LIB
unset SSH_ASKPASS LD_PRELOAD

# Dynamically resolve the calling user's home for per-target ZDOTDIR
_ASH_HOME="$(dscl . -read /Users/$(id -un) NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
[ -z "$_ASH_HOME" ] && _ASH_HOME="/Users/$(id -un)"
unset HOME

# Per-target ZDOTDIR under agent home; fall back to shared /etc/agenshield/zdot
if [ -d "${_ASH_HOME}/.zdot" ]; then
  export ZDOTDIR="${_ASH_HOME}/.zdot"
else
  export ZDOTDIR="/etc/agenshield/zdot"
fi

# Start zsh — it will read ZDOTDIR/.zshenv then ZDOTDIR/.zshrc
exec /bin/zsh "$@"
GSHELL_EOF
```

### 4.2 Set ownership, permissions, register in /etc/shells

```bash
# Runs as: root | Timeout: 15s
chown root:wheel "$AGENT_HOME/.agenshield/bin/guarded-shell" && \
chmod 755 "$AGENT_HOME/.agenshield/bin/guarded-shell" && \
grep -qxF "$AGENT_HOME/.agenshield/bin/guarded-shell" /etc/shells || echo "$AGENT_HOME/.agenshield/bin/guarded-shell" >> /etc/shells
```

### 4.3 Create per-target ZDOTDIR directory

```bash
# Runs as: root | Timeout: 10s
mkdir -p "$AGENT_HOME/.zdot"
```

### 4.4 Write ZDOTDIR .zshenv

```bash
# Runs as: root | Timeout: 15s
cat > "$AGENT_HOME/.zdot/.zshenv" << 'ZSHENV_EOF'
# AgenShield restricted .zshenv
# Runs AFTER /etc/zshenv — overrides path_helper's full system PATH.

# ALWAYS set HOME based on actual user, never inherit
export HOME="/Users/$(id -un)"
export HISTFILE="$HOME/.zsh_history"

# Suppress locale to prevent /etc/zshrc from calling locale command
export LC_ALL=C LANG=C

export PATH="$HOME/bin:$HOME/homebrew/bin"
export SHELL="/Users/ash_openclaw_agent/.agenshield/bin/guarded-shell"

# Homebrew environment (agent-local prefix)
export HOMEBREW_PREFIX="$HOME/homebrew"
export HOMEBREW_CELLAR="$HOME/homebrew/Cellar"
export HOMEBREW_REPOSITORY="$HOME/homebrew"

# NVM initialization
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Clear any leftover env tricks
unset DYLD_LIBRARY_PATH DYLD_FALLBACK_LIBRARY_PATH DYLD_INSERT_LIBRARIES
unset PYTHONPATH NODE_PATH RUBYLIB PERL5LIB
unset SSH_ASKPASS LD_PRELOAD

# Skip system rc files (/etc/zprofile, /etc/zshrc, /etc/zlogin)
# They may call commands not in our restricted PATH (e.g. locale).
# ZDOTDIR files (.zshrc) are still read.
setopt NO_GLOBAL_RCS
ZSHENV_EOF
```

### 4.5 Write ZDOTDIR .zshrc

```bash
# Runs as: root | Timeout: 15s
cat > "$AGENT_HOME/.zdot/.zshrc" << 'ZSHRC_EOF'
# AgenShield restricted .zshrc
# Applied to every interactive shell for the agent user.

emulate -LR zsh

# Re-set HISTFILE (safety: ensure it points to agent's home, not ZDOTDIR)
HISTFILE="$HOME/.zsh_history"

# Re-set PATH (~/bin + ~/homebrew/bin — override anything that may have been added)
PATH="$HOME/bin:$HOME/homebrew/bin"

# Homebrew environment (agent-local prefix)
export HOMEBREW_PREFIX="$HOME/homebrew"
export HOMEBREW_CELLAR="$HOME/homebrew/Cellar"
export HOMEBREW_REPOSITORY="$HOME/homebrew"

# NVM re-source for interactive shell
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# ---- Shell options ----
# Note: NOT using setopt RESTRICTED as it disables cd entirely.
# Instead we use preexec hooks and builtin disable for enforcement.
setopt NO_CASE_GLOB
setopt NO_BEEP

# ---- Lock critical variables (readonly) ----
typeset -r PATH HOME SHELL HISTFILE NVM_DIR

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
    cd|pwd|echo|printf|test|true|false|exit|return|break|continue|shift|set|unset|export|typeset|local|declare|readonly|let|read|print|pushd|popd|dirs|jobs|fg|bg|kill|wait|times|ulimit|umask|history|fc|type|whence|which|where|rehash)
      return 0
      ;;
  esac

  # Deny path execution outright
  [[ "$cmd" == */* ]] && return 1

  # Resolve command path
  local resolved
  resolved="$(whence -p -- "$cmd" 2>/dev/null)" || return 1

  # Must live under HOME/bin, HOME/homebrew/bin, or HOME/.nvm
  [[ "$resolved" == "$HOME/bin/"* ]] && return 0
  [[ "$resolved" == "$HOME/homebrew/bin/"* ]] && return 0
  [[ "$resolved" == "$HOME/.nvm/"* ]] && return 0
  return 1
}

# ---- Block dangerous builtins ----
disable -r builtin command exec eval hash nohup setopt source unfunction functions alias unalias 2>/dev/null || true

# ---- Intercept every interactive command before execution ----
preexec() {
  # Enforcement handled by TRAPDEBUG (which can cancel execution via return 126).
  # preexec cannot prevent execution, so we don't enforce here.
  return 0
}

# ---- Also intercept non-interactive `zsh -c` cases ----
typeset -gi __ash_guard=0

TRAPDEBUG() {
  # Prevent recursion when our own checks invoke whence/is_allowed_cmd
  (( __ash_guard )) && return 0

  local line="${ZSH_DEBUG_CMD:-$1}"
  local cmd="${line%%[[:space:]]*}"
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

# ---- Ensure accessible working directory ----
cd "$HOME" 2>/dev/null || cd /
ZSHRC_EOF
```

### 4.6 Lock ZDOTDIR files (root-owned, 644)

```bash
# Runs as: root | Timeout: 15s
chown -R root:wheel "$AGENT_HOME/.zdot" && \
chmod 644 "$AGENT_HOME/.zdot/.zshenv" "$AGENT_HOME/.zdot/.zshrc"
```

### 4.7 Verify guarded shell installation

```bash
# Runs as: root | Timeout: 10s
# Expect: EXEC_OK, SHELLS_OK, and ls output showing -rwxr-xr-x root:wheel
test -x "$AGENT_HOME/.agenshield/bin/guarded-shell" && echo EXEC_OK || echo EXEC_FAIL; \
grep -qxF "$AGENT_HOME/.agenshield/bin/guarded-shell" /etc/shells && echo SHELLS_OK || echo SHELLS_FAIL; \
ls -la "$AGENT_HOME/.agenshield/bin/guarded-shell"
```

---

## Phase 5 — Install Command Wrappers

> Handled by `installPresetBinaries()`. Installs wrappers for:
> `node`, `npm`, `npx`, `git`, `curl`, `bash`, `shieldctl`
> Each wrapper is a small script in `$AGENT_HOME/bin/` that delegates
> to the real binary via the interceptor.

This step is code-driven (no single shell command to paste). The result is
wrapper scripts at `/Users/ash_openclaw_agent/bin/{node,npm,npx,git,curl,bash,shieldctl}`.

---

## Phase 6 — PATH Router Override

### 6.1 Create host-level registry directory

```bash
# Runs as: root | Timeout: 10s
mkdir -p "$HOST_HOME/.agenshield"
```

### 6.2 Write path registry

```bash
# Runs as: root | Timeout: 15s
cat > "$HOST_HOME/.agenshield/path-registry.json" << 'REGISTRY_EOF'
{
  "openclaw": {
    "originalBinary": "/usr/local/bin/openclaw",
    "instances": [
      {
        "targetId": "openclaw",
        "profileId": "openclaw-PROFILE_ID",
        "name": "OpenClaw",
        "agentBinPath": "/Users/ash_openclaw_agent/bin/openclaw",
        "baseName": "openclaw",
        "agentUsername": "ash_openclaw_agent"
      }
    ]
  }
}
REGISTRY_EOF
```

### 6.3 Set registry permissions

```bash
# Runs as: root | Timeout: 10s
chmod 644 "$HOST_HOME/.agenshield/path-registry.json"
```

### 6.4 Install router wrapper at /usr/local/bin/openclaw

```bash
# Runs as: root | Timeout: 15s
# This is the output of buildInstallRouterCommands("openclaw", <wrapper>)
mkdir -p /usr/local/bin
if [ -f "/usr/local/bin/openclaw" ] && ! grep -q "AGENSHIELD_ROUTER" "/usr/local/bin/openclaw" 2>/dev/null; then cp "/usr/local/bin/openclaw" "/usr/local/bin/.openclaw.agenshield-backup"; fi
cat > "/usr/local/bin/openclaw" << 'AGENSHIELD_WRAPPER_EOF'
#!/bin/bash
# AGENSHIELD_ROUTER — Do not edit. Managed by AgenShield.
# Router for: openclaw

REGISTRY="$HOME/.agenshield/path-registry.json"

if [ ! -f "$REGISTRY" ]; then
  echo "AgenShield: No registry found. No shielded instances configured." >&2
  exit 1
fi

# Read instances from registry
RESULT=$(python3 -c "
import sys, json
try:
    d = json.load(open('$REGISTRY'))
except:
    print('ERROR')
    sys.exit(0)
entry = d.get('openclaw', {})
instances = entry.get('instances', [])
orig = entry.get('originalBinary', '')
if len(instances) == 0:
    if orig:
        print('ORIG:' + orig)
    else:
        print('NONE')
elif len(instances) == 1:
    u = instances[0].get('agentUsername', '')
    print('EXEC:' + u + ':' + instances[0]['agentBinPath'])
else:
    for i, inst in enumerate(instances):
        u = inst.get('agentUsername', '')
        print(str(i+1) + ') ' + inst['name'] + ' [' + inst['baseName'] + ']|' + u + ':' + inst['agentBinPath'])
    print('CHOOSE')
" 2>/dev/null)

if [[ "$RESULT" == "ERROR" ]]; then
  echo "AgenShield: Failed to read registry." >&2
  exit 1
elif [[ "$RESULT" == ORIG:* ]]; then
  BIN="${RESULT#ORIG:}"
  exec "$BIN" "$@"
elif [[ "$RESULT" == EXEC:* ]]; then
  PAYLOAD="${RESULT#EXEC:}"
  AGENT_USER="${PAYLOAD%%:*}"
  BIN="${PAYLOAD#*:}"
  if [ -n "$AGENT_USER" ]; then
    exec sudo -H -u "$AGENT_USER" "$BIN" "$@"
  else
    exec "$BIN" "$@"
  fi
elif [[ "$RESULT" == "NONE" ]]; then
  echo "AgenShield: No shielded instances configured." >&2
  exit 1
elif [[ "$RESULT" == *"CHOOSE" ]]; then
  echo "AgenShield: Multiple shielded instances found:" >&2
  echo "$RESULT" | grep -v CHOOSE | sed 's/|.*//' >&2
  printf "Select instance (number): " >&2
  read -r CHOICE
  SELECTED=$(python3 -c "
import json, sys
try:
    d = json.load(open('$REGISTRY'))
    instances = d.get('openclaw', {}).get('instances', [])
    idx = int('$CHOICE') - 1
    if 0 <= idx < len(instances):
        u = instances[idx].get('agentUsername', '')
        print(u + ':' + instances[idx]['agentBinPath'])
except:
    pass
" 2>/dev/null)
  if [ -n "$SELECTED" ]; then
    AGENT_USER="${SELECTED%%:*}"
    BIN="${SELECTED#*:}"
    if [ -n "$AGENT_USER" ] && [ -n "$BIN" ]; then
      exec sudo -H -u "$AGENT_USER" "$BIN" "$@"
    fi
  fi
  echo "Invalid selection." >&2
  exit 1
fi
AGENSHIELD_WRAPPER_EOF
chmod 755 "/usr/local/bin/openclaw"
```

---

## Phase 7 — Install Target App (preset.install)

### 7.1 Install Homebrew — create directory

```bash
# Runs as: root | Timeout: 10s
mkdir -p "/Users/ash_openclaw_agent/homebrew" && \
chown ash_openclaw_agent:ash_openclaw "/Users/ash_openclaw_agent/homebrew"
```

### 7.2 Install Homebrew — download and extract

```bash
# Runs as: ash_openclaw_agent | Timeout: 120s
cd / && sudo -H -u ash_openclaw_agent bash -c 'cd "/Users/ash_openclaw_agent/homebrew" && curl -fsSL https://github.com/Homebrew/brew/tarball/master | tar xz --strip 1'
```

### 7.3 Install Homebrew — verify

```bash
# Runs as: ash_openclaw_agent | Timeout: 15s
cd / && sudo -H -u ash_openclaw_agent bash -c '"/Users/ash_openclaw_agent/homebrew/bin/brew" --version'
```

### 7.4 Install NVM

```bash
# Runs as: ash_openclaw_agent | Timeout: 60s
cd / && sudo -H -u ash_openclaw_agent bash -c 'export HOME="/Users/ash_openclaw_agent" && curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash'
```

### 7.5 Install Node.js v24 via NVM

```bash
# Runs as: ash_openclaw_agent | Timeout: 120s
cd / && sudo -H -u ash_openclaw_agent bash -c 'export HOME="/Users/ash_openclaw_agent" && export HOMEBREW_PREFIX="/Users/ash_openclaw_agent/homebrew" && export HOMEBREW_CELLAR="/Users/ash_openclaw_agent/homebrew/Cellar" && export HOMEBREW_REPOSITORY="/Users/ash_openclaw_agent/homebrew" && export PATH="/Users/ash_openclaw_agent/homebrew/bin:/Users/ash_openclaw_agent/homebrew/sbin:$PATH" && export NVM_DIR="/Users/ash_openclaw_agent/.nvm" && source "/Users/ash_openclaw_agent/.nvm/nvm.sh" && nvm install 24 && nvm alias default 24'
```

### 7.6 Verify Node.js

```bash
# Runs as: ash_openclaw_agent | Timeout: 15s
cd / && sudo -H -u ash_openclaw_agent bash -c 'export HOME="/Users/ash_openclaw_agent" && export HOMEBREW_PREFIX="/Users/ash_openclaw_agent/homebrew" && export HOMEBREW_CELLAR="/Users/ash_openclaw_agent/homebrew/Cellar" && export HOMEBREW_REPOSITORY="/Users/ash_openclaw_agent/homebrew" && export PATH="/Users/ash_openclaw_agent/homebrew/bin:/Users/ash_openclaw_agent/homebrew/sbin:$PATH" && export NVM_DIR="/Users/ash_openclaw_agent/.nvm" && source "/Users/ash_openclaw_agent/.nvm/nvm.sh" && node --version'
```

### 7.7 Copy node binary to shared bin + per-target

```bash
# Runs as: root | Timeout: 30s
NODE_PATH=$(cd / && sudo -H -u ash_openclaw_agent bash -c 'export HOME="/Users/ash_openclaw_agent" && export HOMEBREW_PREFIX="/Users/ash_openclaw_agent/homebrew" && export HOMEBREW_CELLAR="/Users/ash_openclaw_agent/homebrew/Cellar" && export HOMEBREW_REPOSITORY="/Users/ash_openclaw_agent/homebrew" && export PATH="/Users/ash_openclaw_agent/homebrew/bin:/Users/ash_openclaw_agent/homebrew/sbin:$PATH" && export NVM_DIR="/Users/ash_openclaw_agent/.nvm" && source "/Users/ash_openclaw_agent/.nvm/nvm.sh" && which node')
echo "Resolved node: $NODE_PATH"
# Per-target copy
mkdir -p "$AGENT_HOME/bin" && \
cp "$NODE_PATH" "$AGENT_HOME/bin/node-bin" && \
chgrp $GROUP "$AGENT_HOME/bin/node-bin" && \
chmod 750 "$AGENT_HOME/bin/node-bin"
# Shared host copy (broker uses this)
mkdir -p "$SHARED_BIN" && \
test -f "$SHARED_BIN/node-bin" || cp "$NODE_PATH" "$SHARED_BIN/node-bin" && \
chgrp wheel "$SHARED_BIN/node-bin" && \
chmod 755 "$SHARED_BIN/node-bin"
```

### 7.8 Clean stale brew locks

```bash
# Runs as: root | Timeout: 10s
ps -u $(id -u ash_openclaw_agent) -o pid,command 2>/dev/null | grep '[b]rew' | awk '{print $1}' | xargs kill 2>/dev/null; \
rm -rf "/Users/ash_openclaw_agent/homebrew/var/homebrew/locks" 2>/dev/null; \
true
```

### 7.9 Install OpenClaw via official installer

```bash
# Runs as: ash_openclaw_agent | Timeout: 600s (10 minutes)
cd / && sudo -H -u ash_openclaw_agent bash -c 'export HOME="/Users/ash_openclaw_agent" && export HOMEBREW_PREFIX="/Users/ash_openclaw_agent/homebrew" && export HOMEBREW_CELLAR="/Users/ash_openclaw_agent/homebrew/Cellar" && export HOMEBREW_REPOSITORY="/Users/ash_openclaw_agent/homebrew" && export PATH="/Users/ash_openclaw_agent/homebrew/bin:/Users/ash_openclaw_agent/homebrew/sbin:$PATH" && export NVM_DIR="/Users/ash_openclaw_agent/.nvm" && source "/Users/ash_openclaw_agent/.nvm/nvm.sh" && export BROWSER=none && curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard --no-prompt'
```

> To install a specific version, append `--version X.Y.Z` to the bash command.

### 7.10 Stop host OpenClaw processes

```bash
# Runs as: root | Timeout: 15s each
# Try graceful stop via OpenClaw CLI first
sudo -H -u "$HOST_USER" openclaw gateway stop 2>/dev/null || true
sudo -H -u "$HOST_USER" openclaw daemon stop 2>/dev/null || true
# Give processes time to exit, then targeted PID kill
sleep 2; ps -u $(id -u "$HOST_USER") -o pid,command 2>/dev/null | grep '[o]penclaw' | awk '{print $1}' | xargs kill 2>/dev/null; true
```

### 7.11 Copy host OpenClaw config

```bash
# Runs as: root | Timeout: 30s
if [ -d "/Users/$HOST_USER/.openclaw" ]; then
  cp -a "/Users/$HOST_USER/.openclaw" "/Users/ash_openclaw_agent/.openclaw"
  chown -R ash_openclaw_agent:ash_openclaw "/Users/ash_openclaw_agent/.openclaw"
  if [ -f "/Users/ash_openclaw_agent/.openclaw/openclaw.json" ]; then
    sed -i '' "s|/Users/$HOST_USER|/Users/ash_openclaw_agent|g" "/Users/ash_openclaw_agent/.openclaw/openclaw.json"
  fi
fi
```

### 7.12 Verify OpenClaw setup

```bash
# Runs as: ash_openclaw_agent | Timeout: 30s
cd / && sudo -H -u ash_openclaw_agent bash -c 'export HOME="/Users/ash_openclaw_agent" && export HOMEBREW_PREFIX="/Users/ash_openclaw_agent/homebrew" && export HOMEBREW_CELLAR="/Users/ash_openclaw_agent/homebrew/Cellar" && export HOMEBREW_REPOSITORY="/Users/ash_openclaw_agent/homebrew" && export PATH="/Users/ash_openclaw_agent/homebrew/bin:/Users/ash_openclaw_agent/homebrew/sbin:$PATH" && export NVM_DIR="/Users/ash_openclaw_agent/.nvm" && source "/Users/ash_openclaw_agent/.nvm/nvm.sh" && openclaw --version 2>/dev/null; true'
```

### 7.13 Patch NVM node — backup real binary

```bash
# Runs as: root | Timeout: 30s
NODE_BIN_PATH=$(cd / && sudo -H -u ash_openclaw_agent bash -c 'export HOME="/Users/ash_openclaw_agent" && export HOMEBREW_PREFIX="/Users/ash_openclaw_agent/homebrew" && export HOMEBREW_CELLAR="/Users/ash_openclaw_agent/homebrew/Cellar" && export HOMEBREW_REPOSITORY="/Users/ash_openclaw_agent/homebrew" && export PATH="/Users/ash_openclaw_agent/homebrew/bin:/Users/ash_openclaw_agent/homebrew/sbin:$PATH" && export NVM_DIR="/Users/ash_openclaw_agent/.nvm" && source "/Users/ash_openclaw_agent/.nvm/nvm.sh" && which node')
echo "Patching: $NODE_BIN_PATH"
cp "$NODE_BIN_PATH" "${NODE_BIN_PATH}.real" && \
chown ash_openclaw_agent:ash_openclaw "${NODE_BIN_PATH}.real" && \
chmod 755 "${NODE_BIN_PATH}.real"
```

### 7.14 Patch NVM node — write interceptor wrapper

```bash
# Runs as: root | Timeout: 15s
NODE_BIN_PATH=$(cd / && sudo -H -u ash_openclaw_agent bash -c 'export HOME="/Users/ash_openclaw_agent" && export HOMEBREW_PREFIX="/Users/ash_openclaw_agent/homebrew" && export HOMEBREW_CELLAR="/Users/ash_openclaw_agent/homebrew/Cellar" && export HOMEBREW_REPOSITORY="/Users/ash_openclaw_agent/homebrew" && export PATH="/Users/ash_openclaw_agent/homebrew/bin:/Users/ash_openclaw_agent/homebrew/sbin:$PATH" && export NVM_DIR="/Users/ash_openclaw_agent/.nvm" && source "/Users/ash_openclaw_agent/.nvm/nvm.sh" && which node')
cat > "$NODE_BIN_PATH" << NODEWRAPPER_EOF
#!/bin/bash
# AgenShield Node.js Interceptor Wrapper
export NODE_OPTIONS="--require $HOST_HOME/.agenshield/lib/interceptor/register.cjs \${NODE_OPTIONS:-}"
exec "${NODE_BIN_PATH}.real" "\$@"
NODEWRAPPER_EOF
```

> **Note:** The `exec` line in the wrapper uses the dynamically resolved path to `node.real`.

### 7.15 Patch NVM node — set permissions

```bash
# Runs as: root | Timeout: 15s
NODE_BIN_PATH=$(cd / && sudo -H -u ash_openclaw_agent bash -c 'export HOME="/Users/ash_openclaw_agent" && export HOMEBREW_PREFIX="/Users/ash_openclaw_agent/homebrew" && export HOMEBREW_CELLAR="/Users/ash_openclaw_agent/homebrew/Cellar" && export HOMEBREW_REPOSITORY="/Users/ash_openclaw_agent/homebrew" && export PATH="/Users/ash_openclaw_agent/homebrew/bin:/Users/ash_openclaw_agent/homebrew/sbin:$PATH" && export NVM_DIR="/Users/ash_openclaw_agent/.nvm" && source "/Users/ash_openclaw_agent/.nvm/nvm.sh" && which node')
chmod 755 "$NODE_BIN_PATH" && \
chown ash_openclaw_agent:ash_openclaw "$NODE_BIN_PATH"
```

### 7.16 Write gateway launcher script

```bash
# Runs as: root | Timeout: 10s
mkdir -p "/Users/ash_openclaw_agent/.agenshield/bin"
```

```bash
# Runs as: root | Timeout: 15s
cat > "/Users/ash_openclaw_agent/.agenshield/bin/gw-launcher.sh" << 'LAUNCHER_EOF'
#!/bin/bash
# OpenClaw Gateway Launcher — crash-guarded wrapper
# Tracks crashes, waits for broker socket, runs pre-flight checks.
# Exit 78 (EX_CONFIG) tells launchd that restarting won't help.

set -euo pipefail

CRASH_FILE="/tmp/agenshield-gw-crashes"
MAX_CRASHES=5
CRASH_WINDOW=300
SOCKET_PATH="${AGENSHIELD_SOCKET:-$HOME/.agenshield/run/agenshield.sock}"
NVM_SH="/Users/ash_openclaw_agent/.nvm/nvm.sh"

# -- Crash tracking ----------------------------------------------------
now=$(date +%s)
touch "$CRASH_FILE"
# Append current timestamp
echo "$now" >> "$CRASH_FILE"
# Keep only timestamps within the window
cutoff=$(( now - CRASH_WINDOW ))
awk -v c="$cutoff" '$1 >= c' "$CRASH_FILE" > "$CRASH_FILE.tmp" && mv "$CRASH_FILE.tmp" "$CRASH_FILE"
crash_count=$(wc -l < "$CRASH_FILE" | tr -d ' ')
if [ "$crash_count" -ge "$MAX_CRASHES" ]; then
  echo "FATAL: $crash_count crashes in ${CRASH_WINDOW}s — halting restart loop" >&2
  launchctl disable system/com.agenshield.$PROFILE_BASE.gateway 2>/dev/null || true
  exit 78
fi

# -- Pre-flight checks --------------------------------------------------
# Source NVM
if [ ! -s "$NVM_SH" ]; then
  echo "FATAL: nvm.sh not found at $NVM_SH" >&2
  exit 78
fi
source "$NVM_SH"

if ! command -v node >/dev/null 2>&1; then
  echo "FATAL: node not found in PATH after sourcing NVM" >&2
  exit 78
fi

if ! command -v openclaw >/dev/null 2>&1; then
  echo "FATAL: openclaw not found in PATH" >&2
  exit 78
fi

# -- Wait for broker socket ----------------------------------------------
SOCKET_WAIT=30
elapsed=0
while [ ! -S "$SOCKET_PATH" ] && [ "$elapsed" -lt "$SOCKET_WAIT" ]; do
  sleep 1
  elapsed=$(( elapsed + 1 ))
done

if [ ! -S "$SOCKET_PATH" ]; then
  echo "FATAL: broker socket not found at $SOCKET_PATH after ${SOCKET_WAIT}s" >&2
  exit 78
fi

# -- All checks passed — clear crash log and start gateway ---------------
rm -f "$CRASH_FILE"
exec openclaw gateway start
LAUNCHER_EOF
```

### 7.17 Set gateway launcher permissions

```bash
# Runs as: root | Timeout: 10s
chown root:wheel "/Users/ash_openclaw_agent/.agenshield/bin/gw-launcher.sh" && \
chmod 755 "/Users/ash_openclaw_agent/.agenshield/bin/gw-launcher.sh"
```

### 7.18 Create gateway log directory

```bash
# Runs as: root | Timeout: 10s
mkdir -p "/Users/ash_openclaw_agent/.agenshield/logs"
```

### 7.19 Write gateway LaunchDaemon plist

```bash
# Runs as: root | Timeout: 15s
cat > "/Library/LaunchDaemons/com.agenshield.$PROFILE_BASE.gateway.plist" << 'GATEWAYPLIST_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.agenshield.$PROFILE_BASE.gateway</string>
  <key>UserName</key>
  <string>ash_openclaw_agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/ash_openclaw_agent/.agenshield/bin/gw-launcher.sh</string>
  </array>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ExitTimeOut</key>
  <integer>20</integer>
  <key>HardResourceLimits</key>
  <dict>
    <key>NumberOfProcesses</key>
    <integer>256</integer>
    <key>NumberOfFiles</key>
    <integer>4096</integer>
  </dict>
  <key>SoftResourceLimits</key>
  <dict>
    <key>NumberOfFiles</key>
    <integer>4096</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/ash_openclaw_agent/.agenshield/logs/openclaw-gateway.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/ash_openclaw_agent/.agenshield/logs/openclaw-gateway.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>/Users/ash_openclaw_agent</string>
    <key>NVM_DIR</key>
    <string>/Users/ash_openclaw_agent/.nvm</string>
    <key>HOMEBREW_PREFIX</key>
    <string>/Users/ash_openclaw_agent/homebrew</string>
    <key>HOMEBREW_CELLAR</key>
    <string>/Users/ash_openclaw_agent/homebrew/Cellar</string>
    <key>AGENSHIELD_SOCKET</key>
    <string>/Users/ash_openclaw_agent/.agenshield/run/agenshield.sock</string>
  </dict>
</dict>
</plist>
GATEWAYPLIST_EOF
```

### 7.20 Set gateway plist permissions

```bash
# Runs as: root | Timeout: 10s
chmod 644 "/Library/LaunchDaemons/com.agenshield.$PROFILE_BASE.gateway.plist"
```

---

## Phase 8 — Generate Seatbelt Profile

### 8.1 Write seatbelt profile

```bash
# Runs as: root | Timeout: 15s
cat > "/Users/ash_openclaw_agent/.agenshield/seatbelt/agent.sb" << 'SEATBELT_EOF'
;;
;; AgenShield Agent Sandbox Profile
;;
;; HYBRID SECURITY MODEL:
;; - Seatbelt: Static deny rules for dangerous system paths (kernel-enforced)
;; - ACLs: Dynamic allow rules for fine-grained runtime control
;;

(version 1)
(deny default)

;; ========================================
;; CRITICAL DENIALS - Dangerous System Paths
;; (kernel-enforced, cannot be bypassed at runtime)
;; ========================================
;; System binaries - prevent reading/execution of system commands
(deny file-read*
  (subpath "/usr/bin")
  (subpath "/usr/sbin")
  (subpath "/sbin")
  (subpath "/bin"))

;; Allow reading the specific shell binaries we permit execution of
(allow file-read*
  (literal "/bin/sh")
  (literal "/bin/bash")
  (literal "/usr/bin/env"))

;; AgenShield config (ZDOTDIR, path-registry, seatbelt profiles)
(allow file-read*
  (subpath "/etc/agenshield")
  (subpath "/private/etc/agenshield"))

;; .agenshield directory (read-only to agent)
(allow file-read*
  (subpath "/Users/ash_openclaw_agent/.agenshield"))
(deny file-write*
  (subpath "/Users/ash_openclaw_agent/.agenshield"))

;; Sensitive system configuration
(deny file-read*
  (subpath "/etc")
  (subpath "/private/etc/sudoers")
  (subpath "/private/etc/sudoers.d")
  (subpath "/private/etc/ssh")
  (subpath "/private/etc/pam.d"))

;; System logs - prevent information disclosure
(deny file-read*
  (subpath "/var/log")
  (subpath "/private/var/log")
  (subpath "/Library/Logs"))

;; Root and admin directories
(deny file-read*
  (subpath "/private/var/root")
  (subpath "/Library/Admin"))

;; ========================================
;; CRITICAL DENIALS - Prevent agent from modifying
;; its own bin directory, skills, or system config
;; ========================================
(deny file-write* (subpath "/Users/ash_openclaw_agent/bin"))
(deny file-write* (subpath "/Users/ash_openclaw_agent/.openclaw"))
(deny file-write* (subpath "/opt/agenshield"))
(deny file-write* (subpath "/etc/agenshield"))

;; ========================================
;; System Libraries & Frameworks (Read-only)
;; Required for process execution
;; ========================================
(allow file-read*
  (subpath "/System")
  (subpath "/usr/lib")
  (subpath "/usr/share")
  (subpath "/Library/Frameworks")
  (subpath "/Library/Preferences")
  (subpath "/private/var/db"))

;; ========================================
;; Runtime Dependencies
;; ========================================
(allow file-read*
  (subpath "/usr/local/lib/node_modules")
  (subpath "/opt/homebrew/lib/node_modules")
  (subpath "/usr/local/Cellar")
  (subpath "/opt/homebrew/Cellar")
  (subpath "/usr/local/bin")
  (subpath "/opt/homebrew/bin")
  (subpath "/Library/Frameworks/Python.framework"))

;; ========================================
;; BROAD USER FILESYSTEM ACCESS
;; (ACLs will handle fine-grained runtime control)
;; ========================================
(allow file-read*
  (subpath "/Users")
  (subpath "/Volumes")
  (subpath "/android")
  (subpath "/opt"))

;; ========================================
;; Workspace (Read/Write)
;; ========================================
(allow file-read* file-write*
  (subpath "/Users/ash_openclaw_agent/workspace"))

;; Temp directories (Read/Write)
(allow file-read* file-write*
  (subpath "/tmp")
  (subpath "/private/tmp")
  (subpath "/var/folders"))

;; ========================================
;; Additional Read Paths
;; ========================================


;; ========================================
;; Binary Execution
;; ========================================
(allow process-exec
  (literal "/bin/sh")
  (literal "/bin/bash")
  (literal "/usr/bin/env")
  (subpath "/Users/ash_openclaw_agent/bin")
  (subpath "/opt/agenshield/bin")
  (subpath "/usr/local/bin")
  (subpath "/opt/homebrew/bin"))

;; ========================================
;; Unix Socket (Broker Communication)
;; ========================================
(allow network-outbound
  (local unix-socket "/Users/ash_openclaw_agent/.agenshield/run/agenshield.sock"))

;; ========================================
;; Network DENIAL (Critical)
;; ========================================
(deny network*)

;; ========================================
;; Process & Signal
;; ========================================
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)

;; ========================================
;; Mach IPC (Limited)
;; ========================================
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
  (global-name "com.apple.system.notification_center")
  (global-name "com.apple.CoreServices.coreservicesd")
  (global-name "com.apple.SecurityServer"))

;; ========================================
;; User Defaults
;; ========================================
(allow user-preference-read)
SEATBELT_EOF
```

---

## Phase 9 — Install Sudoers Rules

### 9.1 Write sudoers file and validate

```bash
# Runs as: root | Timeout: 15s
cat > "/etc/sudoers.d/agenshield-openclaw" << SUDOERS_EOF
# AgenShield — allows $HOST_USER to run commands as agent/broker without password
$HOST_USER ALL=(ash_openclaw_agent) NOPASSWD: ALL
$HOST_USER ALL=(ash_openclaw_broker) NOPASSWD: ALL
SUDOERS_EOF
chmod 440 "/etc/sudoers.d/agenshield-openclaw" && \
visudo -c -f "/etc/sudoers.d/agenshield-openclaw" 2>/dev/null || rm -f "/etc/sudoers.d/agenshield-openclaw"
```

---

## Phase 9b — Install Broker Binary

The broker plist references `$SHARED_BIN/agenshield-broker`. The automated
flow uses `copyBrokerBinary()` in `wrappers.ts`. For manual installs, build and
copy it:

### 9b.1 Build the broker

```bash
# Runs as: your user (from repo root) | Timeout: 120s
npx nx build shield-broker
```

### 9b.2 Copy broker binary to $SHARED_BIN

```bash
# Runs as: root | Timeout: 15s
BROKER_SRC="$(pwd)/libs/shield-broker/dist/main.js"
mkdir -p "$SHARED_BIN" && \
cp "$BROKER_SRC" "$SHARED_BIN/agenshield-broker" && \
chmod 755 "$SHARED_BIN/agenshield-broker" && \
chown root:$GROUP "$SHARED_BIN/agenshield-broker"
```

### 9b.3 Create ESM package.json

```bash
# Runs as: root | Timeout: 5s
cat > "$HOST_HOME/.agenshield/package.json" << 'EOF'
{"type":"module"}
EOF
chown root:wheel "$HOST_HOME/.agenshield/package.json"
```

---

## Phase 10 — Install Broker LaunchDaemon

### 10.1 Write broker plist, set permissions, and load

```bash
# Runs as: root | Timeout: 15s
cat > "/Library/LaunchDaemons/com.agenshield.broker.openclaw.plist" << 'PLIST_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agenshield.broker.openclaw</string>

    <key>AssociatedBundleIdentifiers</key>
    <array>
        <string>com.frontegg.AgenShieldES</string>
    </array>

    <key>ProgramArguments</key>
    <array>
        <string>$SHARED_BIN/node-bin</string>
        <string>$SHARED_BIN/agenshield-broker</string>
    </array>

    <key>UserName</key>
    <string>ash_openclaw_broker</string>

    <key>GroupName</key>
    <string>ash_openclaw</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>/Users/ash_openclaw_agent/.agenshield/logs/broker.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/ash_openclaw_agent/.agenshield/logs/broker.error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>AGENSHIELD_CONFIG</key>
        <string>$AGENT_HOME/.agenshield/config/shield.json</string>
        <key>AGENSHIELD_SOCKET</key>
        <string>/Users/ash_openclaw_agent/.agenshield/run/agenshield.sock</string>
        <key>AGENSHIELD_AGENT_HOME</key>
        <string>/Users/ash_openclaw_agent</string>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>AGENSHIELD_HOST_HOME</key>
        <string>$HOST_HOME</string>
        <key>AGENSHIELD_AUDIT_LOG</key>
        <string>$AGENT_HOME/.agenshield/logs/audit.log</string>
        <key>AGENSHIELD_POLICIES</key>
        <string>$AGENT_HOME/.agenshield/policies</string>
    </dict>

    <key>WorkingDirectory</key>
    <string>$HOST_HOME/.agenshield</string>

    <key>SoftResourceLimits</key>
    <dict>
        <key>NumberOfFiles</key>
        <integer>4096</integer>
    </dict>
</dict>
</plist>
PLIST_EOF
chmod 644 "/Library/LaunchDaemons/com.agenshield.broker.openclaw.plist"
launchctl load "/Library/LaunchDaemons/com.agenshield.broker.openclaw.plist" 2>/dev/null; true
```

---

## Phase 11 — Wait for Broker Socket

### 11.1 Poll for broker socket (30s timeout)

```bash
# Runs as: root | Timeout: 5s per poll, 30s total
# Run in a loop manually:
for i in $(seq 1 60); do
  test -S "/Users/ash_openclaw_agent/.agenshield/run/agenshield.sock" && echo "READY" && break
  echo "WAITING ($i)..."
  sleep 0.5
done
```

### 11.2 Broker diagnostics (if socket not ready)

```bash
# Runs as: root | Timeout: 10s
launchctl list | grep com.agenshield.broker 2>/dev/null || echo "NO_BROKER_IN_LAUNCHCTL"; \
tail -20 /Users/ash_openclaw_agent/.agenshield/logs/broker.error.log 2>/dev/null || echo "NO_BROKER_LOG"
```

---

## Phase 12 — Gateway Pre-flight

### 12.1 Run gateway pre-flight checks

```bash
# Runs as: root | Timeout: 30s
NVM_SH="/Users/ash_openclaw_agent/.nvm/nvm.sh"
LAUNCHER="/Users/ash_openclaw_agent/.agenshield/bin/gw-launcher.sh"

sudo -H -u ash_openclaw_agent bash -c "source $NVM_SH 2>/dev/null && command -v openclaw" && echo OPENCLAW_OK || echo OPENCLAW_FAIL; \
sudo -H -u ash_openclaw_agent bash -c "source $NVM_SH 2>/dev/null && command -v node" && echo NODE_OK || echo NODE_FAIL; \
test -s "$NVM_SH" && echo NVM_OK || echo NVM_FAIL; \
test -x "$LAUNCHER" && echo LAUNCHER_OK || echo LAUNCHER_FAIL
```

> All four checks must print `*_OK`. If any prints `*_FAIL`, the gateway will not start.

---

## Phase 13 — Start Gateway

### 13.1 Load and kickstart gateway LaunchDaemon

```bash
# Runs as: root | Timeout: 15s
launchctl load "/Library/LaunchDaemons/com.agenshield.$PROFILE_BASE.gateway.plist" 2>/dev/null && \
launchctl kickstart system/com.agenshield.$PROFILE_BASE.gateway 2>/dev/null; \
true
```

---

## Phase 14 — Save Profile & Seed Policies

These steps are database operations (SQLite via the daemon) and cannot be
replicated via shell commands. They create:

- A profile record in the `profiles` table
- Seeded security policies from the `openclaw` policy preset

---

## Quick Verification

After all phases complete, verify the installation:

```bash
# Check users exist
dscl . -read /Users/ash_openclaw_agent UniqueID
dscl . -read /Users/ash_openclaw_broker UniqueID

# Check groups
dscl . -read /Groups/ash_openclaw PrimaryGroupID

# Check directories
ls -la /Users/ash_openclaw_agent/
ls -la /Users/ash_openclaw_agent/.agenshield/run/
ls -la /Users/ash_openclaw_agent/.agenshield/seatbelt/agent.sb

# Check LaunchDaemons
launchctl list | grep com.agenshield

# Check broker socket
test -S /Users/ash_openclaw_agent/.agenshield/run/agenshield.sock && echo "Broker socket OK" || echo "Broker socket MISSING"

# Check sudoers
visudo -c -f /etc/sudoers.d/agenshield-openclaw

# Check guarded shell (per-target)
test -x /Users/ash_openclaw_agent/.agenshield/bin/guarded-shell && echo "Guarded shell OK"
grep -c guarded-shell /etc/shells

# Check gateway launcher
test -x /Users/ash_openclaw_agent/.agenshield/bin/gw-launcher.sh && echo "Launcher OK"

# Check PATH router
head -3 /usr/local/bin/openclaw
cat "$HOST_HOME/.agenshield/path-registry.json"
```
