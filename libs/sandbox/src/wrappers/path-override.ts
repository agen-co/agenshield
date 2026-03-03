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

# Helper: exec as agent user, launching the app wrapper directly.
# SHELL=$GUARDED_SHELL ensures subshells spawned by the app go through
# TRAPDEBUG enforcement. The app wrapper handles cd to AGENSHIELD_HOST_CWD.
_agenshield_exec() {
  local AGENT_USER="$1" BIN="$2" AGENT_HOME="$3"
  shift 3
  if [ -z "$AGENT_USER" ]; then
    exec "$BIN" "$@"
  fi

  # Build safe PATH: agent bins + system paths only
  local SAFE_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  [ -d "/opt/homebrew/bin" ] && SAFE_PATH="$SAFE_PATH:/opt/homebrew/bin:/opt/homebrew/sbin"
  if [ -n "$AGENT_HOME" ]; then
    SAFE_PATH="$AGENT_HOME/bin:$AGENT_HOME/.local/bin:$AGENT_HOME/.agenshield/bin:$SAFE_PATH"
  fi

  # Start with empty env — no SUDO_*, no SSH_AUTH_SOCK, no host PATH
  local -a ENV_ARGS=(env -i)
  [ -n "$AGENT_HOME" ] && ENV_ARGS+=("HOME=$AGENT_HOME")
  ENV_ARGS+=("USER=$AGENT_USER")
  ENV_ARGS+=("LOGNAME=$AGENT_USER")
  ENV_ARGS+=("PATH=$SAFE_PATH")
  ENV_ARGS+=("TMPDIR=\${TMPDIR:-/tmp}")
  [ -n "\${TERM:-}" ] && ENV_ARGS+=("TERM=$TERM")
  [ -n "\${LANG:-}" ] && ENV_ARGS+=("LANG=$LANG")
  [ -n "\${LC_ALL:-}" ] && ENV_ARGS+=("LC_ALL=$LC_ALL")
  # AgenShield context (consumed by app wrapper, then unset)
  ENV_ARGS+=("AGENSHIELD_HOST_HOME=$HOME")
  ENV_ARGS+=("AGENSHIELD_HOST_CWD=$PWD")
  # Forward proxy vars if already set (e.g., from guarded shell)
  [ -n "\${HTTP_PROXY:-}" ] && ENV_ARGS+=("HTTP_PROXY=$HTTP_PROXY")
  [ -n "\${HTTPS_PROXY:-}" ] && ENV_ARGS+=("HTTPS_PROXY=$HTTPS_PROXY")
  [ -n "\${NO_PROXY:-}" ] && ENV_ARGS+=("NO_PROXY=$NO_PROXY")
  # Guarded shell
  if [ -n "$AGENT_HOME" ]; then
    local GUARDED_SHELL="$AGENT_HOME/.agenshield/bin/guarded-shell"
    [ -x "$GUARDED_SHELL" ] && ENV_ARGS+=("SHELL=$GUARDED_SHELL")
  fi

  # Change to agent home before sudo to avoid getcwd errors when
  # the host user's CWD is inaccessible to the agent user.
  # The app wrapper handles cd to AGENSHIELD_HOST_CWD after startup.
  if [ -n "$AGENT_HOME" ] && [ -d "$AGENT_HOME" ]; then
    cd "$AGENT_HOME" 2>/dev/null || cd / 2>/dev/null || true
  fi

  exec sudo -H -u "$AGENT_USER" "\${ENV_ARGS[@]}" "$BIN" "$@"
}

# Helper: exec the host user's original (unshielded) binary directly
_agenshield_exec_host() {
  local BIN="$1"
  shift
  exec "$BIN" "$@"
}

# ── Interactive selector ─────────────────────────────────────────
# Usage: _agenshield_select "Title" "Option 1" "Option 2" ... [--cancel]
# Sets _AGENSHIELD_SELECTION to 1-based index (0 if cancelled).
# Tries the Node.js prompt helper first (better rendering), falls back
# to a simple numbered prompt (no ANSI escape codes needed).
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

  # Try Node.js prompt helper (installed at ~/.agenshield/bin/agenshield-prompt)
  local PROMPT_HELPER="$HOME/.agenshield/bin/agenshield-prompt"
  if [ -x "$PROMPT_HELPER" ] && [ -t 0 ] && [ -t 2 ]; then
    local HELPER_ARGS=("--title" "\$TITLE")
    local i
    for i in \$(seq 0 \$((COUNT - 1))); do
      HELPER_ARGS+=("--option" "\${OPTS[\$i]}")
    done
    [[ \$ALLOW_CANCEL -eq 1 ]] && HELPER_ARGS+=("--cancel")

    local RESULT
    RESULT=\$("$PROMPT_HELPER" "\${HELPER_ARGS[@]}" 2>&2)
    if [[ $? -eq 0 ]] && [[ -n "\$RESULT" ]]; then
      _AGENSHIELD_SELECTION="\$RESULT"
      return
    fi
  fi

  # Fallback: simple numbered prompt (works in any terminal)
  echo "" >&2
  echo "  \$TITLE" >&2
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
}

# Daemon connection (used by _check_cwd_access and _check_cwd_perms)
DAEMON_HOST="\${AGENSHIELD_HOST:-127.0.0.1}"
DAEMON_PORT="\${AGENSHIELD_PORT:-5200}"

# Helper: check if CWD is in the allowed workspace paths
# Returns: 0 = already allowed, 2 = just granted (ACLs applied, skip perm check)
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
    1) local GRANT_RESP
       GRANT_RESP=\$(curl -sf -X POST "http://\${DAEMON_HOST}:\${DAEMON_PORT}/api/workspace-paths/grant" \\
         -H "Content-Type: application/json" \\
         -d "{\\"path\\":\\"$CWD\\"}" 2>/dev/null)
       if echo "\$GRANT_RESP" | grep -q '"warning"'; then
         echo "Access registered but permissions could not be verified. Starting in agent home." >&2
         export AGENSHIELD_HOST_CWD="$AGENT_HOME"
         return 0
       fi
       echo "Access granted." >&2
       return 2 ;;
    2) export AGENSHIELD_HOST_CWD="$AGENT_HOME"
       echo "Using agent home." >&2 ;;
    *) echo "Cancelled." >&2; exit 0 ;;
  esac
}

# Helper: check if agent user has OS-level read+execute on CWD
# Uses daemon endpoint instead of sudo -n test (which requires NOPASSWD sudo).
_check_cwd_perms() {
  local AGENT_USER="$1" AGENT_HOME="$2"
  local CWD="$PWD"

  # Skip if CWD is under agent home (always accessible)
  [[ "$CWD" == "$AGENT_HOME"* ]] && return 0

  # Ask daemon to verify ACL-granted access
  local ENCODED_PATH
  ENCODED_PATH=$(printf '%s' "$CWD" | jq -sRr @uri 2>/dev/null || echo "$CWD")
  local ENCODED_USER
  ENCODED_USER=$(printf '%s' "$AGENT_USER" | jq -sRr @uri 2>/dev/null || echo "$AGENT_USER")
  local VERIFY_RESP
  VERIFY_RESP=$(curl -sf "http://\${DAEMON_HOST}:\${DAEMON_PORT}/api/workspace-paths/verify-permissions?path=$ENCODED_PATH&agentUser=$ENCODED_USER" 2>/dev/null)

  # Fail-open if daemon unreachable (broker still enforces at runtime)
  [ -z "$VERIFY_RESP" ] && return 0

  echo "$VERIFY_RESP" | grep -q '"accessible":true' && return 0

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
      _CWD_RC=$?
      # Skip perm check if access was just granted (return 2 = ACLs applied)
      if [[ \$_CWD_RC -eq 0 ]]; then
        _check_cwd_perms "\${INST_USERS[1]}" "\${INST_HOMES[1]}"
      fi
    fi
    _agenshield_exec "\${INST_USERS[1]}" "\${INST_BINS[1]}" "\${INST_HOMES[1]}" "$@"
  else
    _agenshield_exec_host "$ORIG_BIN" "$@"
  fi
else
  # Multiple options — build options and prompt with interactive selector
  SELECT_OPTS=()
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
        _CWD_RC=$?
        # Skip perm check if access was just granted (return 2 = ACLs applied)
        if [[ \$_CWD_RC -eq 0 ]]; then
          _check_cwd_perms "\${INST_USERS[\$_AGENSHIELD_SELECTION]}" "\${INST_HOMES[\$_AGENSHIELD_SELECTION]}"
        fi
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
