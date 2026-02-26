/**
 * Copy Host Config Step (Factory)
 *
 * Creates a step that copies host application config to the agent home.
 * Skipped on fresh installs.
 *
 * @param options.appName - Application name for display
 * @param options.hostDir - Function to derive host config dir from context
 * @param options.agentDir - Function to derive agent config dir from context
 * @param options.postCopy - Optional shell commands to run after copy (e.g., path rewriting)
 * @param options.excludeDirs - Directories to exclude from copy (e.g., ['local', 'downloads'])
 */

import type { InstallStep } from '../types.js';

interface CopyHostConfigOptions {
  appName: string;
  hostDir: (ctx: import('../types.js').InstallContext) => string;
  agentDir: (ctx: import('../types.js').InstallContext) => string;
  postCopy?: (ctx: import('../types.js').InstallContext) => string[];
  excludeDirs?: string[];
}

export function createCopyHostConfigStep(options: CopyHostConfigOptions): InstallStep {
  return {
    id: 'copy_config',
    name: `Copy host ${options.appName} config`,
    description: `Copy host ${options.appName} configuration to agent home`,
    phase: 9,
    progressMessage: `Copying host ${options.appName} configuration...`,
    runsAs: 'root',
    timeout: 30_000,
    weight: 5,

    skip(ctx) {
      return !!ctx.freshInstall;
    },

    async run(ctx) {
      const hostConfigDir = options.hostDir(ctx);
      const agentConfigDir = options.agentDir(ctx);

      if (options.excludeDirs?.length) {
        // Selective copy — skip excluded directories
        const cmds = [
          `if [ -d "${hostConfigDir}" ]; then`,
          `  mkdir -p "${agentConfigDir}"`,
          `  for item in "${hostConfigDir}"/*; do`,
          '    base=$(basename "$item")',
          ...options.excludeDirs.map(d => `    if [ "$base" = "${d}" ]; then continue; fi`),
          `    cp -a "$item" "${agentConfigDir}/$base" 2>/dev/null || true`,
          '  done',
          `  chown -R ${ctx.agentUsername}:${ctx.socketGroupName} "${agentConfigDir}"`,
          ...(options.postCopy?.(ctx) ?? []),
          'fi',
        ];
        await ctx.execAsRoot(cmds.join('\n'), { timeout: 30_000 });
      } else {
        // Full directory copy
        const copyResult = await ctx.execAsRoot([
          `if [ -d "${hostConfigDir}" ]; then`,
          `  mkdir -p "${agentConfigDir}"`,
          `  rsync -a --delete "${hostConfigDir}/" "${agentConfigDir}/"`,
          `  chown -R ${ctx.agentUsername}:${ctx.socketGroupName} "${agentConfigDir}"`,
          ...(options.postCopy?.(ctx) ?? []),
          '  echo "CONFIG_COPIED"',
          'else',
          '  echo "NO_HOST_CONFIG"',
          'fi',
        ].join('\n'), { timeout: 30_000 });

        if (copyResult.output?.includes('NO_HOST_CONFIG')) {
          return {
            changed: false,
            warnings: [`No host ${options.appName} config found — agent will use defaults`],
          };
        }
      }

      return { changed: true };
    },
  };
}
