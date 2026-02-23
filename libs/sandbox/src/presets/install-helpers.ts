/**
 * Install Helpers
 *
 * Shared utilities for preset install() methods. All operations go through
 * the privilege executor (execAsRoot / execAsUser) — no direct sudo calls.
 */

import type { InstallContext } from './types.js';
import { InstallError, HomebrewInstallError, NvmInstallError } from '../errors.js';

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
    throw new InstallError(
      result.error || `Command failed at step "${step}": ${cmd.slice(0, 200)}`,
      step,
    );
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
    throw new InstallError(
      result.error || `Command failed at step "${step}": ${cmd.slice(0, 200)}`,
      step,
    );
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
 * Build shell exports that configure Homebrew to use the agent-local prefix.
 * Without these, `brew` falls back to /opt/homebrew which the agent user
 * has no write access to.
 */
export function brewEnv(agentHome: string): string {
  return [
    `export HOMEBREW_PREFIX="${agentHome}/homebrew"`,
    `export HOMEBREW_CELLAR="${agentHome}/homebrew/Cellar"`,
    `export HOMEBREW_REPOSITORY="${agentHome}/homebrew"`,
    `export PATH="${agentHome}/homebrew/bin:${agentHome}/homebrew/sbin:$PATH"`,
  ].join(' && ');
}

/**
 * Build a shell command that sources NVM and runs an inner command.
 */
export function nvmCommand(agentHome: string, innerCmd: string): string {
  return [
    `export HOME="${agentHome}"`,
    brewEnv(agentHome),
    `export NVM_DIR="${agentHome}/.nvm"`,
    `source "${agentHome}/.nvm/nvm.sh"`,
    innerCmd,
  ].join(' && ');
}

/**
 * Install Homebrew to $HOME/homebrew (idempotent — skips if already present).
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

  try {
    // Create homebrew directory
    await checkedExecAsRoot(ctx, [
      `mkdir -p "${ctx.agentHome}/homebrew"`,
      `chown ${ctx.agentUsername}:${ctx.socketGroupName} "${ctx.agentHome}/homebrew"`,
    ].join(' && '), 'homebrew_dir', 10_000);

    // Download, extract, and verify Homebrew in a single call
    await checkedExecAsUser(ctx, [
      `cd "${ctx.agentHome}/homebrew"`,
      'curl -fsSL https://github.com/Homebrew/brew/tarball/master | tar xz --strip 1',
      `"${ctx.agentHome}/homebrew/bin/brew" --version`,
    ].join(' && '), 'homebrew_download', 120_000);

    ctx.onLog('Homebrew installed successfully.');
  } catch (err) {
    if (err instanceof InstallError) {
      throw new HomebrewInstallError(err.message);
    }
    throw err;
  }
}

/**
 * Install NVM and Node.js (idempotent — skips if already present).
 */
export async function installNvmAndNode(
  ctx: InstallContext,
  nodeVersion = '24',
): Promise<void> {
  ctx.onLog('Checking for existing NVM installation...');

  // Inline fileExists + node version check — single exec roundtrip
  const checkResult = await ctx.execAsUser(
    `test -s "${ctx.agentHome}/.nvm/nvm.sh" && echo NVM_EXISTS || echo NVM_MISSING`,
    { timeout: 5_000 },
  );
  const nvmExists = checkResult.success && checkResult.output.trim() === 'NVM_EXISTS';

  if (nvmExists) {
    // Check if the target node version is already installed
    const nodeCheck = await ctx.execAsUser(
      nvmCommand(ctx.agentHome, `nvm ls ${nodeVersion} 2>/dev/null | grep -q "${nodeVersion}" && echo INSTALLED || echo MISSING`),
      { timeout: 15_000 },
    );
    if (nodeCheck.success && nodeCheck.output.trim() === 'INSTALLED') {
      ctx.onLog(`NVM and Node.js ${nodeVersion} already installed, skipping.`);
      return;
    }
  }

  try {
    if (!nvmExists) {
      ctx.onLog('Installing NVM...');
      await checkedExecAsUser(ctx, [
        `export HOME="${ctx.agentHome}"`,
        'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash',
      ].join(' && '), 'nvm_install', 60_000);
    }

    // Install Node.js and verify in a single call
    ctx.onLog(`Installing Node.js v${nodeVersion} via NVM...`);
    const nodeVer = await checkedExecAsUser(ctx,
      nvmCommand(ctx.agentHome, `nvm install ${nodeVersion} && nvm alias default ${nodeVersion} && node --version`),
      'node_install', 120_000,
    );
    ctx.onLog(`Node.js ${nodeVer.trim()} installed successfully.`);
  } catch (err) {
    if (err instanceof InstallError) {
      throw new NvmInstallError(err.message);
    }
    throw err;
  }
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
 * Copy the NVM node binary to per-target $agentHome/bin/node-bin and
 * also to $hostHome/.agenshield/bin/node-bin (shared — broker needs it).
 */
export async function copyNodeBinary(ctx: InstallContext): Promise<void> {
  const perTargetDest = `${ctx.agentHome}/bin/node-bin`;
  const sharedBinDir = `${ctx.hostHome}/.agenshield/bin`;
  const sharedDest = `${sharedBinDir}/node-bin`;
  ctx.onLog(`Copying node binary to ${perTargetDest} and ${sharedDest}...`);

  const nodePath = await checkedExecAsUser(ctx,
    nvmCommand(ctx.agentHome, 'which node'),
    'node_path', 15_000,
  );

  const trimmedNodePath = nodePath.trim();

  // Per-target + shared copies are independent — run in parallel
  await Promise.all([
    // Per-target copy (primary — used by interceptor and wrappers)
    checkedExecAsRoot(ctx, [
      `mkdir -p "${ctx.agentHome}/bin"`,
      `cp "${trimmedNodePath}" "${perTargetDest}"`,
      `chgrp ${ctx.socketGroupName} "${perTargetDest}"`,
      `chmod 750 "${perTargetDest}"`,
    ].join(' && '), 'copy_node_binary', 15_000),

    // Host-level shared copy for broker (idempotent — skip if already exists)
    checkedExecAsRoot(ctx, [
      `mkdir -p "${sharedBinDir}"`,
      `test -f "${sharedDest}" || cp "${trimmedNodePath}" "${sharedDest}"`,
      `chgrp wheel "${sharedDest}" 2>/dev/null; chmod 755 "${sharedDest}" 2>/dev/null; true`,
    ].join(' && '), 'copy_node_binary_system', 15_000),
  ]);

  ctx.onLog(`Node binary copied to ${perTargetDest} and ${sharedDest}.`);
}

/**
 * Patch the NVM node binary with the interceptor wrapper.
 */
export async function patchNvmNode(ctx: InstallContext): Promise<void> {
  ctx.onLog('Patching NVM node with interceptor wrapper...');

  const nodePath = await checkedExecAsUser(ctx,
    nvmCommand(ctx.agentHome, 'which node'),
    'nvm_node_path', 15_000,
  );
  const trimmedPath = nodePath.trim();

  // Back up the real node binary
  await checkedExecAsRoot(ctx, [
    `cp "${trimmedPath}" "${trimmedPath}.real"`,
    `chown ${ctx.agentUsername}:${ctx.socketGroupName} "${trimmedPath}.real"`,
    `chmod 755 "${trimmedPath}.real"`,
  ].join(' && '), 'node_backup', 15_000);

  // Write the interceptor wrapper
  const interceptorPath = `${ctx.hostHome}/.agenshield/lib/interceptor/register.cjs`;
  const wrapper = `#!/bin/bash
# AgenShield Node.js Interceptor Wrapper
export NODE_OPTIONS="--require ${interceptorPath} \${NODE_OPTIONS:-}"
exec "${trimmedPath}.real" "$@"
`;

  // Heredoc write + perms in a single call (newline-separated so EOF terminator stays on its own line)
  await checkedExecAsRoot(ctx,
    `cat > "${trimmedPath}" << 'NODEWRAPPER_EOF'\n${wrapper}\nNODEWRAPPER_EOF\nchmod 755 "${trimmedPath}" && chown ${ctx.agentUsername}:${ctx.socketGroupName} "${trimmedPath}"`,
    'node_patch', 15_000);

  ctx.onLog('NVM node patched with interceptor wrapper.');
}
