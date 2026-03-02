/**
 * Copy Claude Node Binary Step
 *
 * Claude Code bundles its own Node.js binary under ~/.local/. The shield-client
 * and wrapper scripts (curl, git, etc.) need a stable `node-bin` at
 * `$agentHome/bin/node-bin` to function.
 *
 * Unlike the shared `copyNodeBinaryStep` (which uses `which node` via NVM),
 * this step locates Claude's embedded Node.js binary — the same one found by
 * `patchClaudeNodeStep` — and copies it to `bin/node-bin`.
 *
 * Must run AFTER `installClaudeCodeStep` (so the embedded node exists) and
 * BEFORE `patchClaudeNodeStep` (which replaces the binary with a wrapper).
 * If run after patching, the step prefers the `.real` backup.
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

    if (candidates.length === 0) {
      throw new Error(
        'No embedded Node.js binary found in ~/.local — shield-client will not work without node-bin',
      );
    }

    // Find a real binary (not a text/script wrapper).
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

    if (!sourcePath) {
      throw new Error(
        'All embedded Node.js candidates are wrappers — no real binary found for node-bin',
      );
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

    ctx.onLog?.(`Node binary copied to ${dest}`);
    return { changed: true, outputs: { nodeBinPath: dest } };
  },
};
