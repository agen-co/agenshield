/**
 * PATH Router Override
 *
 * Manages a router wrapper installed at /usr/local/bin/<command> that
 * routes to shielded target instances. When a single instance is shielded,
 * it routes directly. When multiple instances exist, it prompts the user
 * to select which one. Falls back to the original binary when no instances
 * are active.
 *
 * Registry stored at $HOME/.agenshield/path-registry.json.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

// ── Types ────────────────────────────────────────────────────────

export interface PathRegistryInstance {
  targetId: string;
  profileId: string;
  name: string;
  agentBinPath: string;
  baseName: string;
  agentUsername: string;
  agentHome?: string;
}

export interface PathRegistryEntry {
  originalBinary: string;
  instances: PathRegistryInstance[];
  /** Whether the host user's original (unshielded) binary is offered as a routing option */
  allowHostPassthrough?: boolean;
}

export interface PathRegistry {
  [binName: string]: PathRegistryEntry;
}

// ── Constants ────────────────────────────────────────────────────

export const ROUTER_MARKER = 'AGENSHIELD_ROUTER';

/** Resolve path-registry.json under the host user's ~/.agenshield/ */
export function pathRegistryPath(hostHome?: string): string {
  const home = hostHome || process.env['HOME'] || '';
  return `${home}/.agenshield/path-registry.json`;
}

// ── Registry helpers ─────────────────────────────────────────────

/**
 * Read the path registry from disk.
 * Returns an empty object if the file doesn't exist or is malformed.
 */
export function readPathRegistry(hostHome?: string): PathRegistry {
  const regPath = pathRegistryPath(hostHome);
  try {
    if (!fs.existsSync(regPath)) return {};
    const raw = fs.readFileSync(regPath, 'utf-8');
    return JSON.parse(raw) as PathRegistry;
  } catch {
    return {};
  }
}

/**
 * Write the path registry to disk.
 * Creates the parent directory if needed.
 */
export function writePathRegistry(registry: PathRegistry, hostHome?: string): void {
  const regPath = pathRegistryPath(hostHome);
  const dir = path.dirname(regPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(regPath, JSON.stringify(registry, null, 2), 'utf-8');
}

/**
 * Add an instance to the registry for a given binary name.
 */
export function addRegistryInstance(
  binName: string,
  instance: PathRegistryInstance,
  originalBinary: string,
  hostHome?: string,
): PathRegistry {
  const registry = readPathRegistry(hostHome);

  if (!registry[binName]) {
    registry[binName] = {
      originalBinary,
      instances: [],
    };
  }

  // Update originalBinary if not set
  if (!registry[binName].originalBinary && originalBinary) {
    registry[binName].originalBinary = originalBinary;
  }

  // Remove existing instance with same targetId (replace)
  registry[binName].instances = registry[binName].instances.filter(
    (i) => i.targetId !== instance.targetId,
  );
  registry[binName].instances.push(instance);

  return registry;
}

/**
 * Remove an instance from the registry.
 * Returns the updated registry and the remaining instance count for that binName.
 */
export function removeRegistryInstance(
  binName: string,
  targetId: string,
  hostHome?: string,
): { registry: PathRegistry; remainingCount: number; originalBinary: string } {
  const registry = readPathRegistry(hostHome);
  const entry = registry[binName];

  if (!entry) {
    return { registry, remainingCount: 0, originalBinary: '' };
  }

  const originalBinary = entry.originalBinary;
  entry.instances = entry.instances.filter((i) => i.targetId !== targetId);

  if (entry.instances.length === 0) {
    delete registry[binName];
  }

  return {
    registry,
    remainingCount: entry.instances.length,
    originalBinary,
  };
}

// ── Host passthrough helpers ─────────────────────────────────────

/**
 * Update the allowHostPassthrough flag for a single binary in the registry.
 * Returns the updated registry (caller is responsible for writing to disk).
 */
export function updateRegistryHostPassthrough(
  binName: string,
  allow: boolean,
  hostHome?: string,
): PathRegistry {
  const registry = readPathRegistry(hostHome);
  const entry = registry[binName];
  if (entry) {
    entry.allowHostPassthrough = allow;
  }
  return registry;
}

/**
 * Update the allowHostPassthrough flag for ALL binaries in the registry.
 * Returns the updated registry (caller is responsible for writing to disk).
 */
export function updateAllRegistryHostPassthrough(
  allow: boolean,
  hostHome?: string,
): PathRegistry {
  const registry = readPathRegistry(hostHome);
  for (const binName of Object.keys(registry)) {
    registry[binName].allowHostPassthrough = allow;
  }
  return registry;
}

// ── Binary discovery ─────────────────────────────────────────────

/**
 * Find the original binary path for a command, skipping any AGENSHIELD_ROUTER wrappers.
 */
export function findOriginalBinary(binName: string): string | null {
  try {
    // Use `which -a` to find all instances
    const output = execSync(`which -a ${binName} 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    const candidates = output.split('\n').filter(Boolean);

    for (const candidate of candidates) {
      // Skip our router wrappers
      if (isRouterWrapper(candidate)) continue;
      return candidate;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a file is an AgenShield router wrapper.
 */
export function isRouterWrapper(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.includes(ROUTER_MARKER);
  } catch {
    return false;
  }
}

// ── Router wrapper generation ────────────────────────────────────

/**
 * Generate the bash router wrapper script for a given binary name.
 *
 * The wrapper:
 * - If exactly 1 shielded instance → routes directly to its agent bin
 * - If multiple → prompts user to select
 * - Falls back to original binary if no instances are active
 */
export function generateRouterWrapper(binName: string): string {
  // Pure awk JSON parser — no python3 dependency, fast startup.
  // Structured output: META:<allowHostPassthrough>:<origBin> + INST:<user>:<bin>:<home>:<name>:<baseName>
  // $HOME resolves to the invoking user's home at runtime.
  return `#!/bin/bash
# ${ROUTER_MARKER} — Do not edit. Managed by AgenShield.
# Router for: ${binName}

REGISTRY="$HOME/.agenshield/path-registry.json"
if [ ! -f "$REGISTRY" ]; then
  echo "AgenShield: No registry found. No shielded instances configured." >&2
  exit 1
fi

# Helper: exec as agent user via guarded shell (enforces PATH/env restrictions)
_agenshield_exec() {
  local AGENT_USER="$1" BIN="$2" AGENT_HOME="$3"
  shift 3
  if [ -z "$AGENT_USER" ]; then
    exec "$BIN" "$@"
  fi
  if [ -n "$AGENT_HOME" ]; then
    local GUARDED_SHELL="$AGENT_HOME/.agenshield/bin/guarded-shell"
    if [ -x "$GUARDED_SHELL" ]; then
      exec sudo -H -u "$AGENT_USER" \
        env "HOME=$AGENT_HOME" "AGENSHIELD_HOST_HOME=$HOME" "AGENSHIELD_HOST_CWD=$PWD" \
        "$GUARDED_SHELL" -c \
        'exec "'"$BIN"'" "$@"' -- "$@"
    else
      # Fallback if guarded shell not installed
      exec sudo -H -u "$AGENT_USER" \
        env "HOME=$AGENT_HOME" "AGENSHIELD_HOST_HOME=$HOME" "AGENSHIELD_HOST_CWD=$PWD" \
        "$BIN" "$@"
    fi
  else
    exec sudo -H -u "$AGENT_USER" env "AGENSHIELD_HOST_HOME=$HOME" "AGENSHIELD_HOST_CWD=$PWD" "$BIN" "$@"
  fi
}

# Helper: exec the host user's original (unshielded) binary directly
_agenshield_exec_host() {
  local BIN="$1"
  shift
  exec "$BIN" "$@"
}

# ── Interactive arrow-key selector ──────────────────────────────
# Usage: _agenshield_select "Title" "Option 1" "Option 2" ... [--cancel]
# Sets _AGENSHIELD_SELECTION to 1-based index (0 if cancelled).
_agenshield_select() {
  local TITLE="$1"; shift

  # Collect options and check for --cancel flag
  local -a OPTS=()
  local ALLOW_CANCEL=0
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--cancel" ]]; then
      ALLOW_CANCEL=1
    else
      OPTS+=("$1")
    fi
    shift
  done

  local COUNT=\${#OPTS[@]}
  if [[ $COUNT -eq 0 ]]; then
    _AGENSHIELD_SELECTION=0
    return
  fi

  # Non-TTY fallback: numbered prompt
  if ! [ -t 0 ] || ! [ -t 2 ]; then
    echo "" >&2
    echo "  $TITLE" >&2
    echo "" >&2
    local i
    for i in \$(seq 1 \$COUNT); do
      echo "  \$i) \${OPTS[\$((i-1))]}" >&2
    done
    printf "Select [1-\$COUNT]: " >&2
    read -r _AGENSHIELD_SELECTION
    if ! [[ "\$_AGENSHIELD_SELECTION" =~ ^[0-9]+$ ]] || \
       [[ \$_AGENSHIELD_SELECTION -lt 1 ]] || \
       [[ \$_AGENSHIELD_SELECTION -gt \$COUNT ]]; then
      _AGENSHIELD_SELECTION=0
    fi
    return
  fi

  # ── Interactive mode (TTY) ──────────────────────────────────
  local ESC=$'\\x1b'
  local CUR=0  # 0-indexed current selection
  local SAVED_STTY
  SAVED_STTY=\$(stty -g 2>/dev/null)

  # Cleanup: restore terminal on RETURN or Ctrl-C
  _agenshield_select_cleanup() {
    printf "\${ESC}[?25h" >&2  # show cursor
    stty "\$SAVED_STTY" 2>/dev/null
  }
  trap '_agenshield_select_cleanup' RETURN
  trap '_agenshield_select_cleanup; exit 130' INT

  # Hide cursor
  printf "\${ESC}[?25h" >&2
  printf "\${ESC}[?25l" >&2

  # Total lines we render (title + blank + options + blank + hint)
  local TOTAL_LINES=\$((COUNT + 4))

  _agenshield_select_render() {
    local idx
    # Title: cyan bold
    printf "\${ESC}[1;36m  %s\${ESC}[0m\\n" "\$TITLE" >&2
    echo "" >&2
    for idx in \$(seq 0 \$((COUNT - 1))); do
      if [[ \$idx -eq \$CUR ]]; then
        # Active: green arrow + bold text
        printf "\${ESC}[32m  > \${ESC}[1m%s\${ESC}[0m\\n" "\${OPTS[\$idx]}" >&2
      else
        printf "    \${ESC}[2m%s\${ESC}[0m\\n" "\${OPTS[\$idx]}" >&2
      fi
    done
    echo "" >&2
    # Hint line
    local HINT="  ↑/↓ Navigate  Enter Confirm"
    if [[ \$ALLOW_CANCEL -eq 1 ]]; then
      HINT="\$HINT  Esc Cancel"
    fi
    printf "\${ESC}[2m%s\${ESC}[0m" "\$HINT" >&2
  }

  # Initial render
  _agenshield_select_render

  # Input loop
  while true; do
    stty raw -echo 2>/dev/null
    local KEY
    IFS= read -r -s -n 1 KEY 2>/dev/null
    stty "\$SAVED_STTY" 2>/dev/null

    if [[ "\$KEY" == \$'\x1b' ]]; then
      # Read rest of escape sequence
      local SEQ
      stty raw -echo 2>/dev/null
      IFS= read -r -s -n 2 -t 0.1 SEQ 2>/dev/null
      stty "\$SAVED_STTY" 2>/dev/null
      case "\$SEQ" in
        '[A') # Up arrow
          [[ \$CUR -gt 0 ]] && CUR=\$((CUR - 1))
          ;;
        '[B') # Down arrow
          [[ \$CUR -lt \$((COUNT - 1)) ]] && CUR=\$((CUR + 1))
          ;;
        *)
          # Bare Esc (no sequence) — cancel if allowed
          if [[ -z "\$SEQ" ]] && [[ \$ALLOW_CANCEL -eq 1 ]]; then
            # Clear rendered lines
            local cl
            for cl in \$(seq 1 \$TOTAL_LINES); do
              printf "\${ESC}[A\${ESC}[2K" >&2
            done
            printf "\\r" >&2
            _AGENSHIELD_SELECTION=0
            return
          fi
          ;;
      esac
    elif [[ "\$KEY" == "" ]]; then
      # Enter key
      # Clear rendered lines
      local cl
      for cl in \$(seq 1 \$TOTAL_LINES); do
        printf "\${ESC}[A\${ESC}[2K" >&2
      done
      printf "\\r" >&2
      _AGENSHIELD_SELECTION=\$((CUR + 1))
      return
    elif [[ "\$KEY" =~ ^[1-9]$ ]] && [[ "\$KEY" -le \$COUNT ]]; then
      # Number shortcut
      local cl
      for cl in \$(seq 1 \$TOTAL_LINES); do
        printf "\${ESC}[A\${ESC}[2K" >&2
      done
      printf "\\r" >&2
      _AGENSHIELD_SELECTION="\$KEY"
      return
    fi

    # Re-render: move cursor up and redraw
    local cl
    for cl in \$(seq 1 \$TOTAL_LINES); do
      printf "\${ESC}[A\${ESC}[2K" >&2
    done
    printf "\\r" >&2
    _agenshield_select_render
  done
}

# Daemon connection (used by _check_cwd_access and _check_cwd_perms)
DAEMON_HOST="\${AGENSHIELD_HOST:-127.0.0.1}"
DAEMON_PORT="\${AGENSHIELD_PORT:-5200}"

# Helper: check if CWD is in the allowed workspace paths
_check_cwd_access() {
  local AGENT_HOME="$1"
  local CWD="$PWD"

  # Always allowed: agentHome and its subdirs
  [[ "$CWD" == "$AGENT_HOME"* ]] && return 0

  local ENCODED_PATH
  ENCODED_PATH=$(printf '%s' "$CWD" | jq -sRr @uri 2>/dev/null || echo "$CWD")
  local RESP
  RESP=$(curl -sf "http://\${DAEMON_HOST}:\${DAEMON_PORT}/api/workspace-paths/check?path=$ENCODED_PATH" 2>/dev/null)

  # Fail-open if daemon unreachable (broker still enforces at runtime)
  [ -z "$RESP" ] && return 0

  echo "$RESP" | grep -q '"allowed":true' && return 0

  # Prompt user
  _agenshield_select \\
    "AgenShield: Current directory is not in the allowed workspace paths:  $CWD" \\
    "Grant access to this folder" \\
    "Start in agent home ($AGENT_HOME) instead" \\
    "Cancel" --cancel

  case "\$_AGENSHIELD_SELECTION" in
    1) curl -sf -X POST "http://\${DAEMON_HOST}:\${DAEMON_PORT}/api/workspace-paths/grant" \\
         -H "Content-Type: application/json" \\
         -d "{\\"path\\":\\"$CWD\\"}" > /dev/null 2>&1
       echo "Access granted." >&2 ;;
    2) export AGENSHIELD_HOST_CWD="$AGENT_HOME"
       echo "Using agent home." >&2 ;;
    *) echo "Cancelled." >&2; exit 0 ;;
  esac
}

# Helper: check if agent user has OS-level read+execute on CWD
_check_cwd_perms() {
  local AGENT_USER="$1" AGENT_HOME="$2"
  local CWD="$PWD"

  # Skip if CWD is under agent home (always accessible)
  [[ "$CWD" == "$AGENT_HOME"* ]] && return 0

  # Test if agent user can read+execute the directory
  if sudo -n -u "$AGENT_USER" test -r "$CWD" -a -x "$CWD" 2>/dev/null; then
    return 0
  fi

  # Prompt user
  _agenshield_select \\
    "AgenShield: The agent user ($AGENT_USER) cannot access:  $CWD" \\
    "Fix permissions (grant read access)" \\
    "Start in agent home ($AGENT_HOME) instead" \\
    "Cancel" --cancel

  case "\$_AGENSHIELD_SELECTION" in
    1) # Call daemon to apply ACLs
       local RESP
       RESP=$(curl -sf -X POST "http://\${DAEMON_HOST}:\${DAEMON_PORT}/api/workspace-paths/fix-permissions" \\
         -H "Content-Type: application/json" \\
         -d "{\\"path\\":\\"$CWD\\",\\"agentUser\\":\\"$AGENT_USER\\"}" 2>/dev/null)
       if echo "$RESP" | grep -q '"success":true'; then
         echo "Permissions fixed." >&2
       else
         echo "Failed to fix permissions. Starting in agent home." >&2
         export AGENSHIELD_HOST_CWD="$AGENT_HOME"
       fi ;;
    2) export AGENSHIELD_HOST_CWD="$AGENT_HOME"
       echo "Using agent home." >&2 ;;
    *) echo "Cancelled." >&2; exit 0 ;;
  esac
}

# Parse registry with awk — structured output:
#   META:<allowHostPassthrough 0|1>:<originalBinary>
#   INST:<user>:<bin>:<home>:<name>:<baseName>
PARSED=$(awk -v bn="${binName}" '
BEGIN { ib=0; ii=0; ic=0; orig=""; allow=0 }
$0 ~ "\\"" bn "\\"[[:space:]]*:" { ib=1; next }
ib && /\\"originalBinary\\"/ { gsub(/.*: \\"/, ""); gsub(/\\".*/, ""); orig=$0 }
ib && /\\"allowHostPassthrough\\"/ {
  if ($0 ~ /true/) allow=1; else allow=0
}
ib && /\\"instances\\"/ { ii=1; next }
ii && /\\{/ { ic++ }
ii && /\\"agentUsername\\"/ { gsub(/.*: \\"/, ""); gsub(/\\".*/, ""); u[ic]=$0 }
ii && /\\"agentBinPath\\"/ { gsub(/.*: \\"/, ""); gsub(/\\".*/, ""); b[ic]=$0 }
ii && /\\"agentHome\\"/ { gsub(/.*: \\"/, ""); gsub(/\\".*/, ""); h[ic]=$0 }
ii && /\\"name\\"[[:space:]]*:/ { gsub(/.*: \\"/, ""); gsub(/\\".*/, ""); n[ic]=$0 }
ii && /\\"baseName\\"/ { gsub(/.*: \\"/, ""); gsub(/\\".*/, ""); bn2[ic]=$0 }
ii && /\\]/ { ii=0 }
ib && !ii && /\\}/ { ib=0 }
END {
  print "META:" allow ":" orig
  for(i=1;i<=ic;i++) print "INST:" u[i] ":" b[i] ":" h[i] ":" n[i] ":" bn2[i]
}' "$REGISTRY" 2>/dev/null)

if [[ -z "$PARSED" ]]; then
  echo "AgenShield: Failed to read registry." >&2
  exit 1
fi

# Extract metadata
META_LINE=$(echo "$PARSED" | head -1)
ALLOW_HOST="\${META_LINE#META:}"
ALLOW_HOST_FLAG="\${ALLOW_HOST%%:*}"
ORIG_BIN="\${ALLOW_HOST#*:}"

# Collect shielded instances into arrays
declare -a INST_USERS INST_BINS INST_HOMES INST_NAMES INST_BASES
INST_COUNT=0
while IFS= read -r line; do
  [[ "$line" != INST:* ]] && continue
  INST_COUNT=$((INST_COUNT + 1))
  PAYLOAD="\${line#INST:}"
  INST_USERS[$INST_COUNT]="\${PAYLOAD%%:*}"; PAYLOAD="\${PAYLOAD#*:}"
  INST_BINS[$INST_COUNT]="\${PAYLOAD%%:*}"; PAYLOAD="\${PAYLOAD#*:}"
  INST_HOMES[$INST_COUNT]="\${PAYLOAD%%:*}"; PAYLOAD="\${PAYLOAD#*:}"
  INST_NAMES[$INST_COUNT]="\${PAYLOAD%%:*}"; PAYLOAD="\${PAYLOAD#*:}"
  INST_BASES[$INST_COUNT]="$PAYLOAD"
done <<< "$PARSED"

# Determine if host option is available
HOST_AVAILABLE=0
if [[ "$ALLOW_HOST_FLAG" == "1" ]] && [[ -n "$ORIG_BIN" ]] && [[ -x "$ORIG_BIN" ]]; then
  HOST_AVAILABLE=1
fi

TOTAL_OPTIONS=$((INST_COUNT + HOST_AVAILABLE))

if [[ $TOTAL_OPTIONS -eq 0 ]]; then
  echo "AgenShield: No shielded instances configured." >&2
  exit 1
elif [[ $TOTAL_OPTIONS -eq 1 ]]; then
  # Single option — direct exec (no prompt)
  if [[ $INST_COUNT -eq 1 ]]; then
    # Validate CWD is in allowed workspace paths before launching
    if [[ -n "\${INST_HOMES[1]}" ]]; then
      _check_cwd_access "\${INST_HOMES[1]}"
      _check_cwd_perms "\${INST_USERS[1]}" "\${INST_HOMES[1]}"
    fi
    _agenshield_exec "\${INST_USERS[1]}" "\${INST_BINS[1]}" "\${INST_HOMES[1]}" "$@"
  else
    _agenshield_exec_host "$ORIG_BIN" "$@"
  fi
else
  # Multiple options — build options and prompt with interactive selector
  local -a SELECT_OPTS=()
  for i in \$(seq 1 \$INST_COUNT); do
    SELECT_OPTS+=("\${INST_NAMES[\$i]} [\${INST_BASES[\$i]}] (shielded)")
  done
  if [[ \$HOST_AVAILABLE -eq 1 ]]; then
    SELECT_OPTS+=("Host User (unshielded)")
  fi

  _agenshield_select "Select an instance" "\${SELECT_OPTS[@]}"

  if [[ \$_AGENSHIELD_SELECTION -ge 1 ]] && [[ \$_AGENSHIELD_SELECTION -le \$TOTAL_OPTIONS ]]; then
    if [[ \$_AGENSHIELD_SELECTION -le \$INST_COUNT ]]; then
      # Validate CWD is in allowed workspace paths before launching
      if [[ -n "\${INST_HOMES[\$_AGENSHIELD_SELECTION]}" ]]; then
        _check_cwd_access "\${INST_HOMES[\$_AGENSHIELD_SELECTION]}"
        _check_cwd_perms "\${INST_USERS[\$_AGENSHIELD_SELECTION]}" "\${INST_HOMES[\$_AGENSHIELD_SELECTION]}"
      fi
      _agenshield_exec "\${INST_USERS[\$_AGENSHIELD_SELECTION]}" "\${INST_BINS[\$_AGENSHIELD_SELECTION]}" "\${INST_HOMES[\$_AGENSHIELD_SELECTION]}" "$@"
    else
      _agenshield_exec_host "$ORIG_BIN" "$@"
    fi
  fi
  echo "Invalid selection." >&2
  exit 1
fi
`;
}

/**
 * Build the shell commands needed to install the router wrapper.
 * Returns a single string to be executed via execAsRoot.
 *
 * Steps:
 * 1. Ensure /usr/local/bin exists
 * 2. Back up the original binary if it's not already our wrapper
 * 3. Write the router wrapper
 * 4. chmod 755
 */
export function buildInstallRouterCommands(
  binName: string,
  wrapperContent: string,
): string {
  const targetPath = `/usr/local/bin/${binName}`;
  const backupPath = `/usr/local/bin/.${binName}.agenshield-backup`;

  const commands = [
    // Ensure /usr/local/bin exists (Apple Silicon may not have it)
    'mkdir -p /usr/local/bin',
  ];

  // Backup logic: only if file exists and is NOT already our wrapper
  commands.push(
    `if [ -f "${targetPath}" ] && ! grep -q "${ROUTER_MARKER}" "${targetPath}" 2>/dev/null; then cp "${targetPath}" "${backupPath}"; fi`,
  );

  // Write wrapper (use heredoc — terminator must be alone on its line,
  // so we join with newlines instead of && to prevent the terminator
  // from sharing a line with the next command)
  commands.push(
    `cat > "${targetPath}" << 'AGENSHIELD_WRAPPER_EOF'\n${wrapperContent}\nAGENSHIELD_WRAPPER_EOF`,
  );

  // Make executable
  commands.push(`chmod 755 "${targetPath}"`);

  return commands.join('\n');
}

/**
 * Build shell commands to remove the router wrapper and restore the original binary.
 */
export function buildRemoveRouterCommands(binName: string): string {
  const targetPath = `/usr/local/bin/${binName}`;
  const backupPath = `/usr/local/bin/.${binName}.agenshield-backup`;

  const commands = [
    // Only remove if it's our wrapper
    `if grep -q "${ROUTER_MARKER}" "${targetPath}" 2>/dev/null; then`,
    `  if [ -f "${backupPath}" ]; then`,
    `    mv "${backupPath}" "${targetPath}"`,
    '  else',
    `    rm -f "${targetPath}"`,
    '  fi',
    'fi',
  ];

  return commands.join('\n');
}

/**
 * Build shell commands to install a router wrapper at ~/.agenshield/bin/<binName>.
 * This user-local copy takes priority when $HOME/.agenshield/bin is on PATH
 * (appended to shell rc after NVM sourcing).
 */
export function buildInstallUserLocalRouterCommands(
  binName: string,
  wrapperContent: string,
  hostHome?: string,
): string {
  const home = hostHome || '$HOME';
  const targetDir = `${home}/.agenshield/bin`;
  const targetPath = `${targetDir}/${binName}`;

  const commands = [
    `mkdir -p "${targetDir}"`,
    `cat > "${targetPath}" << 'AGENSHIELD_WRAPPER_EOF'\n${wrapperContent}\nAGENSHIELD_WRAPPER_EOF`,
    `chmod 755 "${targetPath}"`,
  ];

  return commands.join('\n');
}

/**
 * Build shell commands to remove the user-local router wrapper at ~/.agenshield/bin/<binName>.
 * Only removes if it contains the AGENSHIELD_ROUTER marker.
 */
export function buildRemoveUserLocalRouterCommands(
  binName: string,
  hostHome?: string,
): string {
  const home = hostHome || '$HOME';
  const targetPath = `${home}/.agenshield/bin/${binName}`;

  return `if [ -f "${targetPath}" ] && grep -q "${ROUTER_MARKER}" "${targetPath}" 2>/dev/null; then rm -f "${targetPath}"; fi`;
}

/**
 * Scan /usr/local/bin for AgenShield router wrappers.
 * Returns an array of filenames that contain the AGENSHIELD_ROUTER marker.
 */
export function scanForRouterWrappers(): string[] {
  const binDir = '/usr/local/bin';
  const wrappers: string[] = [];

  try {
    if (!fs.existsSync(binDir)) return wrappers;

    for (const file of fs.readdirSync(binDir)) {
      const fullPath = path.join(binDir, file);
      if (isRouterWrapper(fullPath)) {
        wrappers.push(file);
      }
    }
  } catch {
    // Best effort
  }

  return wrappers;
}
