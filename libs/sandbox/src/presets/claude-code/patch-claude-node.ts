/**
 * Patch Claude Embedded Node Step (Optional — Defense in Depth)
 *
 * Claude Code bundles its own Node.js binary which bypasses NVM and the
 * interceptor injected via NODE_OPTIONS. This step finds the embedded node
 * binary, backs it up, and installs a wrapper that injects the interceptor.
 *
 * This is complementary to the proxy-based approach (HTTP_PROXY/HTTPS_PROXY).
 * The proxy catches all outbound HTTP traffic; the node patch additionally
 * ensures the interceptor's exec/spawn hooks are active for child processes.
 *
 * Fragile across Claude Code updates — the binary path may change. The step
 * is best-effort and non-fatal.
 */

import type { InstallStep } from '../types.js';

export const patchClaudeNodeStep: InstallStep = {
  id: 'patch_claude_node',
  name: 'Patch embedded Node.js',
  description: 'Wrap Claude Code\'s bundled Node.js to inject interceptor',
  phase: 9,
  progressMessage: 'Patching embedded Node.js binary...',
  runsAs: 'root',
  timeout: 20_000,
  weight: 2,

  skip(ctx) {
    if (process.platform !== 'darwin') return true;
    // In proxy-only mode, interceptor patching is unnecessary
    if (ctx.enforcementMode === 'proxy') return true;
    return false;
  },

  async run(ctx) {
    // Find Claude's embedded node binary
    const findResult = await ctx.execAsRoot(
      `find "${ctx.agentHome}/.local" -name "node" -type f -perm +111 2>/dev/null | head -5`,
      { timeout: 10_000 },
    );

    const candidates = (findResult.output ?? '').trim().split('\n').filter(Boolean);

    if (candidates.length === 0) {
      ctx.onLog?.('No embedded Node.js binary found in ~/.local — skipping patch');
      return { changed: false, warnings: ['No embedded node binary found'] };
    }

    // Resolve the interceptor path (same as what wrappers use)
    const hostHome = ctx.hostHome || process.env['HOME'] || '';
    const interceptorPath = `${hostHome}/.agenshield/lib/interceptor/register.cjs`;

    let patched = 0;

    for (const nodePath of candidates) {
      // Skip if already patched (is a text wrapper, not a real binary)
      const checkResult = await ctx.execAsRoot(
        `file "${nodePath}" 2>/dev/null`,
        { timeout: 5_000 },
      );
      if (checkResult.output?.includes('text') || checkResult.output?.includes('script')) {
        ctx.onLog?.(`Skipping already-patched node at ${nodePath}`);
        continue;
      }

      const backupPath = `${nodePath}.real`;

      const socketPath = `${ctx.agentHome}/.agenshield/run/agenshield.sock`;

      const script = `
set -e

# Back up the real binary
if [ ! -f "${backupPath}" ]; then
  cp "${nodePath}" "${backupPath}"
  chmod 755 "${backupPath}"
fi

# Write wrapper script
cat > "${nodePath}" << 'PATCH_EOF'
#!/bin/bash
# AgenShield node wrapper — injects interceptor into Claude's embedded node
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_REAL="$SCRIPT_DIR/$(basename "$0").real"
if [ -f "${interceptorPath}" ]; then
  export NODE_OPTIONS="\${NODE_OPTIONS:+\$NODE_OPTIONS }--require ${interceptorPath}"
fi
export AGENSHIELD_NODE_BIN="${ctx.agentHome}/bin/node-bin"
export AGENSHIELD_SOCKET="${socketPath}"
export AGENSHIELD_HTTP_PORT="5201"
export AGENSHIELD_INTERCEPT_EXEC=true
export AGENSHIELD_INTERCEPT_HTTP=true
export AGENSHIELD_INTERCEPT_FETCH=true
export AGENSHIELD_INTERCEPT_WS=true
exec "$NODE_REAL" "$@"
PATCH_EOF

chmod 755 "${nodePath}"
chown ${ctx.agentUsername}:${ctx.socketGroupName} "${nodePath}"
echo "PATCHED:${nodePath}"
`;

      const patchResult = await ctx.execAsRoot(script, { timeout: 10_000 });

      if (patchResult.output?.includes('PATCHED:')) {
        ctx.onLog?.(`Patched embedded node at ${nodePath}`);
        patched++;
      }
    }

    if (patched > 0) {
      ctx.onLog?.(`Patched ${patched} embedded Node.js binary(ies)`);
      return { changed: true };
    }

    return { changed: false, warnings: ['No embedded node binaries could be patched'] };
  },
};
