# Manual Shield Commands — Claude Code

Run every shell command from `POST /targets/lifecycle/claudecode/shield` one-by-one
to debug failures. Commands are in execution order and grouped by phase.

Unlike OpenClaw, Claude Code runs interactively — there is no gateway daemon,
no NVM, and no Homebrew. The installer is a single `curl` command and the binary
lands at `{AGENT_HOME}/.claude/local/bin/claude`.

---

## Variables

```bash
BASE_NAME="claudecode"
AGENT_USER="ash_claudecode_agent"
BROKER_USER="ash_claudecode_broker"
AGENT_UID=5210
BROKER_UID=5211
AGENT_GID=5110
AGENT_HOME="/Users/ash_claudecode_agent"
GROUP="ash_claudecode"
GROUP_GID=5110
SOCKET_DIR="$AGENT_HOME/.agenshield/run"
SOCKET_PATH="$AGENT_HOME/.agenshield/run/agenshield.sock"
HOST_USER="${SUDO_USER:-$(stat -f '%Su' /dev/console 2>/dev/null || logname 2>/dev/null || whoami)}"
HOST_HOME="/Users/$HOST_USER"
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
— anything outside `$HOME/bin` is denied by the TRAPDEBUG enforcement hook.

> **Do NOT use `sudo su ash_claudecode_agent`** — it enters the guarded shell and
> commands like `ls`, `curl`, `bash`, etc. will be denied.

Instead, run commands as the agent user from a **root shell** with:

```bash
cd / && sudo -H -u ash_claudecode_agent bash -c '<command>'
```

The `cd /` is required because `sudo -H -u` inherits the calling shell's working
directory. In a root shell the CWD is typically `/var/root` — a directory the
agent user cannot access, causing `getcwd: cannot access parent directories:
Permission denied`. Changing to `/` first avoids this. This mirrors the daemon's
privilege helper which spawns with `cwd: '/'`.

This invokes `bash` directly, bypassing the guarded login shell entirely. This is
the same mechanism the daemon's `execAsUser` uses internally (via the root
privilege helper).

All "Runs as: ash_claudecode_agent" steps below are already formatted this way so
you can copy-paste them directly from a root shell. For root commands, just run
them directly — no wrapper needed.

---

## Phase 0 — Stale Default Cleanup + Target Teardown

Best-effort removal of `ash_default_*` users/groups from previous installations,
followed by teardown of any existing `ash_claudecode_*` artifacts.

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
dscl . -read /Users/ash_claudecode_agent UniqueID 2>/dev/null && echo "ash_claudecode_agent EXISTS" || echo "ash_claudecode_agent: not found"
dscl . -read /Users/ash_claudecode_broker UniqueID 2>/dev/null && echo "ash_claudecode_broker EXISTS" || echo "ash_claudecode_broker: not found"
dscl . -read /Groups/ash_claudecode PrimaryGroupID 2>/dev/null && echo "ash_claudecode group EXISTS" || echo "ash_claudecode group: not found"
```

> If ALL three print "not found", skip step 0.6 and go straight to Phase 1.
> If ANY print "EXISTS", run step 0.6 to tear down the previous installation first.

### 0.6 Full target teardown (only if 0.5 found existing artifacts)

```bash
# Runs as: root | Timeout: 30s
# Kill agent processes (PID-targeted, no pkill -f)
ps -u $(id -u ash_claudecode_agent 2>/dev/null) -o pid= 2>/dev/null | xargs kill 2>/dev/null; sleep 1
ps -u $(id -u ash_claudecode_agent 2>/dev/null) -o pid= 2>/dev/null | xargs kill -9 2>/dev/null
ps -u $(id -u ash_claudecode_broker 2>/dev/null) -o pid= 2>/dev/null | xargs kill 2>/dev/null; sleep 1
# Unload LaunchDaemons (no gateway for Claude Code)
launchctl bootout system/com.agenshield.broker.claudecode 2>/dev/null; true
rm -f /Library/LaunchDaemons/com.agenshield.broker.claudecode.plist 2>/dev/null
# Remove per-target guarded-shell from /etc/shells
sed -i '' '\|/Users/ash_claudecode_agent/.agenshield/bin/guarded-shell|d' /etc/shells 2>/dev/null; true
# Delete users
dscl . -delete /Users/ash_claudecode_agent 2>/dev/null; true
dscl . -delete /Users/ash_claudecode_broker 2>/dev/null; true
# Delete groups
dscl . -delete /Groups/ash_claudecode 2>/dev/null; true
# Remove home directory (Library items may resist — that's fine)
rm -rf /Users/ash_claudecode_agent 2>/dev/null; true
# Remove system artifacts
rm -f /etc/sudoers.d/agenshield-claudecode 2>/dev/null
# Remove path router backup + registry entry
rm -f /usr/local/bin/.claude.agenshield-backup 2>/dev/null
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

### 3.1 Create agent home, bin, and system directories

```bash
# Runs as: root | Timeout: 30s
mkdir -p "/Users/ash_claudecode_agent" "/Users/ash_claudecode_agent/bin" "/Users/ash_claudecode_agent/.config" && \
mkdir -p "$AGENT_HOME/.agenshield/config" "$SHARED_BIN" "$SHARED_LIB" && \
mkdir -p "$HOST_HOME/.agenshield" && \
chown -R ash_claudecode_agent:ash_claudecode "/Users/ash_claudecode_agent" 2>/dev/null || true && \
chmod 755 "/Users/ash_claudecode_agent"
```

### 3.2 Create .agenshield subdirectories

```bash
# Runs as: root | Timeout: 15s
mkdir -p "/Users/ash_claudecode_agent/.agenshield" && \
mkdir -p "/Users/ash_claudecode_agent/.agenshield/seatbelt" && \
mkdir -p "/Users/ash_claudecode_agent/.agenshield/seatbelt/ops" && \
mkdir -p "/Users/ash_claudecode_agent/.agenshield/bin" && \
mkdir -p "/Users/ash_claudecode_agent/.agenshield/logs" && \
mkdir -p "/Users/ash_claudecode_agent/.agenshield/run"
```

### 3.3 Set .agenshield directory ownership and permissions

```bash
# Runs as: root | Timeout: 15s
# Root-owned directories (immutable to agent)
chown root:wheel "/Users/ash_claudecode_agent/.agenshield" && \
chmod 755 "/Users/ash_claudecode_agent/.agenshield" && \
chown root:wheel "/Users/ash_claudecode_agent/.agenshield/seatbelt" && \
chmod 755 "/Users/ash_claudecode_agent/.agenshield/seatbelt" && \
chown root:wheel "/Users/ash_claudecode_agent/.agenshield/seatbelt/ops" && \
chmod 755 "/Users/ash_claudecode_agent/.agenshield/seatbelt/ops" && \
chown root:wheel "/Users/ash_claudecode_agent/.agenshield/bin" && \
chmod 755 "/Users/ash_claudecode_agent/.agenshield/bin" && \
# Broker-owned directories
chown ash_claudecode_broker:ash_claudecode "/Users/ash_claudecode_agent/.agenshield/logs" && \
chmod 755 "/Users/ash_claudecode_agent/.agenshield/logs" && \
chown ash_claudecode_broker:ash_claudecode "/Users/ash_claudecode_agent/.agenshield/run" && \
chmod 2770 "/Users/ash_claudecode_agent/.agenshield/run"
```

### 3.4 Write .agenshield/meta.json

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
chown root:wheel "/Users/ash_claudecode_agent/.agenshield/meta.json" && \
chmod 644 "/Users/ash_claudecode_agent/.agenshield/meta.json"
```

### 3.5 Create workspace directory

```bash
# Runs as: root | Timeout: 10s
mkdir -p "/Users/ash_claudecode_agent/workspace" && \
chown ash_claudecode_agent:ash_claudecode "/Users/ash_claudecode_agent/workspace" && \
chmod 2775 "/Users/ash_claudecode_agent/workspace"
```

---

## Phase 4 — Install Guarded Shell + ZDOTDIR

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
mkdir -p "/Users/ash_claudecode_agent/.zdot"
```

### 4.4 Write ZDOTDIR .zshenv

```bash
# Runs as: root | Timeout: 15s
cat > "/Users/ash_claudecode_agent/.zdot/.zshenv" << 'ZSHENV_EOF'
# AgenShield restricted .zshenv
# Runs AFTER /etc/zshenv — overrides path_helper's full system PATH.

# ALWAYS set HOME based on actual user, never inherit
export HOME="/Users/$(id -un)"
export HISTFILE="$HOME/.zsh_history"

# Suppress locale to prevent /etc/zshrc from calling locale command
export LC_ALL=C LANG=C

export PATH="$HOME/bin"
export SHELL="/Users/ash_claudecode_agent/.agenshield/bin/guarded-shell"

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

> **Note:** Unlike OpenClaw, the Claude Code ZDOTDIR omits Homebrew and NVM setup
> because Claude Code does not require them. PATH contains only `$HOME/bin`.

### 4.5 Write ZDOTDIR .zshrc

```bash
# Runs as: root | Timeout: 15s
cat > "/Users/ash_claudecode_agent/.zdot/.zshrc" << 'ZSHRC_EOF'
# AgenShield restricted .zshrc
# Applied to every interactive shell for the agent user.

emulate -LR zsh

# Re-set HISTFILE (safety: ensure it points to agent's home, not ZDOTDIR)
HISTFILE="$HOME/.zsh_history"

# Re-set PATH (~/bin only — override anything that may have been added)
PATH="$HOME/bin"

# ---- Shell options ----
# Note: NOT using setopt RESTRICTED as it disables cd entirely.
# Instead we use preexec hooks and builtin disable for enforcement.
setopt NO_CASE_GLOB
setopt NO_BEEP

# ---- Lock critical variables (readonly) ----
typeset -r PATH HOME SHELL HISTFILE

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

  # Must live under HOME/bin
  [[ "$resolved" == "$HOME/bin/"* ]] && return 0
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
chown -R root:wheel "/Users/ash_claudecode_agent/.zdot" && \
chmod 644 "/Users/ash_claudecode_agent/.zdot/.zshenv" "/Users/ash_claudecode_agent/.zdot/.zshrc"
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

> Handled by `installPresetBinaries()`. Installs wrappers for the required and
> optional binaries defined by the `claudecode` preset.
>
> **Required:** `node`, `npm`, `git`, `bash`
> **Optional:** `npx`, `curl`, `python3`, `pip`, `brew`, `ssh`
>
> Each wrapper is a small script in `$AGENT_HOME/bin/` that delegates
> to the real binary via the interceptor.

This step is code-driven (no single shell command to paste). The result is
wrapper scripts at `/Users/ash_claudecode_agent/bin/{node,npm,git,bash,...}`.

```bash
# Verify wrappers were created:
ls -la /Users/ash_claudecode_agent/bin/
```

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
  "claude": {
    "originalBinary": "/usr/local/bin/claude",
    "instances": [
      {
        "targetId": "claudecode",
        "profileId": "claudecode-PROFILE_ID",
        "name": "Claude Code",
        "agentBinPath": "/Users/ash_claudecode_agent/bin/claude",
        "baseName": "claude",
        "agentUsername": "ash_claudecode_agent"
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

### 6.4 Install router wrapper at /usr/local/bin/claude

```bash
# Runs as: root | Timeout: 15s
# This is the output of buildInstallRouterCommands("claude", <wrapper>)
mkdir -p /usr/local/bin
if [ -f "/usr/local/bin/claude" ] && ! grep -q "AGENSHIELD_ROUTER" "/usr/local/bin/claude" 2>/dev/null; then cp "/usr/local/bin/claude" "/usr/local/bin/.claude.agenshield-backup"; fi
cat > "/usr/local/bin/claude" << 'AGENSHIELD_WRAPPER_EOF'
#!/bin/bash
# AGENSHIELD_ROUTER — Do not edit. Managed by AgenShield.
# Router for: claude

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
entry = d.get('claude', {})
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
    instances = d.get('claude', {}).get('instances', [])
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
chmod 755 "/usr/local/bin/claude"
```

---

## Phase 7 — Install Claude Code

Claude Code installation is simpler than OpenClaw — a single `curl` installer
that downloads the binary. No Homebrew, NVM, or Node.js installation needed.

### 7.1 Install Claude Code via official installer

```bash
# Runs as: ash_claudecode_agent | Timeout: 180s
cd / && sudo -H -u ash_claudecode_agent bash -c 'export HOME="/Users/ash_claudecode_agent" && curl -fsSL https://claude.ai/install.sh | bash'
```

### 7.2 Verify Claude Code binary

```bash
# Runs as: ash_claudecode_agent | Timeout: 15s
cd / && sudo -H -u ash_claudecode_agent bash -c 'export HOME="/Users/ash_claudecode_agent" && export PATH="/Users/ash_claudecode_agent/.claude/local/bin:$PATH" && claude --version'
```

### 7.3 Stop host Claude Code processes

```bash
# Runs as: root | Timeout: 15s
ps -u $(id -u "$HOST_USER") -o pid,command 2>/dev/null | grep -E '[c]laude' | awk '{print $1}' | xargs kill 2>/dev/null; true
```

### 7.4 Copy host Claude Code config

```bash
# Runs as: root | Timeout: 30s
if [ -d "/Users/$HOST_USER/.claude" ]; then
  # Copy config files but preserve the agent's own binaries
  for item in "/Users/$HOST_USER/.claude"/*; do
    base=$(basename "$item")
    # Skip local/bin and downloads dirs (agent has its own)
    if [ "$base" = "local" ] || [ "$base" = "downloads" ]; then continue; fi
    cp -a "$item" "/Users/ash_claudecode_agent/.claude/$base" 2>/dev/null || true
  done
  chown -R ash_claudecode_agent:ash_claudecode "/Users/ash_claudecode_agent/.claude"
  # Rewrite paths in config files
  find "/Users/ash_claudecode_agent/.claude" -name "*.json" -exec sed -i '' "s|/Users/$HOST_USER|/Users/ash_claudecode_agent|g" {} + 2>/dev/null || true
fi
```

### 7.5 Verify Claude Code setup

```bash
# Runs as: ash_claudecode_agent | Timeout: 15s
cd / && sudo -H -u ash_claudecode_agent bash -c 'export HOME="/Users/ash_claudecode_agent" && export PATH="/Users/ash_claudecode_agent/.claude/local/bin:$PATH" && claude --version 2>/dev/null; true'
```

---

## Phase 8 — Generate Seatbelt Profile

### 8.1 Write seatbelt profile

```bash
# Runs as: root | Timeout: 15s
cat > "/Users/ash_claudecode_agent/.agenshield/seatbelt/agent.sb" << 'SEATBELT_EOF'
;;
;; AgenShield Agent Sandbox Profile — Claude Code
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

;; Per-target .agenshield directory (seatbelt profiles, socket, logs)
(allow file-read* (subpath "/Users/ash_claudecode_agent/.agenshield"))

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
;; its own bin directory, config, or system files
;; ========================================
(deny file-write* (subpath "/Users/ash_claudecode_agent/bin"))
(deny file-write* (subpath "/Users/ash_claudecode_agent/.claude"))
(deny file-write* (subpath "/Users/ash_claudecode_agent/.zdot"))
(deny file-write* (subpath "/Users/ash_claudecode_agent/.agenshield"))
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
  (subpath "/Users/ash_claudecode_agent/workspace"))

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
  (subpath "/Users/ash_claudecode_agent/bin")
  (subpath "/opt/agenshield/bin")
  (subpath "/usr/local/bin")
  (subpath "/opt/homebrew/bin"))

;; ========================================
;; Unix Socket (Broker Communication)
;; ========================================
(allow network-outbound
  (local unix-socket "/Users/ash_claudecode_agent/.agenshield/run/agenshield.sock"))

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

### 8.2 Set seatbelt profile permissions

```bash
# Runs as: root | Timeout: 10s
chown root:wheel "/Users/ash_claudecode_agent/.agenshield/seatbelt/agent.sb" && \
chmod 644 "/Users/ash_claudecode_agent/.agenshield/seatbelt/agent.sb"
```

---

## Phase 9 — Install Sudoers Rules

### 9.1 Write sudoers file and validate

```bash
# Runs as: root | Timeout: 15s
cat > "/etc/sudoers.d/agenshield-claudecode" << SUDOERS_EOF
# AgenShield — allows $HOST_USER to run commands as agent/broker without password
$HOST_USER ALL=(ash_claudecode_agent) NOPASSWD: ALL
$HOST_USER ALL=(ash_claudecode_broker) NOPASSWD: ALL
SUDOERS_EOF
chmod 440 "/etc/sudoers.d/agenshield-claudecode" && \
visudo -c -f "/etc/sudoers.d/agenshield-claudecode" 2>/dev/null || rm -f "/etc/sudoers.d/agenshield-claudecode"
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
cat > "/Library/LaunchDaemons/com.agenshield.broker.claudecode.plist" << 'PLIST_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agenshield.broker.claudecode</string>

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
    <string>ash_claudecode_broker</string>

    <key>GroupName</key>
    <string>ash_claudecode</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>/Users/ash_claudecode_agent/.agenshield/logs/broker.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/ash_claudecode_agent/.agenshield/logs/broker.error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>AGENSHIELD_CONFIG</key>
        <string>$AGENT_HOME/.agenshield/config/shield.json</string>
        <key>AGENSHIELD_SOCKET</key>
        <string>/Users/ash_claudecode_agent/.agenshield/run/agenshield.sock</string>
        <key>AGENSHIELD_AGENT_HOME</key>
        <string>/Users/ash_claudecode_agent</string>
        <key>AGENSHIELD_LOG_DIR</key>
        <string>/Users/ash_claudecode_agent/.agenshield/logs</string>
        <key>AGENSHIELD_HOST_HOME</key>
        <string>$HOST_HOME</string>
        <key>AGENSHIELD_AUDIT_LOG</key>
        <string>$AGENT_HOME/.agenshield/logs/audit.log</string>
        <key>AGENSHIELD_POLICIES</key>
        <string>$AGENT_HOME/.agenshield/policies</string>
        <key>NODE_ENV</key>
        <string>production</string>
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
chmod 644 "/Library/LaunchDaemons/com.agenshield.broker.claudecode.plist"
launchctl load "/Library/LaunchDaemons/com.agenshield.broker.claudecode.plist" 2>/dev/null; true
```

---

## Phase 11 — Wait for Broker Socket

### 11.1 Poll for broker socket (30s timeout)

```bash
# Runs as: root | Timeout: 5s per poll, 30s total
# Run in a loop manually:
for i in $(seq 1 60); do
  test -S "/Users/ash_claudecode_agent/.agenshield/run/agenshield.sock" && echo "READY" && break
  echo "WAITING ($i)..."
  sleep 0.5
done
```

### 11.2 Broker diagnostics (if socket not ready)

```bash
# Runs as: root | Timeout: 10s
launchctl list | grep com.agenshield.broker 2>/dev/null || echo "NO_BROKER_IN_LAUNCHCTL"; \
tail -20 /Users/ash_claudecode_agent/.agenshield/logs/broker.error.log 2>/dev/null || echo "NO_BROKER_LOG"
```

---

## Phase 12 — Save Profile & Seed Policies

These steps are database operations (SQLite via the daemon) and cannot be
replicated via shell commands. They create:

- A profile record in the `profiles` table
- Seeded security policies from the `claudecode` policy preset

---

## Quick Verification

After all phases complete, verify the installation:

```bash
# Check users exist
dscl . -read /Users/ash_claudecode_agent UniqueID
dscl . -read /Users/ash_claudecode_broker UniqueID

# Check groups
dscl . -read /Groups/ash_claudecode PrimaryGroupID

# Check directories
ls -la /Users/ash_claudecode_agent/
ls -la /Users/ash_claudecode_agent/.agenshield/
ls -la /Users/ash_claudecode_agent/.agenshield/run/
ls -la /Users/ash_claudecode_agent/.agenshield/seatbelt/agent.sb
ls -la /Users/ash_claudecode_agent/.agenshield/logs/

# Check Claude Code binary
cd / && sudo -H -u ash_claudecode_agent bash -c 'export HOME="/Users/ash_claudecode_agent" && export PATH="/Users/ash_claudecode_agent/.claude/local/bin:$PATH" && claude --version'

# Check LaunchDaemons (no gateway for Claude Code)
launchctl list | grep com.agenshield

# Check broker socket
test -S /Users/ash_claudecode_agent/.agenshield/run/agenshield.sock && echo "Broker socket OK" || echo "Broker socket MISSING"

# Check sudoers
visudo -c -f /etc/sudoers.d/agenshield-claudecode

# Check guarded shell (per-target)
test -x /Users/ash_claudecode_agent/.agenshield/bin/guarded-shell && echo "Guarded shell OK"
grep -c guarded-shell /etc/shells

# Check ZDOTDIR (per-target)
ls -la /Users/ash_claudecode_agent/.zdot/

# Check PATH router
head -3 /usr/local/bin/claude
cat "$HOST_HOME/.agenshield/path-registry.json"
```
