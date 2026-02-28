/**
 * Install Helpers
 *
 * Shared utilities for preset install() methods. All operations go through
 * the privilege executor (execAsRoot / execAsUser) — no direct sudo calls.
 */

import type { InstallContext } from '../types.js';
import { InstallError, HomebrewInstallError } from '../../errors.js';
import { HOMEBREW_VERSION } from './versions.js';
import { isSEA, getSEALibDir } from '@agenshield/ipc';

/**
 * Execute a command as root, throwing InstallError on failure.
 */
export async function checkedExecAsRoot(
  ctx: InstallContext,
  cmd: string,
  step: string,
  timeout = 120_000,
): Promise<string> {
  const result = await ctx.execAsRoot(cmd, { timeout });
  if (!result.success) {
    const parts: string[] = [];
    if (result.error) parts.push(`stderr: ${result.error.slice(0, 300)}`);
    if (result.output) parts.push(`stdout: ${result.output.slice(0, 300)}`);
    const detail = parts.length > 0 ? parts.join('\n') : `no output (cmd: ${cmd.slice(0, 200)})`;
    throw new InstallError(detail, step);
  }
  return result.output;
}

/**
 * Execute a command as the agent user, throwing InstallError on failure.
 */
export async function checkedExecAsUser(
  ctx: InstallContext,
  cmd: string,
  step: string,
  timeout = 120_000,
): Promise<string> {
  const result = await ctx.execAsUser(cmd, { timeout });
  if (!result.success) {
    const parts: string[] = [];
    if (result.error) parts.push(`stderr: ${result.error.slice(0, 300)}`);
    if (result.output) parts.push(`stdout: ${result.output.slice(0, 300)}`);
    const detail = parts.length > 0 ? parts.join('\n') : `no output (cmd: ${cmd.slice(0, 200)})`;
    throw new InstallError(detail, step);
  }
  return result.output;
}

/**
 * Execute as agent user with direct /bin/bash (no guarded shell).
 * Use for install-time commands that need system PATH (e.g., curl downloads).
 */
export async function checkedExecAsUserDirect(
  ctx: InstallContext,
  cmd: string,
  step: string,
  timeout = 120_000,
): Promise<string> {
  const result = await ctx.execAsUserDirect(cmd, { timeout });
  if (!result.success) {
    const parts: string[] = [];
    if (result.error) parts.push(`stderr: ${result.error.slice(0, 300)}`);
    if (result.output) parts.push(`stdout: ${result.output.slice(0, 300)}`);
    const detail = parts.length > 0 ? parts.join('\n') : `no output (cmd: ${cmd.slice(0, 200)})`;
    throw new InstallError(detail, step);
  }
  return result.output;
}

/**
 * Check if a file exists (via execAsRoot).
 */
export async function fileExists(ctx: InstallContext, filePath: string): Promise<boolean> {
  const result = await ctx.execAsRoot(`test -e "${filePath}" && echo EXISTS || echo MISSING`, { timeout: 5_000 });
  return result.success && result.output.trim() === 'EXISTS';
}

/**
 * Build a shell command that sources NVM and runs an inner command.
 * Only needed for steps that require the full `nvm` function (e.g., `nvm install`).
 * For other steps, the login shell's .zshenv fast-PATH already sets up node/npm/npx.
 */
export function nvmCommand(agentHome: string, innerCmd: string): string {
  const nvmDir = `${agentHome}/.nvm`;
  return `source "${nvmDir}/nvm.sh" && ${innerCmd}`;
}

/**
 * Simple delay helper for retry backoff.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const HOMEBREW_MAX_ATTEMPTS = 3;
const HOMEBREW_BACKOFF_MS = 5_000;

/**
 * Install Homebrew to $HOME/homebrew (idempotent — skips if already present).
 * Retries up to 3 times with 5s backoff to handle transient GitHub failures.
 */
export async function installHomebrew(ctx: InstallContext): Promise<void> {
  ctx.onLog('Checking for existing Homebrew installation...');

  // Inline fileExists check — avoid a separate exec roundtrip
  const checkResult = await ctx.execAsRoot(
    `test -x "${ctx.agentHome}/homebrew/bin/brew" && echo SKIP || echo PROCEED`,
    { timeout: 5_000 },
  );
  if (checkResult.success && checkResult.output.trim() === 'SKIP') {
    ctx.onLog('Homebrew already installed, skipping.');
    return;
  }

  ctx.onLog('Installing Homebrew to agent home...');

  const errors: string[] = [];

  for (let attempt = 1; attempt <= HOMEBREW_MAX_ATTEMPTS; attempt++) {
    try {
      // Clean up any partial install from a previous attempt
      await checkedExecAsRoot(ctx, [
        `rm -rf "${ctx.agentHome}/homebrew"`,
        `mkdir -p "${ctx.agentHome}/homebrew"`,
        `chown ${ctx.agentUsername}:${ctx.socketGroupName} "${ctx.agentHome}/homebrew"`,
      ].join(' && '), 'homebrew_dir', 10_000);

      // Phase 1: Download and extract — use direct shell (no guarded shell)
      // so system curl/tar are available before the broker is running
      await checkedExecAsUserDirect(ctx, [
        `cd "${ctx.agentHome}/homebrew"`,
        'set -o pipefail',
        `curl -fsSL --retry 3 --retry-delay 2 https://github.com/Homebrew/brew/archive/refs/tags/${HOMEBREW_VERSION}.tar.gz | tar xz --strip 1`,
      ].join(' && '), 'homebrew_download', 120_000);

      // Phase 2: Verify — suppress auto-update to avoid network calls.
      // Redirect stderr to stdout (2>&1) so the privilege helper captures both
      // streams — without this, brew errors go to stderr and are lost.
      await checkedExecAsUserDirect(ctx, [
        'HOMEBREW_NO_AUTO_UPDATE=1',
        'HOMEBREW_NO_INSTALL_FROM_API=1',
        `"${ctx.agentHome}/homebrew/bin/brew" --version 2>&1`,
      ].join(' '), 'homebrew_verify', 30_000);

      ctx.onLog('Homebrew installed successfully.');
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`attempt ${attempt}: ${msg}`);

      if (attempt < HOMEBREW_MAX_ATTEMPTS) {
        ctx.onLog(`Homebrew install attempt ${attempt}/${HOMEBREW_MAX_ATTEMPTS} failed, retrying in ${HOMEBREW_BACKOFF_MS / 1000}s...`);
        await delay(HOMEBREW_BACKOFF_MS);
      }
    }
  }

  throw new HomebrewInstallError(
    `Failed after ${HOMEBREW_MAX_ATTEMPTS} attempts:\n${errors.join('\n')}`,
  );
}


/**
 * Snapshot of the host user's shell config file for restore-on-tamper.
 */
export interface HostShellConfigBackup {
  path: string;
  content: string;
}

/**
 * Save a snapshot of the host user's .zshrc (and .bashrc) so we can restore
 * them if an external installer (NVM, OpenClaw curl|bash) modifies them.
 */
export async function saveHostShellConfig(
  ctx: InstallContext,
): Promise<HostShellConfigBackup[]> {
  const hostHome = `/Users/${ctx.hostUsername}`;
  const candidates = [`${hostHome}/.zshrc`, `${hostHome}/.bashrc`];
  const backups: HostShellConfigBackup[] = [];

  for (const filePath of candidates) {
    try {
      const result = await ctx.execAsRoot(
        `cat "${filePath}" 2>/dev/null`,
        { timeout: 5_000 },
      );
      if (result.success && result.output != null) {
        backups.push({ path: filePath, content: result.output });
      }
    } catch {
      // File doesn't exist — nothing to protect
    }
  }

  return backups;
}

/**
 * Check whether the host's shell config files were modified since the snapshot
 * and restore them if so. Logs a warning when a restore occurs.
 */
export async function restoreHostShellConfig(
  ctx: InstallContext,
  backups: HostShellConfigBackup[],
): Promise<void> {
  for (const backup of backups) {
    try {
      const current = await ctx.execAsRoot(
        `cat "${backup.path}" 2>/dev/null`,
        { timeout: 5_000 },
      );
      if (current.success && current.output !== backup.content) {
        ctx.onLog(`Warning: Host ${backup.path} was modified by installer — restoring original`);
        await ctx.execAsRoot(
          `cat > "${backup.path}" << 'ZSHRC_RESTORE_EOF'\n${backup.content}\nZSHRC_RESTORE_EOF`,
          { timeout: 10_000 },
        );
      }
    } catch {
      // Best-effort restore
    }
  }
}

/**
 * Copy the NVM node binary to per-target $agentHome/bin/node-bin.
 * Each target gets its own copy — no shared host-level binary.
 */
export async function copyNodeBinary(ctx: InstallContext): Promise<void> {
  const dest = `${ctx.agentHome}/bin/node-bin`;
  ctx.onLog(`Copying node binary to ${dest}...`);

  const nodePath = (await checkedExecAsUser(ctx, 'which node', 'node_path', 15_000)).trim();

  await checkedExecAsRoot(ctx, [
    `mkdir -p "${ctx.agentHome}/bin"`,
    `cp "${nodePath}" "${dest}"`,
    `chgrp ${ctx.socketGroupName} "${dest}"`,
    `chmod 750 "${dest}"`,
  ].join(' && '), 'copy_node_binary', 15_000);

  ctx.onLog(`Node binary copied to ${dest}.`);
}

/**
 * Patch the NVM node binary with the interceptor wrapper.
 */
export async function patchNvmNode(ctx: InstallContext): Promise<void> {
  ctx.onLog('Patching NVM node with interceptor wrapper...');

  const nodePath = (await checkedExecAsUser(ctx, 'which node', 'nvm_node_path', 15_000)).trim();

  // Back up the real node binary
  await checkedExecAsRoot(ctx, [
    `cp "${nodePath}" "${nodePath}.real"`,
    `chown ${ctx.agentUsername}:${ctx.socketGroupName} "${nodePath}.real"`,
    `chmod 755 "${nodePath}.real"`,
  ].join(' && '), 'node_backup', 15_000);

  // Write the interceptor wrapper (includes AGENSHIELD_NODE_BIN for sync-client)
  let interceptorPath: string;
  if (isSEA()) {
    const libDir = getSEALibDir();
    interceptorPath = libDir
      ? `${libDir}/interceptor/register.cjs`
      : `${ctx.hostHome}/.agenshield/lib/interceptor/register.cjs`;
  } else {
    interceptorPath = `${ctx.hostHome}/.agenshield/lib/interceptor/register.cjs`;
  }
  const wrapper = `#!/bin/bash
# AgenShield Node.js Interceptor Wrapper
export AGENSHIELD_NODE_BIN="${ctx.agentHome}/bin/node-bin"
export AGENSHIELD_PROFILE_ID="${ctx.agentUsername}"
export NODE_OPTIONS="--require ${interceptorPath} \${NODE_OPTIONS:-}"
exec "${nodePath}.real" "$@"
`;

  // Heredoc write + perms in a single call (newline-separated so EOF terminator stays on its own line)
  await checkedExecAsRoot(ctx,
    `cat > "${nodePath}" << 'NODEWRAPPER_EOF'\n${wrapper}\nNODEWRAPPER_EOF\nchmod 755 "${nodePath}" && chown ${ctx.agentUsername}:${ctx.socketGroupName} "${nodePath}"`,
    'node_patch', 15_000);

  ctx.onLog('NVM node patched with interceptor wrapper.');
}
