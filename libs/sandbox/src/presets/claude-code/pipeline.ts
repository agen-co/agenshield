/**
 * Claude Code Pipeline
 *
 * Defines the ordered step array for Claude Code installation.
 * Single source of truth for execution order.
 */

import type { InstallStep } from '../types.js';
import {
  saveHostShellConfigStep,
  installHomebrewStep,
  createInstallNvmStep,
  createInstallNodeStep,
  createRestoreShellConfigStep,
  copyNodeBinaryStep,
  createStopHostProcessesStep,
  createAppWrapperStep,
} from '../shared/index.js';
import { installClaudeCodeStep } from './install-claude-code.js';
import { verifyClaudeBinaryStep } from './verify-claude-binary.js';
import { detectHostClaudeStep } from './detect-host-claude.js';
import { copyClaudeCredentialsStep } from './copy-claude-credentials.js';
import { copyClaudeNodeBinStep } from './copy-claude-node-bin.js';
import { patchClaudeNodeStep } from './patch-claude-node.js';
import { validateGuardedShellStep } from './validate-guarded-shell.js';
import { buildClaudeSearchPath } from './claude-paths.js';

export function getClaudeCodePipeline(): InstallStep[] {
  return [
    // Phase 6: Shell config + Homebrew
    saveHostShellConfigStep,                                    // weight 1
    installHomebrewStep,                                        // weight 15

    // Phase 7: NVM & Node.js
    createInstallNvmStep(),                                     // weight 8
    createInstallNodeStep('24'),                                // weight 12
    createRestoreShellConfigStep('nvm'),                        // weight 1
    copyNodeBinaryStep,                                         // weight 3, copy nvm node to bin/node-bin

    // Phase 8: Target App
    installClaudeCodeStep,                                      // weight 30, check: version match?
    createRestoreShellConfigStep('claude'),                     // weight 1
    verifyClaudeBinaryStep,                                     // weight 5
    copyClaudeNodeBinStep,                                      // weight 3, copy embedded node to bin/node-bin for shield-client

    // Phase 9: Configuration
    createAppWrapperStep('claude', async (ctx) => {             // weight 2
      // Use checkedExecAsUserDirect — this is install-time path resolution,
      // not a runtime agent operation. The guarded shell's readonly PATH
      // blocks `export PATH=...` needed here.
      const searchPath = buildClaudeSearchPath(ctx.agentHome);
      const { checkedExecAsUserDirect } = await import('../shared/install-helpers.js');
      return (await checkedExecAsUserDirect(ctx,
        `export PATH="${searchPath}:$PATH" && command -v claude`,
        'resolve_claude', 10_000)).trim();
    }, {
      envSetup: (ctx) => {
        const hostHome = ctx.hostHome || process.env['HOME'] || '';
        const interceptorPath = `${hostHome}/.agenshield/lib/interceptor/register.cjs`;
        const socketPath = `${ctx.agentHome}/.agenshield/run/agenshield.sock`;
        return [
          '# AgenShield interceptor + proxy environment',
          `if [ -f "${interceptorPath}" ]; then`,
          `  export NODE_OPTIONS="--require ${interceptorPath} \${NODE_OPTIONS:-}"`,
          'fi',
          `export AGENSHIELD_NODE_BIN="${ctx.agentHome}/bin/node-bin"`,
          `export AGENSHIELD_SOCKET="${socketPath}"`,
          `export AGENSHIELD_HTTP_PORT="5201"`,
          'export AGENSHIELD_INTERCEPT_EXEC=true',
          'export AGENSHIELD_INTERCEPT_HTTP=true',
          'export AGENSHIELD_INTERCEPT_FETCH=true',
          'export AGENSHIELD_INTERCEPT_WS=true',
          'export HTTP_PROXY="http://127.0.0.1:5201"',
          'export HTTPS_PROXY="http://127.0.0.1:5201"',
          'export NO_PROXY="localhost,127.0.0.1"',
        ].join('\n');
      },
    }),
    createStopHostProcessesStep('claude', '[c]laude'),          // weight 3
    detectHostClaudeStep,                                       // weight 2, resolve -> copy + rewrite
    copyClaudeCredentialsStep,                                  // weight 2, best-effort Keychain → .credentials.json
    patchClaudeNodeStep,                                        // weight 2, defense-in-depth: inject interceptor into embedded node

    // Phase 10: Security Profile — validate guarded shell works post-install
    validateGuardedShellStep,                                    // weight 2, confirm sandbox environment
  ];
}
