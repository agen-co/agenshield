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
 * @param options      - Optional config: envSetup returns bash lines for env vars
 */
export function createAppWrapperStep(
  appName: string,
  resolvePath: (ctx: InstallContext) => Promise<string>,
  options?: {
    /** Return bash lines to inject env vars before exec. Receives install context. */
    envSetup?: (ctx: InstallContext) => string;
  },
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
      const envSetupLines = options?.envSetup?.(ctx) ?? '';
      // The app wrapper launches directly (not through guarded shell), so it
      // must handle cd to AGENSHIELD_HOST_CWD itself before exec'ing the binary.
      const wrapper = `#!/bin/bash
# AgenShield ${appName} wrapper
set -euo pipefail
if [ -n "\${AGENSHIELD_HOST_CWD:-}" ] && [ -d "$AGENSHIELD_HOST_CWD" ]; then
  if ! cd "$AGENSHIELD_HOST_CWD" 2>/dev/null; then
    echo "AgenShield: Cannot access $AGENSHIELD_HOST_CWD — using home directory" >&2
    cd "$HOME" 2>/dev/null || cd /
  fi
else
  cd "$HOME" 2>/dev/null || cd /
fi
# Ensure SHELL points to guarded shell for subprocess enforcement
_GS="$HOME/.agenshield/bin/guarded-shell"
[ -x "$_GS" ] && export SHELL="$_GS"
${envSetupLines ? envSetupLines + '\n' : ''}unset AGENSHIELD_HOST_CWD
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
