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
  // Output format: EXEC:<username>:<binPath>:<agentHome> for sudo delegation
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
      exec sudo -H -u "$AGENT_USER" "$GUARDED_SHELL" -c \
        'export AGENSHIELD_HOST_CWD="'"$PWD"'"; exec "'"$BIN"'" "$@"' -- "$@"
    else
      # Fallback if guarded shell not installed
      exec sudo -H -u "$AGENT_USER" env "AGENSHIELD_HOST_CWD=$PWD" "$BIN" "$@"
    fi
  else
    exec sudo -H -u "$AGENT_USER" env "AGENSHIELD_HOST_CWD=$PWD" "$BIN" "$@"
  fi
}

# Parse registry with awk (no python3 dependency)
RESULT=$(awk -v bn="${binName}" '
BEGIN { ib=0; ii=0; ic=0; orig="" }
$0 ~ "\\"" bn "\\"[[:space:]]*:" { ib=1; next }
ib && /\\"originalBinary\\"/ { gsub(/.*: \\"/, ""); gsub(/\\".*/, ""); orig=$0 }
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
  if (ic==0) { if (orig!="") print "ORIG:" orig; else print "NONE" }
  else if (ic==1) print "EXEC:" u[1] ":" b[1] ":" h[1]
  else { for(i=1;i<=ic;i++) print i") " n[i] " [" bn2[i] "]|" u[i] ":" b[i] ":" h[i]; print "CHOOSE" }
}' "$REGISTRY" 2>/dev/null)

if [[ -z "$RESULT" ]]; then
  echo "AgenShield: Failed to read registry." >&2
  exit 1
elif [[ "$RESULT" == ORIG:* ]]; then
  BIN="\${RESULT#ORIG:}"
  exec "$BIN" "$@"
elif [[ "$RESULT" == EXEC:* ]]; then
  PAYLOAD="\${RESULT#EXEC:}"
  AGENT_USER="\${PAYLOAD%%:*}"
  REST="\${PAYLOAD#*:}"
  BIN="\${REST%%:*}"
  AGENT_HOME="\${REST#*:}"
  _agenshield_exec "$AGENT_USER" "$BIN" "$AGENT_HOME" "$@"
elif [[ "$RESULT" == "NONE" ]]; then
  echo "AgenShield: No shielded instances configured." >&2
  exit 1
elif [[ "$RESULT" == *"CHOOSE" ]]; then
  echo "AgenShield: Multiple shielded instances found:" >&2
  echo "$RESULT" | grep -v CHOOSE | sed 's/|.*//' >&2
  printf "Select instance (number): " >&2
  read -r CHOICE
  SELECTED=$(echo "$RESULT" | grep "^\${CHOICE}) " | sed 's/.*|//')
  if [ -n "$SELECTED" ]; then
    AGENT_USER="\${SELECTED%%:*}"
    REST="\${SELECTED#*:}"
    BIN="\${REST%%:*}"
    AGENT_HOME="\${REST#*:}"
    if [ -n "$AGENT_USER" ] && [ -n "$BIN" ]; then
      _agenshield_exec "$AGENT_USER" "$BIN" "$AGENT_HOME" "$@"
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
