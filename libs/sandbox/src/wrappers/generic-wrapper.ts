/**
 * Generic Wrapper Script
 *
 * A single wrapper script that all non-specialized commands symlink to.
 * Uses `basename $0` to detect the invoked command name (busybox-style),
 * calls shield-client check-exec, then execs the real binary.
 *
 * Also provides functions to install the generic wrapper and sync
 * symlinks for all system binaries that don't have specific wrappers.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Generate the generic wrapper bash script content.
 *
 * The script detects the command name from $0, performs a policy check
 * via shield-client, then execs the real binary from system directories.
 */
export function generateGenericWrapper(): string {
  return `#!/bin/bash
# AgenShield generic policy wrapper
# Detects command name from $0, checks policy, execs real binary.
# All symlinks in {agentHome}/bin/ point here.
CMD="$(basename "$0")"
if ! /bin/pwd > /dev/null 2>&1; then cd ~ 2>/dev/null || cd /; fi

# Policy check (fail-closed: any non-zero exit blocks)
"$HOME/.agenshield/bin/shield-client" check-exec "$CMD" >/dev/null 2>&1
SC_EXIT=$?
if [ $SC_EXIT -ne 0 ]; then
  if [ $SC_EXIT -eq 126 ]; then
    echo "AgenShield: execution of '$CMD' denied by policy" >&2
  else
    echo "AgenShield: policy check failed for '$CMD' (broker unreachable)" >&2
  fi
  exit 126
fi

# Resolve and exec real binary (first match wins)
for _dir in /usr/local/bin /usr/bin /usr/sbin /bin /sbin; do
  [ -x "$_dir/$CMD" ] && exec "$_dir/$CMD" "$@"
done
echo "AgenShield: '$CMD' real binary not found" >&2
exit 127
`;
}

/** Standard system binary directories to scan */
const SYSTEM_BIN_SCAN_DIRS = ['/usr/bin', '/usr/local/bin'];

/**
 * Install the generic-wrapper script at {hostHome}/.agenshield/bin/generic-wrapper.
 *
 * @returns The installed path
 */
export async function installGenericWrapper(
  hostHome: string,
  options?: { useSudo?: boolean },
): Promise<string> {
  const targetDir = path.join(hostHome, '.agenshield', 'bin');
  const targetPath = path.join(targetDir, 'generic-wrapper');
  const content = generateGenericWrapper();

  // Ensure directory exists
  try {
    await fs.mkdir(targetDir, { recursive: true });
  } catch {
    if (options?.useSudo) {
      await execAsync(`sudo mkdir -p "${targetDir}"`);
    }
  }

  if (options?.useSudo) {
    await execAsync(`sudo tee "${targetPath}" > /dev/null << 'WRAPPER_EOF'
${content}
WRAPPER_EOF`);
    await execAsync(`sudo chmod 755 "${targetPath}"`);
  } else {
    await fs.writeFile(targetPath, content, { mode: 0o755 });
  }

  return targetPath;
}

/**
 * Sync generic wrapper symlinks for all system binaries.
 *
 * Scans /usr/bin and /usr/local/bin for executable files, then creates
 * symlinks in agentBinDir for any binary that doesn't already have a
 * specific wrapper or skill binary installed.
 *
 * @param agentBinDir - The agent's bin directory ({agentHome}/bin)
 * @param genericWrapperPath - Path to the installed generic-wrapper script
 * @param options - Optional configuration
 * @returns Lists of created and skipped symlinks
 */
export async function syncGenericWrappers(
  agentBinDir: string,
  genericWrapperPath: string,
  options?: { useSudo?: boolean },
): Promise<{ created: string[]; skipped: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];

  // Get existing files in agentBinDir (specific wrappers + skill binaries)
  let existingFiles: Set<string>;
  try {
    const entries = await fs.readdir(agentBinDir);
    existingFiles = new Set(entries);
  } catch {
    existingFiles = new Set();
  }

  // Scan system directories for executables
  for (const dir of SYSTEM_BIN_SCAN_DIRS) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      // Skip hidden files and already-existing entries
      if (entry.startsWith('.')) {
        skipped.push(entry);
        continue;
      }
      if (existingFiles.has(entry)) {
        skipped.push(entry);
        continue;
      }

      // Check it's an executable file
      const fullPath = path.join(dir, entry);
      try {
        const stat = await fs.stat(fullPath);
        if (!stat.isFile()) continue;
        // Check execute permission (owner, group, or other)
        if ((stat.mode & 0o111) === 0) continue;
      } catch {
        continue;
      }

      // Create symlink
      const symlinkPath = path.join(agentBinDir, entry);
      try {
        if (options?.useSudo) {
          await execAsync(`sudo ln -sf "${genericWrapperPath}" "${symlinkPath}"`);
        } else {
          await fs.symlink(genericWrapperPath, symlinkPath);
        }
        created.push(entry);
        existingFiles.add(entry);
      } catch {
        skipped.push(entry);
      }
    }
  }

  return { created, skipped };
}
