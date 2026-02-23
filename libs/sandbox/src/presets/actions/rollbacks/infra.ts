/**
 * Infrastructure Rollback Handlers
 *
 * Rollback handlers for infrastructure steps (users, groups, directories,
 * shell, wrappers, PATH router, seatbelt, sudoers, broker, gateway).
 */

import { registerRollback } from '../rollback-registry.js';

// ── Socket group ─────────────────────────────────────────────

registerRollback('create_socket_group', async (ctx, entry) => {
  const groupName = entry.outputs['groupName'];
  if (!groupName) return;
  ctx.onLog(`Rollback: deleting socket group ${groupName}`);
  await ctx.execAsRoot(`dscl . -delete /Groups/${groupName} 2>/dev/null; true`, { timeout: 10_000 });
});

// ── Agent user ───────────────────────────────────────────────

registerRollback('create_agent_user', async (ctx, entry) => {
  const username = entry.outputs['agentUsername'] || ctx.agentUsername;
  if (!username) return;
  ctx.onLog(`Rollback: deleting agent user ${username}`);
  await ctx.execAsRoot(
    `ps -u $(id -u ${username} 2>/dev/null) -o pid= 2>/dev/null | xargs kill 2>/dev/null; ` +
    `sleep 1; ps -u $(id -u ${username} 2>/dev/null) -o pid= 2>/dev/null | xargs kill -9 2>/dev/null; ` +
    `dscl . -delete /Users/${username} 2>/dev/null; true`,
    { timeout: 15_000 },
  );
});

// ── Broker user ──────────────────────────────────────────────

registerRollback('create_broker_user', async (ctx, entry) => {
  const username = entry.outputs['brokerUsername'];
  if (!username) return;
  ctx.onLog(`Rollback: deleting broker user ${username}`);
  await ctx.execAsRoot(
    `ps -u $(id -u ${username} 2>/dev/null) -o pid= 2>/dev/null | xargs kill 2>/dev/null; ` +
    `sleep 1; ps -u $(id -u ${username} 2>/dev/null) -o pid= 2>/dev/null | xargs kill -9 2>/dev/null; ` +
    `dscl . -delete /Users/${username} 2>/dev/null; true`,
    { timeout: 15_000 },
  );
});

// ── Directories ──────────────────────────────────────────────

registerRollback('create_directories', async (ctx, entry) => {
  const agentHome = entry.outputs['agentHome'] || ctx.agentHome;
  if (!agentHome) return;
  ctx.onLog(`Rollback: removing agent home ${agentHome}`);
  await ctx.execAsRoot(`rm -rf "${agentHome}"`, { timeout: 60_000 });
});

// ── Guarded shell ────────────────────────────────────────────

registerRollback('install_guarded_shell', async (ctx, entry) => {
  const shellPath = entry.outputs['shellPath'];
  if (!shellPath) return;
  ctx.onLog(`Rollback: removing guarded shell from /etc/shells`);
  await ctx.execAsRoot(
    `sed -i '' '\\|${shellPath}|d' /etc/shells 2>/dev/null; rm -f "${shellPath}" 2>/dev/null; true`,
    { timeout: 10_000 },
  );
});

// ── PATH registry ────────────────────────────────────────────

registerRollback('install_path_registry', async (ctx, entry) => {
  const registryPath = entry.outputs['registryPath'];
  if (!registryPath) return;
  ctx.onLog(`Rollback: cleaning PATH registry`);
  // Remove the registry file if it exists (full cleanup; partial removal
  // would require reading + rewriting the JSON which the full unshield does)
  await ctx.execAsRoot(`rm -f "${registryPath}" 2>/dev/null; true`, { timeout: 5_000 });
});

// ── PATH router ──────────────────────────────────────────────

registerRollback('install_path_router', async (ctx, entry) => {
  const binName = entry.outputs['binName'];
  if (!binName) return;
  ctx.onLog(`Rollback: removing PATH router for ${binName}`);
  const routerPath = `/usr/local/bin/${binName}`;
  // Restore from backup if it exists, otherwise just remove
  await ctx.execAsRoot(
    `if [ -f "${routerPath}.agenshield-backup" ]; then mv "${routerPath}.agenshield-backup" "${routerPath}"; ` +
    `else rm -f "${routerPath}"; fi; true`,
    { timeout: 10_000 },
  );
});

// ── Seatbelt ─────────────────────────────────────────────────

registerRollback('generate_seatbelt', async (ctx, entry) => {
  const seatbeltPath = entry.outputs['seatbeltPath'];
  if (!seatbeltPath) return;
  ctx.onLog(`Rollback: removing seatbelt profile`);
  await ctx.execAsRoot(`rm -f "${seatbeltPath}" 2>/dev/null; true`, { timeout: 5_000 });
});

// ── Sudoers ──────────────────────────────────────────────────

registerRollback('install_sudoers', async (ctx, entry) => {
  const sudoersPath = entry.outputs['sudoersPath'];
  if (!sudoersPath) return;
  ctx.onLog(`Rollback: removing sudoers rules`);
  await ctx.execAsRoot(`rm -f "${sudoersPath}" 2>/dev/null; true`, { timeout: 5_000 });
});

// ── Broker daemon ────────────────────────────────────────────

registerRollback('install_broker_daemon', async (ctx, entry) => {
  const brokerLabel = entry.outputs['brokerLabel'];
  const plistPath = entry.outputs['plistPath'];
  if (!brokerLabel) return;
  ctx.onLog(`Rollback: unloading broker daemon ${brokerLabel}`);
  await ctx.execAsRoot(
    `launchctl bootout system/${brokerLabel} 2>/dev/null; rm -f "${plistPath}" 2>/dev/null; true`,
    { timeout: 15_000 },
  );
});

// ── Gateway ──────────────────────────────────────────────────

registerRollback('start_gateway', async (ctx, entry) => {
  const gatewayLabel = entry.outputs['gatewayLabel'];
  const gatewayPlistPath = entry.outputs['gatewayPlistPath'];
  if (!gatewayLabel) return;
  ctx.onLog(`Rollback: unloading gateway ${gatewayLabel}`);
  await ctx.execAsRoot(
    `launchctl bootout system/${gatewayLabel} 2>/dev/null; rm -f "${gatewayPlistPath}" 2>/dev/null; true`,
    { timeout: 15_000 },
  );
});
