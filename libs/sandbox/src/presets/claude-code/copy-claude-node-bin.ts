/**
 * Copy Claude Node Binary Step
 *
 * The shield-client and wrapper scripts (curl, git, etc.) need a stable
 * `node-bin` at `$agentHome/bin/node-bin` to function.
 *
 * This step tries two approaches in order:
 *
 * 1. **Embedded Node.js** — Older Claude Code versions (< v2.1.63) bundle a
 *    Node.js binary under `~/.local/`. We locate it the same way
 *    `patchClaudeNodeStep` does and copy it to `bin/node-bin`.
 *
 * 2. **System Node.js fallback** — Claude Code v2.1.63+ ships as a single
 *    native binary with no embedded Node.js. In this case we fall back to
 *    the host's system `node` (via `which node`), the same strategy the
 *    shared `copyNodeBinaryStep` uses for non-Claude targets.
 *
 * Must run AFTER `installClaudeCodeStep` and `verifyClaudeBinaryStep`.
 * If run after patching, the step prefers the `.real` backup of the embedded node.
 *
 * Fatal on failure — without node-bin, shield-client and all wrappers are broken.
 */

import type { InstallStep } from '../types.js';

export const copyClaudeNodeBinStep: InstallStep = {
  id: 'copy_claude_node_bin',
  name: 'Copy Claude node binary',
  description: 'Copy Claude Code\'s embedded Node.js to bin/node-bin for shield-client',
  phase: 8,
  progressMessage: 'Copying Node.js binary for shield-client...',
  runsAs: 'root',
  timeout: 20_000,
  weight: 3,

  async check(ctx) {
    // Satisfied if node-bin exists and is executable
    const result = await ctx.execAsRoot(
      `test -x "${ctx.agentHome}/bin/node-bin" && echo "EXISTS"`,
      { timeout: 5_000 },
    );
    return result.output?.includes('EXISTS') ? 'satisfied' : 'needed';
  },

  async run(ctx) {
    const dest = `${ctx.agentHome}/bin/node-bin`;

    // Find Claude's embedded node binary (same search as patchClaudeNodeStep)
    const findResult = await ctx.execAsRoot(
      `find "${ctx.agentHome}/.local" -name "node" -type f -perm +111 2>/dev/null | head -5`,
      { timeout: 10_000 },
    );

    const candidates = (findResult.output ?? '').trim().split('\n').filter(Boolean);

    // Find a real binary (not a text/script wrapper) among embedded candidates.
    // Prefer .real backup if it exists (already-patched scenario).
    let sourcePath: string | undefined;

    for (const candidate of candidates) {
      const realPath = `${candidate}.real`;

      // Check if .real backup exists (from a previous patchClaudeNodeStep run)
      const realCheck = await ctx.execAsRoot(
        `test -f "${realPath}" && file "${realPath}" 2>/dev/null`,
        { timeout: 5_000 },
      );
      if (realCheck.success && realCheck.output && !realCheck.output.includes('text') && !realCheck.output.includes('script')) {
        sourcePath = realPath;
        ctx.onLog?.(`Using patched backup at ${realPath}`);
        break;
      }

      // Check if the candidate itself is a real binary
      const fileCheck = await ctx.execAsRoot(
        `file "${candidate}" 2>/dev/null`,
        { timeout: 5_000 },
      );
      if (fileCheck.output?.includes('text') || fileCheck.output?.includes('script')) {
        ctx.onLog?.(`Skipping wrapper script at ${candidate}`);
        continue;
      }

      sourcePath = candidate;
      break;
    }

    // Claude Code v2.1.63+ is a native binary — no embedded Node.js.
    // Fall back to the host's system node (same strategy as copyNodeBinaryStep).
    if (!sourcePath) {
      ctx.onLog?.(
        candidates.length === 0
          ? 'No embedded Node.js in ~/.local — Claude Code appears to be a native binary'
          : 'All embedded Node.js candidates are wrappers — no real binary found',
      );
      ctx.onLog?.('Falling back to host system Node.js...');

      const nodeResult = await ctx.execAsRoot(
        `which node 2>/dev/null || command -v node 2>/dev/null`,
        { timeout: 10_000 },
      );
      const systemNode = (nodeResult.output ?? '').trim().split('\n')[0];

      if (!systemNode || !nodeResult.success) {
        throw new Error(
          'No embedded Node.js binary found in ~/.local and no system node available — ' +
          'shield-client requires node-bin. Install Node.js on the host.',
        );
      }

      // Verify it's a real binary, not a wrapper/shim (e.g. NVM)
      const fileCheck = await ctx.execAsRoot(
        `file "${systemNode}" 2>/dev/null`,
        { timeout: 5_000 },
      );
      const isWrapper = fileCheck.output?.includes('text') || fileCheck.output?.includes('script');

      // If it's a wrapper (e.g. NVM shim), resolve the real binary
      let resolvedNode = systemNode;
      if (isWrapper) {
        const resolveResult = await ctx.execAsRoot(
          `readlink -f "${systemNode}" 2>/dev/null || echo "${systemNode}"`,
          { timeout: 5_000 },
        );
        resolvedNode = (resolveResult.output ?? '').trim() || systemNode;
      }

      ctx.onLog?.(`Using system Node.js at ${resolvedNode}`);
      sourcePath = resolvedNode;
    }

    ctx.onLog?.(`Copying ${sourcePath} to ${dest}`);

    const copyResult = await ctx.execAsRoot(
      [
        `mkdir -p "${ctx.agentHome}/bin"`,
        `cp "${sourcePath}" "${dest}"`,
        `chown ${ctx.agentUsername}:${ctx.socketGroupName} "${dest}"`,
        `chmod 750 "${dest}"`,
      ].join(' && '),
      { timeout: 10_000 },
    );

    if (!copyResult.success) {
      throw new Error(`Failed to copy node binary to ${dest}: ${copyResult.output ?? 'unknown error'}`);
    }

    // Compute SHA-256 hash of the source binary for integrity tracking.
    // The daemon's binary-integrity watcher compares this against the live file
    // to detect when Claude Code self-updates and replaces its bundled node.
    let nodeBinaryHash = '';
    try {
      const hashResult = await ctx.execAsRoot(
        `shasum -a 256 "${sourcePath}" | awk '{print $1}'`,
        { timeout: 10_000 },
      );
      nodeBinaryHash = (hashResult.output ?? '').trim();
    } catch {
      ctx.onLog?.('Warning: could not compute node binary hash');
    }

    ctx.onLog?.(`Node binary copied to ${dest}`);
    return {
      changed: true,
      outputs: {
        nodeBinPath: dest,
        nodeSourcePath: sourcePath,
        nodeBinaryHash,
      },
    };
  },
};
