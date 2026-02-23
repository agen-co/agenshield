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

  const brewExists = await fileExists(ctx, `${ctx.agentHome}/homebrew/bin/brew`);
  if (brewExists) {
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

    // Download and extract Homebrew (no-install method — just extract tarball)
    await checkedExecAsUser(ctx, [
      `cd "${ctx.agentHome}/homebrew"`,
      'curl -fsSL https://github.com/Homebrew/brew/tarball/master | tar xz --strip 1',
    ].join(' && '), 'homebrew_download', 120_000);

    // Verify
    await checkedExecAsUser(ctx,
      `"${ctx.agentHome}/homebrew/bin/brew" --version`,
      'homebrew_verify', 15_000,
    );

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

  const nvmExists = await fileExists(ctx, `${ctx.agentHome}/.nvm/nvm.sh`);
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

    ctx.onLog(`Installing Node.js v${nodeVersion} via NVM...`);
    await checkedExecAsUser(ctx,
      nvmCommand(ctx.agentHome, `nvm install ${nodeVersion} && nvm alias default ${nodeVersion}`),
      'node_install', 120_000,
    );

    // Verify
    const nodeVer = await checkedExecAsUser(ctx,
      nvmCommand(ctx.agentHome, 'node --version'),
      'node_verify', 15_000,
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
 * Copy the NVM node binary to /opt/agenshield/bin/node-bin for use by interceptor.
 */
export async function copyNodeBinary(ctx: InstallContext): Promise<void> {
  ctx.onLog('Copying node binary to /opt/agenshield/bin/node-bin...');

  const nodePath = await checkedExecAsUser(ctx,
    nvmCommand(ctx.agentHome, 'which node'),
    'node_path', 15_000,
  );

  await checkedExecAsRoot(ctx, [
    'mkdir -p /opt/agenshield/bin',
    `cp "${nodePath.trim()}" /opt/agenshield/bin/node-bin`,
    `chgrp ${ctx.socketGroupName} /opt/agenshield/bin/node-bin`,
    'chmod 750 /opt/agenshield/bin/node-bin',
  ].join(' && '), 'copy_node_binary', 15_000);

  ctx.onLog('Node binary copied to /opt/agenshield/bin/node-bin.');
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
  const wrapper = `#!/bin/bash
# AgenShield Node.js Interceptor Wrapper
export NODE_OPTIONS="--require /opt/agenshield/lib/interceptor.js \${NODE_OPTIONS:-}"
exec "${trimmedPath}.real" "$@"
`;

  await checkedExecAsRoot(ctx, [
    `cat > "${trimmedPath}" << 'NODEWRAPPER_EOF'\n${wrapper}\nNODEWRAPPER_EOF`,
    `chmod 755 "${trimmedPath}"`,
    `chown ${ctx.agentUsername}:${ctx.socketGroupName} "${trimmedPath}"`,
  ].join(' && '), 'node_patch', 15_000);

  ctx.onLog('NVM node patched with interceptor wrapper.');
}
