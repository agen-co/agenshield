/**
 * Binary Integrity Checker
 *
 * Detects when Claude Code self-updates and replaces its embedded Node.js
 * binary, invalidating both the `patchClaudeNodeStep` wrapper and the
 * `copyClaudeNodeBinStep` binary. When drift is detected, automatically
 * re-applies the patches without user intervention.
 *
 * This module is consumed by the target watcher (targets.ts) which runs
 * every 10 seconds. Integrity checks are rate-limited to avoid excessive
 * I/O on each watcher cycle.
 */

import type { Profile, InstallManifest, ManifestEntry } from '@agenshield/ipc';
import { getStorage } from '@agenshield/storage';
import { computeFileHash } from '../services/process-fingerprint';
import { getSystemExecutor } from '../workers/system-command';
import { emitBinaryDrifted, emitRePatched } from '../events/emitter';
import { getLogger } from '../logger';

export interface IntegrityResult {
  drifted: boolean;
  currentHash: string | null;
  expectedHash: string;
  nodePath: string;
}

/** Rate-limit: at most one check per profile per 60 seconds. */
const INTEGRITY_CHECK_INTERVAL_MS = 60_000;
const lastCheckTimestamps = new Map<string, number>();

/** Track active remediation to prevent overlapping re-patches. */
const remediationInProgress = new Set<string>();

/**
 * Extract a manifest entry's output value by step ID and key.
 */
function getManifestOutput(manifest: InstallManifest, stepId: string, key: string): string | undefined {
  const entry = manifest.entries.find(
    (e: ManifestEntry) => e.stepId === stepId && e.status === 'completed',
  );
  return entry?.outputs[key];
}

/**
 * Check whether Claude's embedded node binary has changed since shielding.
 *
 * Reads `copy_claude_node_bin.nodeBinaryHash` and `.nodeSourcePath` from
 * the profile's install manifest, then hashes the current file on disk.
 */
export function checkClaudeBinaryIntegrity(profile: Profile): IntegrityResult | null {
  const manifest = profile.installManifest;
  if (!manifest) return null;

  const expectedHash = getManifestOutput(manifest, 'copy_claude_node_bin', 'nodeBinaryHash');
  const nodeSourcePath = getManifestOutput(manifest, 'copy_claude_node_bin', 'nodeSourcePath');

  if (!expectedHash || !nodeSourcePath) return null;

  // Rate-limit: skip if checked recently
  const now = Date.now();
  const lastCheck = lastCheckTimestamps.get(profile.id);
  if (lastCheck && now - lastCheck < INTEGRITY_CHECK_INTERVAL_MS) return null;
  lastCheckTimestamps.set(profile.id, now);

  // The nodeSourcePath may be a .real backup (post-patch). If the source was
  // a .real file, check the original path (without .real) since Claude updates
  // the original binary, not the backup.
  const pathToCheck = nodeSourcePath.endsWith('.real')
    ? nodeSourcePath.slice(0, -5)
    : nodeSourcePath;

  const currentHash = computeFileHash(pathToCheck);

  // If the file disappeared entirely, it's a different kind of drift
  // (binary uninstalled), not an update. Don't flag as drifted.
  if (currentHash === null) return null;

  return {
    drifted: currentHash !== expectedHash,
    currentHash,
    expectedHash,
    nodePath: pathToCheck,
  };
}

/**
 * Re-apply node binary copy + patch after detecting drift.
 *
 * 1. Re-copies the new binary to bin/node-bin
 * 2. Re-writes the wrapper script at the original node path
 * 3. Updates the manifest with new hashes
 * 4. Emits target:re-patched event
 */
export async function remediateClaudeBinaryDrift(
  profile: Profile,
  integrity: IntegrityResult,
): Promise<boolean> {
  if (remediationInProgress.has(profile.id)) return false;
  remediationInProgress.add(profile.id);

  const log = getLogger();

  try {
    const manifest = profile.installManifest;
    if (!manifest) return false;

    const agentHome = profile.agentHomeDir;
    const agentUsername = profile.agentUsername;
    if (!agentHome || !agentUsername) return false;

    // Derive socket group name from the agent username pattern (ash_XXX_agent → ash_XXX)
    const socketGroupName = agentUsername.replace(/_agent$/, '');
    const hostHome = process.env['HOME'] || '';
    const interceptorPath = `${hostHome}/.agenshield/lib/interceptor/register.cjs`;
    const nodeBinDest = `${agentHome}/bin/node-bin`;

    const executor = getSystemExecutor();

    log.info(
      { targetId: profile.id, nodePath: integrity.nodePath },
      '[binary-integrity] Drift detected, re-patching Claude node binary',
    );

    // Emit drift event
    emitBinaryDrifted({
      targetId: profile.id,
      expectedHash: integrity.expectedHash,
      currentHash: integrity.currentHash ?? '',
      nodePath: integrity.nodePath,
    }, profile.id);

    // Step 1: Find the real binary (may be the updated one at the original path,
    // or a .real backup from a previous patch)
    const nodePath = integrity.nodePath;
    const realBackup = `${nodePath}.real`;

    // Check if the node at nodePath is a wrapper (text/script) or a real binary
    let sourcePath = nodePath;
    try {
      const fileCheck = await executor.exec(
        `file "${nodePath}" 2>/dev/null`,
        { timeout: 5_000 },
      );
      if (fileCheck.includes('text') || fileCheck.includes('script')) {
        // The wrapper is still in place but the .real was replaced
        // Or Claude replaced both. Check if .real exists and is a real binary.
        const realCheck = await executor.exec(
          `test -f "${realBackup}" && file "${realBackup}" 2>/dev/null || echo "NO_REAL"`,
          { timeout: 5_000 },
        );
        if (!realCheck.includes('NO_REAL') && !realCheck.includes('text') && !realCheck.includes('script')) {
          sourcePath = realBackup;
        }
      }
    } catch {
      // Fall through with sourcePath = nodePath
    }

    // Step 2: Copy the real binary to bin/node-bin
    try {
      await executor.exec(
        [
          `mkdir -p "${agentHome}/bin"`,
          `cp "${sourcePath}" "${nodeBinDest}"`,
          `chown ${agentUsername}:${socketGroupName} "${nodeBinDest}"`,
          `chmod 750 "${nodeBinDest}"`,
        ].join(' && '),
        { timeout: 10_000 },
      );
    } catch (err) {
      log.warn({ err, targetId: profile.id }, '[binary-integrity] Failed to copy node-bin');
      return false;
    }

    // Step 3: Re-apply the wrapper patch
    // Only if enforcement mode includes interceptor
    const enforcementMode = profile.enforcementMode ?? 'both';
    if (enforcementMode !== 'proxy') {
      try {
        // Back up the real binary (if we're patching the original, not the .real)
        const patchScript = `
set -e
if [ ! -f "${realBackup}" ] || file "${realBackup}" 2>/dev/null | grep -q 'text\\|script'; then
  cp "${nodePath}" "${realBackup}"
  chmod 755 "${realBackup}"
fi

cat > "${nodePath}" << 'PATCH_EOF'
#!/bin/bash
# AgenShield node wrapper — injects interceptor into Claude's embedded node
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_REAL="$SCRIPT_DIR/$(basename "$0").real"
if [ -f "${interceptorPath}" ]; then
  export NODE_OPTIONS="\${NODE_OPTIONS:+\$NODE_OPTIONS }--require ${interceptorPath}"
fi
exec "$NODE_REAL" "$@"
PATCH_EOF

chmod 755 "${nodePath}"
chown ${agentUsername}:${socketGroupName} "${nodePath}"
echo "RE_PATCHED"
`;
        const result = await executor.exec(patchScript, { timeout: 10_000 });
        if (!result.includes('RE_PATCHED')) {
          log.warn({ targetId: profile.id }, '[binary-integrity] Patch script did not complete');
        }
      } catch (err) {
        log.warn({ err, targetId: profile.id }, '[binary-integrity] Failed to re-patch wrapper');
        // Non-fatal: node-bin copy was still done
      }
    }

    // Step 4: Compute new hash and update manifest
    const newHash = computeFileHash(sourcePath) ?? integrity.currentHash ?? '';

    // Update the manifest entry for copy_claude_node_bin
    const updatedManifest: InstallManifest = {
      ...manifest,
      entries: manifest.entries.map((entry: ManifestEntry) => {
        if (entry.stepId === 'copy_claude_node_bin') {
          return {
            ...entry,
            outputs: {
              ...entry.outputs,
              nodeBinaryHash: newHash,
              nodeSourcePath: sourcePath,
            },
          };
        }
        return entry;
      }),
    };

    // Persist updated manifest via storage
    try {
      const storage = getStorage();
      storage.profiles.updateManifest(profile.id, updatedManifest);
    } catch (err) {
      log.warn({ err, targetId: profile.id }, '[binary-integrity] Failed to persist updated manifest');
    }

    // Emit re-patched event
    emitRePatched({
      targetId: profile.id,
      previousHash: integrity.expectedHash,
      newHash,
      nodePath: integrity.nodePath,
    }, profile.id);

    log.info(
      { targetId: profile.id, previousHash: integrity.expectedHash, newHash },
      '[binary-integrity] Successfully re-patched Claude node binary',
    );

    return true;
  } catch (err) {
    log.error({ err, targetId: profile.id }, '[binary-integrity] Remediation failed');
    return false;
  } finally {
    remediationInProgress.delete(profile.id);
  }
}
