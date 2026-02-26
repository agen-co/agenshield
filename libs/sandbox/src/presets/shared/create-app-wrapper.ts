/**
 * Create App Wrapper Step
 *
 * Shared factory that creates a pipeline step to generate the
 * `$agentHome/bin/<app>` wrapper script. The host router at
 * `/usr/local/bin/<app>` reads the path registry and executes
 * this wrapper, which in turn execs the real binary.
 */

import type { InstallStep, InstallContext } from '../types.js';
import { checkedExecAsRoot } from './install-helpers.js';

/**
 * Create a pipeline step that writes an `$agentHome/bin/<app>` wrapper.
 *
 * @param appName      - Binary name (e.g., 'openclaw', 'claude')
 * @param resolvePath  - Async function that resolves the real binary path
 */
export function createAppWrapperStep(
  appName: string,
  resolvePath: (ctx: InstallContext) => Promise<string>,
): InstallStep {
  return {
    id: `create_${appName}_wrapper`,
    name: `Create ${appName} wrapper`,
    description: `Create agent bin wrapper for ${appName}`,
    phase: 9,
    progressMessage: `Creating ${appName} wrapper...`,
    runsAs: 'mixed',
    timeout: 15_000,
    weight: 2,

    async run(ctx) {
      const resolvedPath = await resolvePath(ctx);
      const wrapperPath = `${ctx.agentHome}/bin/${appName}`;
      const wrapper = `#!/bin/bash
# AgenShield ${appName} wrapper
set -euo pipefail
if [ -n "\${AGENSHIELD_HOST_CWD:-}" ] && [ -d "\${AGENSHIELD_HOST_CWD:-}" ]; then
  cd "\$AGENSHIELD_HOST_CWD" 2>/dev/null || cd ~ 2>/dev/null || cd /
else
  cd ~ 2>/dev/null || cd /
fi
unset AGENSHIELD_HOST_CWD
exec "${resolvedPath}" "$@"
`;
      await checkedExecAsRoot(ctx, [
        `cat > "${wrapperPath}" << 'WRAPPER_EOF'\n${wrapper}\nWRAPPER_EOF`,
        `chmod 755 "${wrapperPath}"`,
        `chown root:${ctx.socketGroupName} "${wrapperPath}"`,
      ].join('\n'), `create_${appName}_wrapper`, 10_000);

      return { changed: true, outputs: { wrapperPath, resolvedPath } };
    },
  };
}
