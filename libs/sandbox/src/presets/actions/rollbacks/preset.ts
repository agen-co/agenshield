/**
 * Preset Rollback Handlers
 *
 * Rollback handlers for preset-specific pipeline steps
 * (homebrew, nvm, node, openclaw, claude, gateway plist, config, patch).
 */

import { registerRollback } from '../rollback-registry.js';

// ── Homebrew ─────────────────────────────────────────────────

registerRollback('install_homebrew', async (ctx, entry) => {
  const agentHome = entry.outputs['agentHome'] || ctx.agentHome;
  ctx.onLog(`Rollback: removing homebrew from ${agentHome}/homebrew`);
  await ctx.execAsRoot(`rm -rf "${agentHome}/homebrew" 2>/dev/null; true`, { timeout: 30_000 });
});

// ── NVM ──────────────────────────────────────────────────────

registerRollback('install_nvm', async (ctx, entry) => {
  const agentHome = entry.outputs['agentHome'] || ctx.agentHome;
  ctx.onLog(`Rollback: removing NVM from ${agentHome}/.nvm`);
  await ctx.execAsRoot(`rm -rf "${agentHome}/.nvm" 2>/dev/null; true`, { timeout: 30_000 });
});

// ── Copy node binary ─────────────────────────────────────────

registerRollback('copy_node_binary', async (ctx, entry) => {
  const destPath = entry.outputs['destPath'];
  if (!destPath) return;
  ctx.onLog(`Rollback: removing copied node binary at ${destPath}`);
  await ctx.execAsRoot(`rm -f "${destPath}" 2>/dev/null; true`, { timeout: 5_000 });
});

// ── Install OpenClaw ─────────────────────────────────────────

registerRollback('install_openclaw', async (ctx) => {
  // OpenClaw is installed under agent home's NVM — handled by create_directories rollback
  ctx.onLog('Rollback: install_openclaw — covered by home directory cleanup');
});

// ── Install Claude ───────────────────────────────────────────

registerRollback('install_claude', async (ctx) => {
  // Claude is installed under agent home — handled by create_directories rollback
  ctx.onLog('Rollback: install_claude — covered by home directory cleanup');
});

// ── Write gateway plist ──────────────────────────────────────

registerRollback('write_gateway_plist', async (ctx, entry) => {
  const gatewayPlistPath = entry.outputs['gatewayPlistPath'];
  if (!gatewayPlistPath) return;
  const label = gatewayPlistPath.replace('/Library/LaunchDaemons/', '').replace('.plist', '');
  ctx.onLog(`Rollback: removing gateway plist ${gatewayPlistPath}`);
  await ctx.execAsRoot(
    `launchctl bootout system/${label} 2>/dev/null; rm -f "${gatewayPlistPath}" 2>/dev/null; true`,
    { timeout: 15_000 },
  );
});

// ── Copy config ──────────────────────────────────────────────

registerRollback('copy_config', async (ctx, entry) => {
  const configDir = entry.outputs['configDir'];
  if (!configDir) return;
  ctx.onLog(`Rollback: removing copied config at ${configDir}`);
  await ctx.execAsRoot(`rm -rf "${configDir}" 2>/dev/null; true`, { timeout: 10_000 });
});

// ── Rewrite config paths ────────────────────────────────────

registerRollback('rewrite_config_paths', async (ctx) => {
  // Config rewrite is rolled back by copy_config removal
  ctx.onLog('Rollback: rewrite_config_paths — covered by copy_config rollback');
});

// ── Patch NVM node ───────────────────────────────────────────

registerRollback('patch_node', async (ctx, entry) => {
  const agentHome = entry.outputs['agentHome'] || ctx.agentHome;
  if (!agentHome) return;
  // Find and restore any .real backup under NVM
  ctx.onLog(`Rollback: restoring patched node binaries under ${agentHome}/.nvm`);
  await ctx.execAsRoot(
    `find "${agentHome}/.nvm" -name "node.real" 2>/dev/null | while read f; do mv "$f" "\${f%.real}"; done; true`,
    { timeout: 10_000 },
  );
});
