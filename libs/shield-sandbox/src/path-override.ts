/**
 * PATH Router Override
 *
 * Manages a router wrapper installed at /usr/local/bin/<command> that
 * routes to shielded target instances. When a single instance is shielded,
 * it routes directly. When multiple instances exist, it prompts the user
 * to select which one. Falls back to the original binary when no instances
 * are active.
 *
 * Registry stored at /etc/agenshield/path-registry.json.
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
}

export interface PathRegistryEntry {
  originalBinary: string;
  instances: PathRegistryInstance[];
}

export interface PathRegistry {
  [binName: string]: PathRegistryEntry;
}

// ── Constants ────────────────────────────────────────────────────

export const PATH_REGISTRY_PATH = '/etc/agenshield/path-registry.json';
export const ROUTER_MARKER = 'AGENSHIELD_ROUTER';

// ── Registry helpers ─────────────────────────────────────────────

/**
 * Read the path registry from disk.
 * Returns an empty object if the file doesn't exist or is malformed.
 */
export function readPathRegistry(): PathRegistry {
  try {
    if (!fs.existsSync(PATH_REGISTRY_PATH)) return {};
    const raw = fs.readFileSync(PATH_REGISTRY_PATH, 'utf-8');
    return JSON.parse(raw) as PathRegistry;
  } catch {
    return {};
  }
}

/**
 * Write the path registry to disk.
 * Creates the parent directory if needed.
 */
export function writePathRegistry(registry: PathRegistry): void {
  const dir = path.dirname(PATH_REGISTRY_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(PATH_REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf-8');
}

/**
 * Add an instance to the registry for a given binary name.
 */
export function addRegistryInstance(
  binName: string,
  instance: PathRegistryInstance,
  originalBinary: string,
): PathRegistry {
  const registry = readPathRegistry();

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
): { registry: PathRegistry; remainingCount: number; originalBinary: string } {
  const registry = readPathRegistry();
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
  // python3 is guaranteed on macOS for JSON parsing
  return `#!/bin/bash
# ${ROUTER_MARKER} — Do not edit. Managed by AgenShield.
# Router for: ${binName}

REGISTRY="${PATH_REGISTRY_PATH}"

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
entry = d.get('${binName}', {})
instances = entry.get('instances', [])
orig = entry.get('originalBinary', '')
if len(instances) == 0:
    if orig:
        print('EXEC:' + orig)
    else:
        print('NONE')
elif len(instances) == 1:
    print('EXEC:' + instances[0]['agentBinPath'])
else:
    for i, inst in enumerate(instances):
        print(str(i+1) + ') ' + inst['name'] + ' [' + inst['baseName'] + ']')
    print('CHOOSE')
" 2>/dev/null)

if [[ "$RESULT" == "ERROR" ]]; then
  echo "AgenShield: Failed to read registry." >&2
  exit 1
elif [[ "$RESULT" == EXEC:* ]]; then
  BIN="\${RESULT#EXEC:}"
  exec "$BIN" "$@"
elif [[ "$RESULT" == "NONE" ]]; then
  echo "AgenShield: No shielded instances configured." >&2
  exit 1
elif [[ "$RESULT" == *"CHOOSE" ]]; then
  echo "AgenShield: Multiple shielded instances found:" >&2
  echo "$RESULT" | grep -v CHOOSE >&2
  printf "Select instance (number): " >&2
  read -r CHOICE
  BIN=$(python3 -c "
import json, sys
try:
    d = json.load(open('$REGISTRY'))
    instances = d.get('${binName}', {}).get('instances', [])
    idx = int('$CHOICE') - 1
    if 0 <= idx < len(instances):
        print(instances[idx]['agentBinPath'])
except:
    pass
" 2>/dev/null)
  if [ -n "$BIN" ] && [ -x "$BIN" ]; then
    exec "$BIN" "$@"
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

  // Write wrapper (use heredoc)
  commands.push(
    `cat > "${targetPath}" << 'AGENSHIELD_WRAPPER_EOF'\n${wrapperContent}\nAGENSHIELD_WRAPPER_EOF`,
  );

  // Make executable
  commands.push(`chmod 755 "${targetPath}"`);

  return commands.join(' && ');
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
